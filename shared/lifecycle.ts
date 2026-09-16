import type { Journey } from "./domain";
export type JourneyStatus = Journey["status"];
export const READY_LEAD_MS = 30 * 60 * 1000;
const allowed: Record<JourneyStatus, readonly JourneyStatus[]> = {
  SCHEDULED: ["READY", "CANCELLED"],
  READY: ["RUNNING", "CANCELLED"],
  RUNNING: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};
/** Same-state requests are idempotent, including terminal states. */
export function validateJourneyTransition(
  from: JourneyStatus,
  to: JourneyStatus,
): "ALLOWED" | "UNCHANGED" {
  if (!Object.hasOwn(allowed, from) || !Object.hasOwn(allowed, to))
    throw new Error("Unknown journey status");
  if (from === to) return "UNCHANGED";
  if (!allowed[from].includes(to))
    throw new Error(`Invalid journey transition: ${from} -> ${to}`);
  return "ALLOWED";
}
export function readyThreshold(departureMs: number): number {
  if (!Number.isSafeInteger(departureMs))
    throw new Error("Invalid planned departure");
  return departureMs - READY_LEAD_MS;
}
export function isReadyDue(departureMs: number, now: number): boolean {
  if (!Number.isSafeInteger(now))
    throw new Error("Invalid reconciliation time");
  return now >= readyThreshold(departureMs);
}
