import type { Journey, LiveState, Thresholds } from "./domain";
export function liveProjection(
  journey: Journey,
  live: LiveState,
  config: Thresholds,
) {
  const next = journey.route.points.find((p) => p.id === live.nextPointId);
  const previous = [...journey.route.points]
    .reverse()
    .find((p) => p.cumulativeM <= live.chainageM);
  const segment = journey.routeSnapshot.segments.find(
    (s) => s.endDistanceMeters > live.chainageM,
  );
  return {
    journeyId: journey.id,
    revision: live.timestamp,
    position: {
      latitude: live.lat,
      longitude: live.lng,
      speedKph: live.speedKph,
      heading: live.heading,
      accuracyMeters: live.accuracyMeters,
      timestamp: live.timestamp,
    },
    tracking: {
      activeSource: live.source,
      deviceId: live.deviceId,
      lastSeenAt: live.timestamp,
      confidence: live.confidence,
      routeDeviationMeters: live.routeDeviationMeters,
      gpsStatus: live.gpsStatus,
      primaryDeviceHealthy:
        live.source === "DEDICATED_GNSS_CELLULAR" &&
        live.timestamp - live.primaryLastSeen < config.primaryStaleMs,
    },
    progress: {
      distanceFromOriginMeters: live.chainageM,
      totalRouteDistanceMeters: journey.route.points.at(-1)!.cumulativeM,
      progressPercent: live.progress * 100,
      currentSegmentId: segment?.segmentId || null,
      previousPointId: previous?.id || null,
      nextPointId: next?.id || null,
      distanceToNextPointMeters: next
        ? Math.max(0, next.cumulativeM - live.chainageM)
        : 0,
    },
    stationPredictions: Object.fromEntries(
      live.predictions.map((p) => [
        p.pointId,
        {
          predictedArrivalAt: p.etaMs,
          scheduledArrivalAt: p.scheduledMs,
          delaySeconds: p.delaySeconds,
          delayMinutes: p.delayMinutes,
          status: p.passed ? "PASSED" : live.completed ? "ARRIVED" : "UPCOMING",
          confidence: live.confidence,
          updatedAt: live.timestamp,
        },
      ]),
    ),
    completed: live.completed,
  };
}
export type PublicLive = ReturnType<typeof liveProjection>;
// Compatibility adapter keeps the existing passenger map/view; canonical RTDB stays nested.
export function toLiveView(value: PublicLive, journey: Journey): LiveState {
  return {
    journeyId: journey.id,
    lat: value.position.latitude,
    lng: value.position.longitude,
    timestamp: value.position.timestamp,
    sequence: 0,
    deviceId: value.tracking.deviceId,
    source: value.tracking.activeSource,
    primaryLastSeen: 0,
    chainageM: value.progress.distanceFromOriginMeters,
    progress: value.progress.progressPercent / 100,
    nextPointId: value.progress.nextPointId,
    speedKph: value.position.speedKph,
    smoothedSpeedKph: value.position.speedKph,
    speedSamples: [],
    heading: value.position.heading,
    accuracyMeters: value.position.accuracyMeters,
    confidence: value.tracking.confidence,
    routeDeviationMeters: value.tracking.routeDeviationMeters,
    gpsStatus: value.tracking.gpsStatus,
    predictions: journey.route.points.flatMap((point) => {
      const p = value.stationPredictions?.[point.id];
      return p
        ? [
            {
              pointId: point.id,
              scheduledMs: p.scheduledArrivalAt,
              etaMs: p.predictedArrivalAt,
              delayMinutes: p.delayMinutes,
              delaySeconds: p.delaySeconds,
              passed: p.status === "PASSED",
              confidence: p.confidence,
            },
          ]
        : [];
    }),
    completed: value.completed,
  };
}
