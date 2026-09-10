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
    source: z.enum(["primary", "phone"]),
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
  credential: { key?: string; uid?: string },
  now = Date.now(),
) {
  const ping = pingSchema.parse(raw);
  const deviceSnap = await db.doc(`devices/${ping.deviceId}`).get();
  const device = deviceSnap.data() as Device | undefined;
  if (
    !device?.active ||
    device.journeyId !== ping.journeyId ||
    device.source !== ping.source
  )
    throw new Error("Forbidden");
  if (ping.source === "primary") {
    const expected = Buffer.from(device.keyHash || "", "hex"),
      actual = Buffer.from(hash(credential.key || ""), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new Error("Unauthorized");
  } else {
    if (!credential.uid || device.operatorUid !== credential.uid)
      throw new Error("Forbidden");
    const operator = (await db.doc(`operators/${credential.uid}`).get()).data();
    if (!operator?.active || !operator.journeyIds?.includes(ping.journeyId))
      throw new Error("Forbidden");
  }
  return db.runTransaction(async (tx) => {
    const journeyRef = db.doc(`journeys/${ping.journeyId}`),
      stateRef = db.doc(`liveInternal/${ping.journeyId}`);
    const checkpointRef = db.doc(`deviceCheckpoints/${ping.deviceId}`);
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
      tx.get(db.doc("settings/thresholds")),
      tx.get(
        db.collection("subscriptions").where("journeyId", "==", ping.journeyId),
      ),
      tx.get(checkpointRef),
      tx.get(deviceSnap.ref),
    ]);
    if (
      !registeredDevice.data()?.active ||
      registeredDevice.data()?.journeyId !== ping.journeyId ||
      registeredDevice.data()?.keyHash !== device.keyHash ||
      registeredDevice.data()?.operatorUid !== device.operatorUid
    )
      throw new Error("Forbidden");
    const checkpoint = checkpointDoc.data();
    if (
      checkpoint &&
      (ping.sequence <= checkpoint.sequence ||
        ping.timestamp - checkpoint.timestamp < 1000)
    )
      throw new Error("Replay or GPS rate limit");
    if (!journeyDoc.exists) throw new Error("Journey missing");
    if (subsDoc.size > 400)
      throw new Error("Prototype subscription capacity exceeded");
    const journey = journeyDoc.data() as Journey,
      previous = stateDoc.exists ? (stateDoc.data() as LiveState) : null;
    const config = { ...defaults, ...settingsDoc.data() } as Thresholds;
    const live = ingest(journey, ping, previous, now, config);
    const candidates = notificationsFor(
      journey,
      live,
      subsDoc.docs.map((d) => d.data() as Subscription),
      new Set(),
      config.delayMinutes,
    );
    const refs = candidates.map((n) => db.doc(`notifications/${n.id}`));
    const existing = refs.length ? await tx.getAll(...refs) : [];
    tx.set(stateRef, live);
    tx.set(checkpointRef, {
      sequence: ping.sequence,
      timestamp: ping.timestamp,
    });
    tx.set(
      db.doc(
        `gpsHistory/${ping.journeyId}/fixes/${ping.deviceId}_${ping.sequence}`,
      ),
      {
        ...ping,
        chainageM: live.chainageM,
        expiresAt: new Date(now + 7 * 86400000),
      },
    );
    candidates.forEach((n, i) => {
      if (!existing[i].exists) tx.create(refs[i], n);
    });
    if (live.completed) tx.update(journeyRef, { status: "completed" });
    return live;
  });
}
// Firestore is the ordered, durable processing record; RTDB is a recoverable public projection.
export const publishLive = onDocumentWritten(
  { document: "liveInternal/{journeyId}", region: "asia-south1", retry: true },
  async (event) => {
    const live = event.data?.after.data() as LiveState | undefined;
    if (!live) return;
    const {
      deviceId: _deviceId,
      sequence: _sequence,
      primaryLastSeen: _primary,
      ...publicLive
    } = live;
    await getDatabase()
      .ref(`liveJourneys/${event.params.journeyId}`)
      .transaction((current) =>
        !current || current.timestamp < live.timestamp ? publicLive : undefined,
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
      if (Number(req.headers["content-length"] || 0) > 16384) {
        res.status(413).json({ error: "Payload too large" });
        return;
      }
      const path = req.path.replace(/\/$/, "");
      if (path === "/gps") {
        const body = pingSchema.parse(req.body);
        const user =
          body.source === "phone"
            ? await identity(req.headers.authorization)
            : null;
        const live = await processGps(body, {
          key: req.get("x-device-key"),
          uid: user?.uid,
        });
        res.json({ live });
        return;
      }
      if (path === "/mock-tickets") {
        await admin(req.headers.authorization);
        if (!demoEnabled()) throw new Error("Mock data is disabled");
        const id = idSchema.parse(req.body.journeyId);
        const snap = await db.doc(`journeys/${id}`).get();
        if (!snap.exists) throw new Error("Journey missing");
        const journey = snap.data() as Journey;
        const batch = db.batch();
        passengers.forEach((p) => batch.set(db.doc(`passengers/${p.id}`), p));
        makeTickets(journey).forEach((t) =>
          batch.set(db.doc(`tickets/${t.id}`), t),
        );
        ticketSubscriptions(journey).forEach((s) =>
          batch.set(db.doc(`subscriptions/${s.id}`), s),
        );
        await batch.commit();
        res.json({ tickets: makeTickets(journey) });
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
        const journey = (
          await db.doc(`journeys/${input.journeyId}`).get()
        ).data() as Journey | undefined;
        if (
          !journey ||
          journey.expiresAt < Date.now() ||
          !journey.route.points.some(
            (p) =>
              p.id === input.boardingPointId &&
              ["origin", "passenger_halt"].includes(p.kind),
          )
        )
          throw new Error("Invalid boarding station or expired journey");
        const id = hash(
          `${input.journeyId}:${input.boardingPointId}:${user.uid}`,
        );
        const subscription: Subscription = {
          ...input,
          id,
          passengerId: user.uid,
          source: "manual",
          expiresAt: journey.expiresAt,
          active: true,
        };
        await db.runTransaction(async (tx) => {
          const existing = await tx.get(
            db.collection("subscriptions").where("journeyId", "==", journey.id),
          );
          if (existing.size >= 400)
            throw new Error("Prototype subscription capacity exceeded");
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
          .doc("settings/thresholds")
          .set({ delayMinutes }, { merge: true });
        res.json({ delayMinutes });
        return;
      }
      if (path === "/journey") {
        await admin(req.headers.authorization);
        if (!demoEnabled())
          throw new Error("Demo journey creation is disabled");
        const input = z
            .object({ date: z.string(), time: z.string() })
            .strict()
            .parse(req.body),
          journey = makeJourney(input.date, input.time);
        const route = await db.doc(`routes/${journey.routeId}`).get(),
          train = await db.doc(`trains/${journey.trainNumber}`).get();
        if (!route.exists || !train.exists)
          throw new Error("Configure route before train and journey");
        await db.doc(`journeys/${journey.id}`).create(journey);
        res.json({ journey });
        return;
      }
      res.status(404).json({ error: "Unknown endpoint" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      const status =
        message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400;
      res
        .status(status)
        .json({
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
