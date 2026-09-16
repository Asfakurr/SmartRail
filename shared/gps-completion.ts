import type { Journey, LiveState, Thresholds } from "./domain";
/** Geographic proximity only; operational distance remains configured railway chainage. */
function destinationDistanceM(journey: Journey, live: LiveState) {
  const destination = journey.route.points.at(-1)!;
  const radians = Math.PI / 180;
  const a =
    Math.sin(((live.lat - destination.lat) * radians) / 2) ** 2 +
    Math.cos(live.lat * radians) *
      Math.cos(destination.lat * radians) *
      Math.sin(((live.lng - destination.lng) * radians) / 2) ** 2;
  // Adding matching deviation conservatively bounds the raw fix's distance.
  return (
    6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a))) +
    live.routeDeviationMeters
  );
}
export function hasDestinationEvidence(
  journey: Journey,
  previous: LiveState | null,
  current: LiveState,
  config: Thresholds,
): boolean {
  const qualifies = (live: LiveState) =>
    live.journeyId === journey.id &&
    live.gpsStatus === "VALID" &&
    live.progress >= config.completionMinProgress &&
    destinationDistanceM(journey, live) <= config.completionRadiusM;
  return (
    journey.status === "RUNNING" &&
    !!previous &&
    previous.deviceId === current.deviceId &&
    journey.scheduleSnapshot.gpsDeviceIds.includes(current.deviceId) &&
    current.timestamp > previous.timestamp &&
    current.timestamp - previous.timestamp <=
      config.completionMaxObservationGapMs &&
    qualifies(previous) &&
    qualifies(current)
  );
}
