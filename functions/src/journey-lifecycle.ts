import { hasDestinationEvidence } from "../../shared/gps-completion";
import { hasDepartureEvidence } from "../../shared/gps-start";
import { getFirestore, type Transaction } from "firebase-admin/firestore";
import type { Journey, LiveState, Thresholds } from "../../shared/domain";
import {
  isReadyDue,
  READY_LEAD_MS,
  validateJourneyTransition,
  type JourneyStatus,
} from "../../shared/lifecycle";
export const READY_RECOVERY_WINDOW_MS = 48 * 60 * 60 * 1000;
export const READY_BATCH_LIMIT = 200;

interface TransitionOptions {
  source: "GPS_AUTO" | "ADMIN_MANUAL";
  previous?: LiveState | null;
  live?: LiveState;
  config?: Thresholds;
  reason?: string;
  actorUid?: string;
}
/** GPS may join its existing transaction so evidence, lifecycle and live state commit together. */
export async function transitionJourneyState(
  journeyId: string,
  target: JourneyStatus,
  now = Date.now(),
  options?: TransitionOptions,
  context?: { tx: Transaction; journey: Journey },
): Promise<"TRANSITIONED" | "UNCHANGED" | "NOT_DUE"> {
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(journeyId))
    throw new Error("Invalid journey ID");
  if (!Number.isSafeInteger(now))
    throw new Error("Invalid reconciliation time");
  if (!["READY", "RUNNING", "COMPLETED", "CANCELLED"].includes(target))
    throw new Error("Transition workflow not enabled");
  if (target !== "READY" && !options)
    throw new Error("Transition source required");
  const db = getFirestore(),
    ref = db.doc(`journeys/${journeyId}`);
  async function apply(tx: Transaction, journey: Journey) {
    if (journey.generationSource !== "SCHEDULE")
      throw new Error("Manual journey excluded from lifecycle automation");
    const result = validateJourneyTransition(journey.status, target);
    if (result === "UNCHANGED") return result;
    if (target === "READY") {
      if (!isReadyDue(journey.departureMs, now)) return "NOT_DUE" as const;
      tx.update(ref, {
        status: target,
        statusUpdatedAt: now,
        transitionSource: "SYSTEM_TIME",
      });
    } else if (target === "COMPLETED" || target === "CANCELLED") {
      const source = options!.source;
      if (
        source !== "ADMIN_MANUAL" &&
        !(target === "COMPLETED" && source === "GPS_AUTO")
      )
        throw new Error("Invalid terminal source");
      if (
        source === "GPS_AUTO" &&
        (!options!.live ||
          !options!.config ||
          !hasDestinationEvidence(
            journey,
            options!.previous ?? null,
            options!.live,
            options!.config,
          ))
      )
        throw new Error("Insufficient destination evidence");
      const reason = options!.reason?.trim();
      if (target === "CANCELLED" && (!reason || reason.length > 300))
        throw new Error("Cancellation reason required (1-300 characters)");
      tx.update(ref, {
        status: target,
        statusUpdatedAt: now,
        transitionSource: source,
        ...(target === "COMPLETED"
          ? {
              actualArrivalAt:
                source === "GPS_AUTO" ? options!.live!.timestamp : now,
            }
          : {
              cancelledAt: now,
              cancellationReason: reason,
              ...(options!.actorUid ? { cancelledBy: options!.actorUid } : {}),
            }),
      });
    } else {
      const source = options!.source;
      if (source !== "GPS_AUTO" && source !== "ADMIN_MANUAL")
        throw new Error("Invalid start source");
      if (
        source === "GPS_AUTO" &&
        (!options!.live ||
          !options!.config ||
          !hasDepartureEvidence(
            journey,
            options!.previous ?? null,
            options!.live,
            options!.config,
          ))
      )
        throw new Error("Insufficient departure evidence");
      const actualDepartureAt =
        source === "GPS_AUTO" ? options!.live!.timestamp : now;
      tx.update(ref, {
        status: target,
        statusUpdatedAt: now,
        transitionSource: source,
        actualDepartureAt,
        departureDeviationMinutes:
          (actualDepartureAt - journey.departureMs) / 60000,
      });
    }
    return "TRANSITIONED" as const;
  }
  async function execute(tx: Transaction, journey: Journey) {
    const locks = [];
    if (target === "RUNNING" && journey.status === "READY") {
      for (const deviceId of [
        ...new Set(journey.scheduleSnapshot.gpsDeviceIds),
      ].sort()) {
        const lock = db.doc(`deviceStartLocks/${deviceId}`);
        await tx.get(lock);
        const running = await tx.get(
          db
            .collection("journeys")
            .where("scheduleSnapshot.gpsDeviceIds", "array-contains", deviceId)
            .where("status", "==", "RUNNING"),
        );
        if (running.docs.some((d) => d.id !== journeyId))
          throw new Error("Device already has a RUNNING journey");
        locks.push(lock);
      }
    }
    const terminal = target === "COMPLETED" || target === "CANCELLED";
    // Read cleanup dependencies before any transaction writes. Reading the journey
    // also serializes ticket/subscription creation against terminal transitions.
    const cleanup =
      terminal && journey.status !== target
        ? {
            subscriptions: await tx.get(
              db
                .collection("subscriptions")
                .where("journeyId", "==", journeyId),
            ),
            state: await tx.get(db.doc(`liveInternal/${journeyId}`)),
            locks: await Promise.all(
              [...new Set(journey.scheduleSnapshot.gpsDeviceIds)].map((id) =>
                tx.get(db.doc(`deviceStartLocks/${id}`)),
              ),
            ),
          }
        : null;
    const result = await apply(tx, journey);
    if (result === "TRANSITIONED" && cleanup) {
      cleanup.subscriptions.docs.forEach((d) =>
        tx.update(d.ref, {
          active: false,
          expiresAt: Math.min(now, d.data().expiresAt),
        }),
      );
      cleanup.locks.forEach((d) => {
        if (d.data()?.journeyId === journeyId) tx.delete(d.ref);
      });
      // GPS writes its final projection in the enclosing transaction.
      if (!context && cleanup.state.exists) {
        const data = cleanup.state.data()!;
        tx.update(cleanup.state.ref, {
          completed: true,
          predictions: [],
          revision: (data.revision || 0) + 1,
          projection: {
            ...data.projection,
            completed: true,
            stationPredictions: {},
          },
        });
      }
    }
    if (result === "TRANSITIONED")
      locks.forEach((lock) => tx.set(lock, { journeyId, updatedAt: now }));
    return result;
  }
  if (context) return execute(context.tx, context.journey);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Journey missing");
    return execute(tx, snap.data() as Journey);
  });
}
export function startJourney(journeyId: string) {
  return transitionJourneyState(journeyId, "RUNNING", Date.now(), {
    source: "ADMIN_MANUAL",
  });
}
export function completeJourney(journeyId: string) {
  return transitionJourneyState(journeyId, "COMPLETED", Date.now(), {
    source: "ADMIN_MANUAL",
  });
}
export function cancelJourney(
  journeyId: string,
  reason: string,
  actorUid: string,
) {
  return transitionJourneyState(journeyId, "CANCELLED", Date.now(), {
    source: "ADMIN_MANUAL",
    reason,
    actorUid,
  });
}
export async function reconcileJourneyReadiness(now = Date.now()) {
  if (!Number.isSafeInteger(now))
    throw new Error("Invalid reconciliation time");
  const candidates = await getFirestore()
    .collection("journeys")
    .where("generationSource", "==", "SCHEDULE")
    .where("status", "==", "SCHEDULED")
    .where("departureMs", ">=", now - READY_RECOVERY_WINDOW_MS)
    .where("departureMs", "<=", now + READY_LEAD_MS)
    .orderBy("departureMs")
    .limit(READY_BATCH_LIMIT)
    .get();
  const summary = {
    inspectedCount: candidates.size,
    readyCount: 0,
    unchangedCount: 0,
    failedCount: 0,
    failures: [] as { journeyId: string; message: string }[],
  };
  for (const candidate of candidates.docs) {
    try {
      const result = await transitionJourneyState(candidate.id, "READY", now);
      if (result === "TRANSITIONED") summary.readyCount++;
      else summary.unchangedCount++;
    } catch (error) {
      summary.failedCount++;
      summary.failures.push({
        journeyId: candidate.id,
        message: error instanceof Error ? error.message : "Transition failed",
      });
    }
  }
  return summary;
}
