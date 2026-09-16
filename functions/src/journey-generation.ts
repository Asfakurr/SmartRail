import { reconcileJourneyReadiness } from "./journey-lifecycle";
import { getFirestore } from "firebase-admin/firestore";
import { createJourneySnapshot } from "../../shared/master";
import {
  buildGeneratedJourneyId,
  isScheduleOperatingOnDate,
} from "../../shared/schedule";
import {
  getDhakaServiceDate,
  validateServiceDate,
  type ServiceDate,
} from "../../shared/service-date";
import { loadJourneyMaster, writeJourneySnapshot } from "./master-data";

export interface GenerationSummary {
  serviceDate: ServiceDate;
  eligibleCount: number;
  createdCount: number;
  existingCount: number;
  skippedCount: number;
  failedCount: number;
  failures: { scheduleId: string; message: string }[];
}
/** No RAM checkpoint: deterministic documents are the durable reconciliation state. */
export async function ensureJourneysForServiceDate(
  serviceDate: ServiceDate,
): Promise<GenerationSummary> {
  validateServiceDate(serviceDate);
  const db = getFirestore();
  const schedules = await db.collection("schedules").get();
  const summary: GenerationSummary = {
    serviceDate,
    eligibleCount: 0,
    createdCount: 0,
    existingCount: 0,
    skippedCount: 0,
    failedCount: 0,
    failures: [],
  };
  for (const candidate of schedules.docs) {
    let eligible = false;
    try {
      const id = buildGeneratedJourneyId(candidate.id, serviceDate);
      const outcome = await db.runTransaction(async (tx) => {
        eligible = false;
        const journeyRef = db.doc(`journeys/${id}`);
        // Check history first: subsequent broken/deactivated master edits cannot rewrite it.
        const existing = await tx.get(journeyRef);
        if (existing.exists) {
          const data = existing.data()!;
          if (
            data.generationSource !== "SCHEDULE" ||
            data.serviceDate !== serviceDate ||
            data.scheduleSnapshot?.scheduleId !== candidate.id
          )
            throw new Error(
              "Generated journey ID is occupied by a different journey",
            );
          return "existing" as const;
        }
        const saved = await tx.get(candidate.ref);
        if (!saved.exists) return "skipped" as const;
        const schedule = saved.data()!;
        if (schedule.scheduleId !== candidate.id)
          throw new Error("Schedule document ID mismatch");
        if (
          !isScheduleOperatingOnDate(
            schedule as Parameters<typeof isScheduleOperatingOnDate>[0],
            serviceDate,
          )
        )
          return "skipped" as const;
        eligible = true;
        const bundle = await loadJourneyMaster(tx, candidate.id);
        const journey = createJourneySnapshot(bundle, serviceDate, id);
        journey.generationSource = "SCHEDULE";
        journey.generatedAt = journey.createdAt;
        writeJourneySnapshot(tx, journey);
        return "created" as const;
      });
      if (eligible) summary.eligibleCount++;
      if (outcome === "created") summary.createdCount++;
      else if (outcome === "existing") summary.existingCount++;
      else summary.skippedCount++;
    } catch (error) {
      if (eligible) summary.eligibleCount++;
      summary.failedCount++;
      summary.failures.push({
        scheduleId: candidate.id,
        message: error instanceof Error ? error.message : "Generation failed",
      });
    }
  }
  return summary;
}
/** Thin clock boundary also usable by emulator tests; only today's date is reconciled. */
export function reconcileTodaysJourneys(
  now = Date.now(),
): Promise<GenerationSummary> {
  return ensureJourneysForServiceDate(getDhakaServiceDate(now));
}

/** One periodic run generates today, then repairs readiness across the recovery window. */
export async function reconcileJourneyOperations(now = Date.now()) {
  const generation = await reconcileTodaysJourneys(now);
  const readiness = await reconcileJourneyReadiness(now);
  return { generation, readiness };
}
