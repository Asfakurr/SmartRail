import { hasDestinationEvidence } from "../../shared/gps-completion";
import {
  hasDepartureEvidence,
  selectGpsJourney,
  withinAutoStartWindow,
} from "../../shared/gps-start";
import {
  startJourney,
  completeJourney,
  cancelJourney,
  transitionJourneyState,
} from "./journey-lifecycle";
import {
  ensureJourneysForServiceDate,
  reconcileJourneyOperations,
} from "./journey-generation";
import { RAILWAY_TIMEZONE } from "../../shared/service-date";
import { markStaleGps } from "./stale";
import { createFromSavedSchedule, saveMaster } from "./master-data";
import { liveProjection } from "../../shared/live";
import { coordinateAt } from "../../shared/engine";
import { MockSmsService } from "./sms";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getDatabase } from "firebase-admin/database";
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ingest, notificationsFor } from "../../shared/engine";
import {
  defaults,
  type Device,
  type Journey,
  type LiveState,
  type Subscription,
  type Thresholds,
} from "../../shared/domain";
import {
  makeJourney,
  makeTickets,
  ticketSubscriptions,
  passengers,
} from "../../shared/seed";
initializeApp(
  process.env.FUNCTIONS_EMULATOR === "true"
    ? { databaseURL: "https://demo-smartrail-bd-default-rtdb.firebaseio.com" }
    : undefined,
);
const db = getFirestore();
const pingSchema = z
  .object({
    journeyId: z
      .string()
      .max(180)
      .regex(/^[\w-]+$/),
    deviceId: z
      .string()
      .max(100)
      .regex(/^[\w-]+$/),
    source: z.enum(["DEDICATED_GNSS_CELLULAR", "OPERATOR_PHONE", "SIMULATOR"]),
    lat: z.number(),
    lng: z.number(),
    accuracyM: z.number(),
    timestamp: z.number().int(),
    sequence: z.number().int().nonnegative(),
  })
  .strict();
const idSchema = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[\w-]+$/);
async function identity(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) throw new Error("Unauthorized");
  return getAuth().verifyIdToken(header.slice(7), true);
}
async function admin(header: string | undefined) {
  const user = await identity(header);
  if (user.admin !== true) throw new Error("Forbidden");
  return user;
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function demoEnabled() {
  return (
    process.env.FUNCTIONS_EMULATOR === "true" ||
    process.env.DEMO_MODE === "true"
  );
}
// Both HTTPS and a future authenticated MQTT bridge call this single service boundary.
export async function processGps(
  raw: unknown,
  credential: { key?: string; uid?: string; simulationAdmin?: boolean },
  now = Date.now(),
) {
  const ping = pingSchema.parse(raw);
  const deviceSnap = await db.doc(`gpsDevices/${ping.deviceId}`).get();
  const device = deviceSnap.data() as Device | undefined;
  if (!device?.active || device.source !== ping.source)
    throw new Error("Forbidden");
  if (
    ping.source !== "OPERATOR_PHONE" &&
    !(ping.source === "SIMULATOR" && credential.simulationAdmin)
  ) {
    const expected = Buffer.from(device.keyHash || "", "hex"),
      actual = Buffer.from(hash(credential.key || ""), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new Error("Unauthorized");
  } else if (ping.source === "OPERATOR_PHONE") {
    if (!credential.uid || device.operatorUid !== credential.uid)
      throw new Error("Forbidden");
    const operator = (await db.doc(`operators/${credential.uid}`).get()).data();
    if (
      !operator?.active ||
      !operator.trainNumbers?.includes(device.trainNumber)
    )
      throw new Error("Forbidden");
  }
  const submittedPing = ping;
  return db.runTransaction(async (tx) => {
    const ping = { ...submittedPing };
    const requested = await tx.get(db.doc(`journeys/${ping.journeyId}`));
    const generatedRequest = requested.data()?.generationSource === "SCHEDULE";
    const streamLock = db.doc(`deviceStartLocks/${ping.deviceId}`);
    if (generatedRequest) {
      await tx.get(streamLock);
      const settings = await tx.get(db.doc("systemConfig/global"));
      const assigned = await tx.get(
        db
          .collection("journeys")
          .where(
            "scheduleSnapshot.gpsDeviceIds",
            "array-contains",
            ping.deviceId,
          )
          .where("status", "in", ["READY", "RUNNING"]),
      );
      const selected = selectGpsJourney(
        assigned.docs.map((d) => d.data() as Journey),
        ping.deviceId,
        ping,
        now,
        { ...defaults, ...settings.data() },
      );
      if (selected) ping.journeyId = selected.id;
    }
    const journeyRef = db.doc(`journeys/${ping.journeyId}`),
      stateRef = db.doc(`liveInternal/${ping.journeyId}`);
    const checkpointRef = db.doc(
      `deviceCheckpoints/${ping.deviceId}_${ping.journeyId}`,
    );
    const [
      journeyDoc,
      stateDoc,
      settingsDoc,
      subsDoc,
      checkpointDoc,
      registeredDevice,
    ] = await Promise.all([
      tx.get(journeyRef),
      tx.get(stateRef),
      tx.get(db.doc("systemConfig/global")),
      tx.get(
        db.collection("subscriptions").where("journeyId", "==", ping.journeyId),
      ),
      tx.get(checkpointRef),
      tx.get(deviceSnap.ref),
    ]);
    if (
      !registeredDevice.data()?.active ||
      registeredDevice.data()?.trainNumber !== device.trainNumber ||
      registeredDevice.data()?.source !== ping.source ||
      registeredDevice.data()?.keyHash !== device.keyHash ||
      registeredDevice.data()?.operatorUid !== device.operatorUid
    )
      throw new Error("Forbidden");
    const checkpoint = checkpointDoc.data();
    if (
      checkpoint &&
      (ping.sequence <= checkpoint.sequence ||
        ping.timestamp - checkpoint.timestamp <
          (settingsDoc.data()?.gpsMinIntervalMs ?? defaults.gpsMinIntervalMs))
    )
      throw new Error("Replay or GPS rate limit");
    if (!journeyDoc.exists) throw new Error("Journey missing");
    if (subsDoc.size > 100)
      throw new Error("Prototype subscription capacity exceeded");
    const journey = journeyDoc.data() as Journey,
      previous = stateDoc.exists ? (stateDoc.data() as LiveState) : null;
    const generated = journey.generationSource === "SCHEDULE";
    if (generated && !["READY", "RUNNING"].includes(journey.status))
      throw new Error("Generated journey must be READY or RUNNING");
    if (journey.schemaVersion !== 2)
      throw new Error(
        "Legacy journey is read-only; create a new journey from saved master data",
      );
    if (
      device.trainNumber !== journey.trainNumber ||
      !journey.scheduleSnapshot.gpsDeviceIds.includes(device.id)
    )
      throw new Error("Forbidden");
    if (ping.source === "OPERATOR_PHONE") {
      const op = await tx.get(db.doc(`operators/${credential.uid}`));
      if (
        !op.data()?.active ||
        !op.data()?.trainNumbers?.includes(journey.trainNumber)
      )
        throw new Error("Forbidden");
    }
    const config = { ...defaults, ...settingsDoc.data() } as Thresholds;
    const live = ingest(journey, ping, previous, now, config);
    const shouldComplete =
      generated && hasDestinationEvidence(journey, previous, live, config);
    if (generated) live.completed = shouldComplete;
    if (shouldComplete) live.predictions = [];
    const shouldStart =
      generated &&
      withinAutoStartWindow(journey, now, config) &&
      hasDepartureEvidence(journey, previous, live, config);
    const canNotify = !generated || journey.status === "RUNNING" || shouldStart;
    const candidates =
      !shouldComplete &&
      canNotify &&
      config.notificationsEnabled &&
      config.mockSmsEnabled
        ? notificationsFor(
            journey,
            live,
            subsDoc.docs.map((d) => d.data() as Subscription),
            new Set(),
            config.delayMinutes,
          )
        : [];
    const refs = candidates.map((n) => db.doc(`notifications/${n.id}`));
    const existing = refs.length ? await tx.getAll(...refs) : [];
    if (shouldStart)
      await transitionJourneyState(
        journey.id,
        "RUNNING",
        Date.now(),
        { source: "GPS_AUTO", previous, live, config },
        { tx, journey },
      );
    if (shouldComplete)
      await transitionJourneyState(
        journey.id,
        "COMPLETED",
        Date.now(),
        { source: "GPS_AUTO", previous, live, config },
        { tx, journey },
      );
    if (generatedRequest && !shouldComplete)
      tx.set(streamLock, { journeyId: journey.id, updatedAt: Date.now() });
    tx.set(stateRef, {
      ...live,
      receivedAt: Date.now(),
      revision: (stateDoc.data()?.revision || 0) + 1,
      projection: liveProjection(journey, live, config),
    });
    tx.set(checkpointRef, {
      sequence: ping.sequence,
      timestamp: ping.timestamp,
    });
    tx.set(
      db.doc(
        `journeys/${ping.journeyId}/gpsHistory/${ping.deviceId}_${ping.sequence}`,
      ),
      {
        ...ping,
        rawCoordinates: { latitude: ping.lat, longitude: ping.lng },
        matchedCoordinates: { latitude: live.lat, longitude: live.lng },
        speedKph: live.speedKph,
        trackingSource: live.source,
        validationStatus: live.gpsStatus,
        routeDeviationMeters: live.routeDeviationMeters,
        distanceFromOriginMeters: live.chainageM,
        currentSegmentId: liveProjection(journey, live, config).progress
          .currentSegmentId,
        recordedAt: Date.now(),
        chainageM: live.chainageM,
        expiresAt: new Date(now + 7 * 86400000),
      },
    );
    candidates.forEach((n, i) => {
      if (!existing[i].exists) {
        tx.create(refs[i], new MockSmsService().prepare(n));
        tx.create(db.doc(`journeys/${journey.id}/events/${n.id}`), {
          type: "DELAY_THRESHOLD_CROSSED",
          pointId: n.boardingPointId,
          recordedAt: live.timestamp,
          notificationId: n.id,
        });
      }
    });
    const event = (type: string, pointId?: string) =>
      tx.set(
        db.doc(
          `journeys/${journey.id}/events/${ping.deviceId}_${ping.sequence}_${type}_${pointId || "journey"}`,
        ),
        {
          type,
          pointId: pointId || null,
          recordedAt: live.timestamp,
          source: live.source,
          inferred: true,
        },
      );
    if (!previous && !generated) event("JOURNEY_STARTED");
    if (previous?.gpsStatus === "STALE") event("GPS_RECOVERED");
    if (previous && previous.source !== live.source)
      event("GPS_SOURCE_SWITCHED");
    journey.route.points.forEach((p) => {
      if (
        (!previous || previous.chainageM < p.cumulativeM) &&
        live.chainageM >= p.cumulativeM
      )
        event("STATION_REACHED", p.id);
      if (
        previous &&
        previous.chainageM <= p.cumulativeM &&
        live.chainageM > p.cumulativeM
      )
        event("STATION_DEPARTED", p.id);
    });
    tx.set(
      db.doc(
        `journeys/${journey.id}/predictionHistory/${ping.deviceId}_${ping.sequence}`,
      ),
      {
        recordedAt: live.timestamp,
        modelVersion: "manual-speed-v2",
        predictions: live.predictions,
      },
    );
    if (!generated && live.completed) {
      subsDoc.docs.forEach((d) =>
        tx.update(d.ref, {
          active: false,
          expiresAt: Math.min(live.timestamp, d.data().expiresAt),
        }),
      );
      tx.update(journeyRef, { status: "COMPLETED" });
      event("JOURNEY_COMPLETED");
    } else if (!generated && journey.status !== "RUNNING")
      tx.update(journeyRef, { status: "RUNNING" });
    return live;
  });
}
// Firestore is the ordered, durable processing record; RTDB is a recoverable public projection.
export const publishLive = onDocumentWritten(
  { document: "liveInternal/{journeyId}", region: "asia-south1", retry: true },
  async (event) => {
    const state = event.data?.after.data();
    if (!state?.projection) return;
    const publicLive = { ...state.projection, revision: state.revision };
    await getDatabase()
      .ref(`liveJourneys/${event.params.journeyId}`)
      .transaction((current) =>
        !current || current.revision < state.revision ? publicLive : undefined,
      );
  },
);
export const api = onRequest(
  { region: "asia-south1", cors: true, maxInstances: 5 },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ error: "Use POST" });
        return;
      }
      if (
        Buffer.byteLength(JSON.stringify(req.body || {})) >
        (req.path === "/master" ? 700000 : 16384)
      ) {
        res.status(413).json({ error: "Payload too large" });
        return;
      }
      const path = req.path.replace(/\/$/, "");
      if (path === "/gps") {
        const body = pingSchema.parse(req.body);
        const user =
          body.source === "OPERATOR_PHONE"
            ? await identity(req.headers.authorization)
            : null;
        const live = await processGps(body, {
          key: req.get("x-device-key"),
          uid: user?.uid,
        });
        res.json({ live });
        return;
      }
      if (path === "/complete-journey" || path === "/cancel-journey") {
        const user = await admin(req.headers.authorization);
        if (path === "/complete-journey") {
          const input = z
            .object({ journeyId: idSchema })
            .strict()
            .parse(req.body);
          res.json({ result: await completeJourney(input.journeyId) });
        } else {
          const input = z
            .object({
              journeyId: idSchema,
              reason: z.string().trim().min(1).max(300),
            })
            .strict()
            .parse(req.body);
          res.json({
            result: await cancelJourney(
              input.journeyId,
              input.reason,
              user.uid,
            ),
          });
        }
        return;
      }
      if (path === "/start-journey") {
        await admin(req.headers.authorization);
        const input = z
          .object({ journeyId: idSchema })
          .strict()
          .parse(req.body);
        res.json({ result: await startJourney(input.journeyId) });
        return;
      }
      if (path === "/journey-status") {
        await admin(req.headers.authorization);
        const input = z
          .object({
            journeyId: idSchema,
            status: z.enum(["READY", "CANCELLED"]),
          })
          .strict()
          .parse(req.body);
        await db.runTransaction(async (tx) => {
          const r = db.doc(`journeys/${input.journeyId}`),
            j = await tx.get(r);
          if (!j.exists) throw new Error("Journey missing");
          if (j.data()?.generationSource === "SCHEDULE")
            throw new Error(
              "Generated journeys use centralized lifecycle automation",
            );
          const stateRef = db.doc(`liveInternal/${input.journeyId}`),
            state = await tx.get(stateRef),
            subs = await tx.get(
              db
                .collection("subscriptions")
                .where("journeyId", "==", input.journeyId),
            );
          if (
            input.status === "READY"
              ? j.data()?.status !== "SCHEDULED"
              : ["CANCELLED", "COMPLETED"].includes(j.data()?.status)
          )
            throw new Error("Invalid status transition");
          tx.update(r, { status: input.status });
          if (input.status === "CANCELLED") {
            subs.docs.forEach((d) => tx.update(d.ref, { active: false }));
            if (state.exists) {
              const data = state.data()!;
              tx.update(stateRef, {
                completed: true,
                revision: data.revision + 1,
                projection: {
                  ...data.projection,
                  completed: true,
                  tracking: {
                    ...data.projection.tracking,
                    gpsStatus: "STALE",
                    primaryDeviceHealthy: false,
                  },
                },
              });
            }
          }
        });
        res.json({ status: input.status });
        return;
      }
      if (path === "/master") {
        await admin(req.headers.authorization);
        await saveMaster(req.body);
        res.json({ saved: true });
        return;
      }
      if (path === "/simulate") {
        const user = await admin(req.headers.authorization);
        if (!demoEnabled()) throw new Error("Simulator disabled");
        const input = z
          .object({ journeyId: idSchema, action: z.enum(["STEP", "HOLD"]) })
          .strict()
          .parse(req.body);
        const snap = await db.doc(`journeys/${input.journeyId}`).get(),
          journey = snap.data() as Journey;
        if (!journey?.simulated)
          throw new Error("Simulator requires a simulated journey");
        const previous = (
          await db.doc(`liveInternal/${journey.id}`).get()
        ).data() as LiveState | undefined;
        const devices = await Promise.all(
          journey.scheduleSnapshot.gpsDeviceIds.map((id) =>
            db.doc(`gpsDevices/${id}`).get(),
          ),
        );
        const device = devices
          .map((d) => d.data() as Device)
          .find((d) => d?.active && d.source === "SIMULATOR");
        if (!device) throw new Error("No assigned simulator device");
        const checkpoint = (
          await db.doc(`deviceCheckpoints/${device.id}_${journey.id}`).get()
        ).data();
        const timestamp =
          (previous?.timestamp ?? journey.departureMs) +
          (input.action === "HOLD" ? 12 : 3) * 60000;
        const distance = Math.min(
          journey.route.points.at(-1)!.cumulativeM,
          (previous?.chainageM ?? 0) + (input.action === "HOLD" ? 0 : 1800),
        );
        const live = await processGps(
          {
            ...coordinateAt(journey.route, distance),
            journeyId: journey.id,
            deviceId: device.id,
            source: "SIMULATOR",
            timestamp,
            sequence: (checkpoint?.sequence ?? 0) + 1,
            accuracyM: 8,
          },
          { uid: user.uid, simulationAdmin: true },
          timestamp,
        );
        res.json({
          live: liveProjection(
            (
              await db.doc(`journeys/${live.journeyId}`).get()
            ).data() as Journey,
            live,
            {
              ...defaults,
              ...(await db.doc("systemConfig/global").get()).data(),
            },
          ),
        });
        return;
      }
      if (path === "/unsubscribe") {
        const user = await identity(req.headers.authorization),
          id = idSchema.parse(req.body.subscriptionId);
        await db.runTransaction(async (tx) => {
          const r = db.doc(`subscriptions/${id}`),
            s = await tx.get(r);
          if (
            !s.exists ||
            s.data()?.source !== "MANUAL" ||
            s.data()?.passengerId !== user.uid
          )
            throw new Error("Forbidden");
          tx.update(r, { active: false });
        });
        res.json({ cancelled: true });
        return;
      }
      if (path === "/config") {
        await admin(req.headers.authorization);
        const config = z
          .object({
            completionMinProgress: z
              .number()
              .min(0.98)
              .max(1)
              .default(defaults.completionMinProgress),
            completionRadiusM: z
              .number()
              .min(100)
              .max(1000)
              .default(defaults.completionRadiusM),
            completionMaxObservationGapMs: z
              .number()
              .int()
              .min(1000)
              .max(600000)
              .default(defaults.completionMaxObservationGapMs),
            autoStartLateMs: z
              .number()
              .int()
              .min(60000)
              .max(86400000)
              .default(defaults.autoStartLateMs),
            startMinProgressM: z
              .number()
              .min(10)
              .max(2000)
              .default(defaults.startMinProgressM),
            startMaxObservationGapMs: z
              .number()
              .int()
              .min(1000)
              .max(1800000)
              .default(defaults.startMaxObservationGapMs),
            startMaxOriginProgressM: z
              .number()
              .min(100)
              .max(10000)
              .default(defaults.startMaxOriginProgressM),
            delayMinutes: z.number().min(1).max(120),
            primaryStaleMs: z.number().int().min(1000).max(3600000),
            maxAccuracyM: z.number().positive().max(1000),
            maxOffRouteM: z.number().positive().max(5000),
            maxSpeedKmh: z.number().positive().max(300),
            timestampToleranceMs: z.number().int().min(1000).max(120000),
            recentSpeedWindowMs: z.number().int().min(1000).max(3600000),
            etaMinFactor: z.number().min(0.25).max(1),
            etaMaxFactor: z.number().min(1).max(4),
            notificationsEnabled: z.boolean(),
            mockSmsEnabled: z.boolean(),
            gpsMinIntervalMs: z.number().int().min(100).max(60000),
            backwardToleranceMeters: z.number().min(0).max(500),
          })
          .strict()
          .parse(req.body);
        await db.doc("systemConfig/global").set(config);
        res.json({ config });
        return;
      }
      if (path === "/mock-tickets") {
        await admin(req.headers.authorization);
        if (!demoEnabled()) throw new Error("Mock data is disabled");
        const id = idSchema.parse(req.body.journeyId);
        const tickets = await db.runTransaction(async (tx) => {
          const snap = await tx.get(db.doc(`journeys/${id}`));
          if (!snap.exists) throw new Error("Journey missing");
          const journey = snap.data() as Journey;
          if (
            journey.expiresAt < Date.now() ||
            ["COMPLETED", "CANCELLED"].includes(journey.status)
          )
            throw new Error("Journey is closed");
          const existing = await tx.get(
            db.collection("subscriptions").where("journeyId", "==", id),
          );
          const subs = ticketSubscriptions(journey);
          const existingIds = new Set(existing.docs.map((d) => d.id));
          if (
            existing.size + subs.filter((s) => !existingIds.has(s.id)).length >
            100
          )
            throw new Error("Prototype subscription capacity exceeded");
          const tickets = makeTickets(journey);
          passengers.forEach((p) => tx.set(db.doc(`passengers/${p.id}`), p));
          tickets.forEach((t) => tx.set(db.doc(`mockTickets/${t.id}`), t));
          subs.forEach((s) => tx.set(db.doc(`subscriptions/${s.id}`), s));
          return tickets;
        });
        res.json({ tickets });
        return;
      }
      if (path === "/subscribe") {
        const user = await identity(req.headers.authorization);
        const input = z
          .object({
            journeyId: idSchema,
            boardingPointId: idSchema,
            phone: z.string().regex(/^\+880100000\d{4}$/),
          })
          .strict()
          .parse(req.body);
        if (!demoEnabled())
          throw new Error("Only fake prototype subscriptions are enabled");
        const id = hash(
          `${input.journeyId}:${input.boardingPointId}:${user.uid}`,
        );
        await db.runTransaction(async (tx) => {
          const journey = (
            await tx.get(db.doc(`journeys/${input.journeyId}`))
          ).data() as Journey | undefined;
          if (
            !journey ||
            journey.expiresAt < Date.now() ||
            ["COMPLETED", "CANCELLED"].includes(journey.status) ||
            !journey.route.points.some(
              (p) =>
                p.id === input.boardingPointId && p.passengerBoardingAllowed,
            )
          )
            throw new Error("Invalid boarding station or expired journey");
          const existing = await tx.get(
            db.collection("subscriptions").where("journeyId", "==", journey.id),
          );
          if (existing.size >= 100 && !existing.docs.some((d) => d.id === id))
            throw new Error("Prototype subscription capacity exceeded");
          const subscription: Subscription = {
            ...input,
            id,
            passengerId: user.uid,
            source: "MANUAL",
            expiresAt: journey.expiresAt,
            active: true,
          };
          tx.set(db.doc(`subscriptions/${id}`), subscription);
        });
        res.json({ id });
        return;
      }
      if (path === "/threshold") {
        await admin(req.headers.authorization);
        const delayMinutes = z
          .number()
          .int()
          .min(1)
          .max(120)
          .parse(req.body.delayMinutes);
        await db
          .doc("systemConfig/global")
          .set({ delayMinutes }, { merge: true });
        res.json({ delayMinutes });
        return;
      }
      if (path === "/reconcile-journeys") {
        await admin(req.headers.authorization);
        const input = z
          .object({ serviceDate: z.string() })
          .strict()
          .parse(req.body);
        res.json(await ensureJourneysForServiceDate(input.serviceDate));
        return;
      }
      if (path === "/journey") {
        await admin(req.headers.authorization);
        if (!demoEnabled())
          throw new Error("Demo journey creation is disabled");
        const input = z
          .object({ scheduleId: idSchema, serviceDate: z.string() })
          .strict()
          .parse(req.body);
        const journey = await createFromSavedSchedule(
          input.scheduleId,
          input.serviceDate,
        );
        res.json({ journey });
        return;
      }
      res.status(404).json({ error: "Unknown endpoint" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      const status =
        message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400;
      res.status(status).json({
        error:
          status === 400
            ? message
            : status === 401
              ? "Unauthorized"
              : "Forbidden",
      });
    }
  },
);

export const detectStaleGps = onSchedule(
  { schedule: "every 1 minutes", region: "asia-south1" },
  () => markStaleGps(),
);

export const reconcileScheduledJourneys = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: RAILWAY_TIMEZONE,
    region: "asia-south1",
    retryCount: 3,
  },
  async () => {
    const summary = await reconcileJourneyOperations();
    console.log("Journey reconciliation", JSON.stringify(summary));
    if (summary.generation.failedCount || summary.readiness.failedCount)
      throw new Error(
        `Journey reconciliation: ${summary.generation.failedCount} generation and ${summary.readiness.failedCount} readiness failure(s)`,
      );
  },
);
