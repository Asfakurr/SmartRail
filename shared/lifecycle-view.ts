import type { Journey } from "./domain";
export const passengerStatus: Record<Journey["status"], string> = {
  SCHEDULED: "Scheduled",
  READY: "Awaiting Departure",
  RUNNING: "Tracking active",
  COMPLETED: "Journey Completed",
  CANCELLED: "Service Cancelled",
};
export function isTerminal(status: Journey["status"]) {
  return status === "COMPLETED" || status === "CANCELLED";
}
export function lifecycleActions(status: Journey["status"]): readonly string[] {
  if (status === "SCHEDULED") return ["Cancel"];
  if (status === "READY") return ["Start", "Cancel"];
  if (status === "RUNNING") return ["Complete", "Cancel"];
  return [];
}
