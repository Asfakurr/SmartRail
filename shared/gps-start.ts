import type { Journey, LiveState, Thresholds, Coordinate } from "./domain";
import { READY_LEAD_MS } from "./lifecycle";
import { matchRoute } from "./engine";
export function withinAutoStartWindow(
  journey: Journey,
  timestamp: number,
  config: Thresholds,
) {
  return (
    timestamp >= journey.departureMs - READY_LEAD_MS &&
    timestamp <= journey.departureMs + config.autoStartLateMs
  );
}
export function hasDepartureEvidence(
  journey: Journey,
  previous: LiveState | null,
  current: LiveState,
  config: Thresholds,
): boolean {
  return (
    journey.status === "READY" &&
    !!previous &&
    current.gpsStatus === "VALID" &&
    previous.gpsStatus === "VALID" &&
    previous.deviceId === current.deviceId &&
    previous.journeyId === journey.id &&
    current.journeyId === journey.id &&
    journey.scheduleSnapshot.gpsDeviceIds.includes(current.deviceId) &&
    withinAutoStartWindow(journey, previous.timestamp, config) &&
    withinAutoStartWindow(journey, current.timestamp, config) &&
    current.timestamp > previous.timestamp &&
    current.timestamp - previous.timestamp <= config.startMaxObservationGapMs &&
    previous.chainageM <= config.startMaxOriginProgressM &&
    current.chainageM - previous.chainageM >= config.startMinProgressM
  );
}
/** Existing RUNNING assignment wins; multiple plausible candidates never use nearest-time guessing. */
export function selectGpsJourney(
  journeys: Journey[],
  deviceId: string,
  point: Coordinate,
  timestamp: number,
  config: Thresholds,
): Journey | null {
  const assigned = journeys.filter((j) =>
    j.scheduleSnapshot.gpsDeviceIds.includes(deviceId),
  );
  const running = assigned.filter((j) => j.status === "RUNNING");
  if (running.length > 1)
    throw new Error("Ambiguous RUNNING device assignment");
  if (running.length === 1) return running[0];
  const ready = assigned.filter(
    (j) =>
      j.generationSource === "SCHEDULE" &&
      j.status === "READY" &&
      withinAutoStartWindow(j, timestamp, config) &&
      matchRoute(point, j.route).distanceM <= config.maxOffRouteM,
  );
  if (ready.length > 1)
    throw new Error("Ambiguous READY candidates; manual Start required");
  return ready[0] ?? null;
}
