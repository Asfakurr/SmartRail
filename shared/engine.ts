import {
  defaults,
  type Coordinate,
  type EtaProvider,
  type GpsPing,
  type Journey,
  type LiveState,
  type Notification,
  type Route,
  type Subscription,
  type Thresholds,
} from "./domain";
export function validateRoute(route: Route) {
  if (
    route.points.length < 2 ||
    route.points[0].kind !== "origin" ||
    route.points.at(-1)?.kind !== "destination"
  )
    throw new Error("Route requires origin and destination");
  let cumulative = 0;
  const ids = new Set<string>();
  route.points.forEach((p, i) => {
    if (
      ![
        p.lat,
        p.lng,
        p.segmentM,
        p.cumulativeM,
        p.segmentMinutes,
        p.dwellMinutes,
      ].every(Number.isFinite) ||
      Math.abs(p.lat) > 90 ||
      Math.abs(p.lng) > 180 ||
      (i === 0 && (p.segmentMinutes !== 0 || p.cumulativeM !== 0))
    )
      throw new Error("Invalid route numbers");
    cumulative += p.segmentM;
    if (
      ids.has(p.id) ||
      !Number.isFinite(p.cumulativeM) ||
      p.cumulativeM !== cumulative ||
      (i === 0 && p.segmentM !== 0) ||
      (i > 0 && (p.segmentM <= 0 || p.segmentMinutes <= 0)) ||
      p.dwellMinutes < 0
    )
      throw new Error("Invalid route distances/times");
    ids.add(p.id);
  });
  if (
    route.geometry.length < 2 ||
    route.geometry[0].chainageM !== 0 ||
    route.geometry.at(-1)?.chainageM !== cumulative
  )
    throw new Error("Geometry must cover route chainage");
  route.geometry.forEach((p, i) => {
    if (
      !Number.isFinite(p.lat) ||
      Math.abs(p.lat) > 90 ||
      !Number.isFinite(p.lng) ||
      Math.abs(p.lng) > 180 ||
      (i > 0 && p.chainageM <= route.geometry[i - 1].chainageM)
    )
      throw new Error("Invalid geometry");
  });
}
export function matchRoute(point: Coordinate, route: Route) {
  let best = { distanceM: Infinity, chainageM: 0, lat: 0, lng: 0 };
  const scaleX = 111320 * Math.cos((point.lat * Math.PI) / 180),
    scaleY = 111320;
  for (let i = 1; i < route.geometry.length; i++) {
    const a = route.geometry[i - 1],
      b = route.geometry[i];
    const dx = (b.lng - a.lng) * scaleX,
      dy = (b.lat - a.lat) * scaleY;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point.lng - a.lng) * scaleX * dx +
          (point.lat - a.lat) * scaleY * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
    const lat = a.lat + (b.lat - a.lat) * t,
      lng = a.lng + (b.lng - a.lng) * t;
    const distanceM = Math.hypot(
      (point.lng - lng) * scaleX,
      (point.lat - lat) * scaleY,
    );
    if (distanceM < best.distanceM)
      best = {
        distanceM,
        lat,
        lng,
        chainageM: a.chainageM + (b.chainageM - a.chainageM) * t,
      };
  }
  return best;
}
export const manualEta: EtaProvider = {
  version: "manual-v1",
  predict(journey, chainageM, timestamp, speedKph, config = defaults) {
    const points = journey.route.points;
    let scheduledMinutes = 0;
    return points.map((p, i) => {
      scheduledMinutes +=
        p.segmentMinutes + (i > 0 ? points[i - 1].dwellMinutes : 0);
      const scheduledMs = journey.routePointSnapshots[i].scheduledArrivalAt;
      let remaining = 0;
      for (let j = 1; j <= i; j++) {
        const end = points[j],
          start = points[j - 1];
        if (end.cumulativeM > chainageM) {
          const current = start.cumulativeM <= chainageM;
          const expectedSpeed =
            (end.segmentM / (end.segmentMinutes * 60)) * 3.6;
          const factor =
            current && speedKph !== undefined
              ? Math.min(
                  config.etaMaxFactor,
                  Math.max(
                    config.etaMinFactor,
                    expectedSpeed / Math.max(1, speedKph),
                  ),
                )
              : 1;
          remaining +=
            end.segmentMinutes *
            Math.min(1, (end.cumulativeM - chainageM) / end.segmentM) *
            factor;
        }
        if (start.cumulativeM >= chainageM && j > 1)
          remaining += start.dwellMinutes;
      }
      const passed = p.cumulativeM < chainageM || (i === 0 && chainageM > 0);
      const etaMs = passed ? scheduledMs : timestamp + remaining * 60000;
      return {
        pointId: p.id,
        delaySeconds: passed ? 0 : Math.max(0, (etaMs - scheduledMs) / 1000),
        confidence: speedKph === undefined ? 0.65 : 0.75,
        scheduledMs,
        etaMs,
        delayMinutes: passed
          ? 0
          : Math.max(0, Math.round((etaMs - scheduledMs) / 60000)),
        passed,
      };
    });
  },
};
export function ingest(
  journey: Journey,
  ping: GpsPing,
  previous: LiveState | null,
  now: number,
  config: Thresholds = defaults,
): LiveState {
  if (
    ["COMPLETED", "CANCELLED"].includes(journey.status) ||
    now < journey.departureMs ||
    now > journey.expiresAt ||
    ping.journeyId !== journey.id
  )
    throw new Error("Journey is not active");
  if (
    !Number.isFinite(ping.lat) ||
    Math.abs(ping.lat) > 90 ||
    !Number.isFinite(ping.lng) ||
    Math.abs(ping.lng) > 180 ||
    !Number.isFinite(ping.accuracyM) ||
    ping.accuracyM < 0 ||
    ping.accuracyM > config.maxAccuracyM
  )
    throw new Error("Invalid GPS fix");
  if (
    !Number.isSafeInteger(ping.sequence) ||
    ping.sequence < 0 ||
    !Number.isSafeInteger(ping.timestamp) ||
    Math.abs(now - ping.timestamp) > config.timestampToleranceMs
  )
    throw new Error("Stale or invalid timestamp/sequence");
  if (
    previous &&
    (ping.timestamp <= previous.timestamp ||
      (ping.deviceId === previous.deviceId &&
        ping.sequence <= previous.sequence))
  )
    throw new Error("Replay or out-of-order GPS");
  if (
    ping.source === "OPERATOR_PHONE" &&
    now - (previous?.primaryLastSeen || journey.departureMs) <
      config.primaryStaleMs
  )
    throw new Error("Primary source is still fresh");
  if (ping.source === "SIMULATOR" && !journey.simulated)
    throw new Error("Simulator requires a simulated journey");
  if (
    ping.source === "SIMULATOR" &&
    previous?.source === "DEDICATED_GNSS_CELLULAR" &&
    now - previous.primaryLastSeen < config.primaryStaleMs
  )
    throw new Error("Dedicated primary is still healthy");
  const match = matchRoute(ping, journey.route);
  if (match.distanceM > config.maxOffRouteM)
    throw new Error("GPS is off route");
  if (previous) {
    const delta = match.chainageM - previous.chainageM;
    if (delta < -config.backwardToleranceMeters)
      throw new Error("GPS reverses route direction");
    if (
      (Math.abs(delta) / (ping.timestamp - previous.timestamp)) * 3600 >
      config.maxSpeedKmh
    )
      throw new Error("Implausible speed");
  }
  const chainageM = Math.max(previous?.chainageM || 0, match.chainageM);
  const total = journey.route.points.at(-1)!.cumulativeM;
  const speedKph = previous
    ? Math.max(
        0,
        ((chainageM - previous.chainageM) /
          (ping.timestamp - previous.timestamp)) *
          3600,
      )
    : 0;
  const speedSamples = [
    ...(previous?.speedSamples || []).filter(
      (s) => ping.timestamp - s.timestamp <= config.recentSpeedWindowMs,
    ),
    ...(previous ? [{ timestamp: ping.timestamp, speedKph }] : []),
  ].slice(-60);
  const smoothedSpeedKph = speedSamples.length
    ? speedSamples.reduce((sum, s) => sum + s.speedKph, 0) / speedSamples.length
    : 0;
  const heading = previous
    ? ((Math.atan2(
        (match.lng - previous.lng) * Math.cos((match.lat * Math.PI) / 180),
        match.lat - previous.lat,
      ) *
        180) /
        Math.PI +
        360) %
      360
    : 0;
  return {
    journeyId: journey.id,
    speedKph,
    smoothedSpeedKph,
    speedSamples,
    heading,
    accuracyMeters: ping.accuracyM,
    routeDeviationMeters: match.distanceM,
    confidence: Math.max(
      0.3,
      1 -
        (match.distanceM / config.maxOffRouteM) * 0.5 -
        (ping.accuracyM / config.maxAccuracyM) * 0.2,
    ),
    gpsStatus:
      match.distanceM > config.maxOffRouteM * 0.75 ? "LOW_CONFIDENCE" : "VALID",
    lat: match.lat,
    lng: match.lng,
    timestamp: ping.timestamp,
    sequence: ping.sequence,
    deviceId: ping.deviceId,
    source: ping.source,
    primaryLastSeen:
      ping.source !== "OPERATOR_PHONE"
        ? ping.timestamp
        : previous?.primaryLastSeen || 0,
    chainageM,
    progress: Math.min(1, chainageM / total),
    nextPointId:
      journey.route.points.find((p) => p.cumulativeM > chainageM)?.id || null,
    predictions: manualEta.predict(
      journey,
      chainageM,
      ping.timestamp,
      speedSamples.length ? smoothedSpeedKph : undefined,
      config,
    ),
    completed: chainageM >= total - 1,
  };
}
export function notificationsFor(
  journey: Journey,
  live: LiveState,
  subscriptions: Subscription[],
  existingIds: Set<string>,
  threshold: number,
): Notification[] {
  if (live.completed) return [];
  return subscriptions.flatMap((s) => {
    const p = live.predictions.find((p) => p.pointId === s.boardingPointId);
    const station = journey.route.points.find(
      (p) => p.id === s.boardingPointId,
    );
    // One alert per recipient, journey and boarding station, including ticket/manual overlap.
    const id = `${journey.id}_${s.boardingPointId}_${s.phone.replace(/\D/g, "")}_DELAY_ALERT`;
    if (
      s.journeyId !== journey.id ||
      !s.active ||
      s.expiresAt <= live.timestamp ||
      !p ||
      p.passed ||
      !station ||
      !(
        station.passengerBoardingAllowed ??
        ["origin", "passenger_halt"].includes(station.kind)
      ) ||
      p.delaySeconds < threshold * 60 ||
      existingIds.has(id)
    )
      return [];
    existingIds.add(id);
    return [
      {
        id,
        notificationType: "DELAY_ALERT",
        journeyId: journey.id,
        subscriptionId: s.id,
        boardingPointId: s.boardingPointId,
        delayMinutes: p.delayMinutes,
        phone: s.phone,
        message: `SmartRail BD demo: Train ${journey.trainNumber} is predicted ${p.delayMinutes} min late at ${station.name}. This is a simulated alert, not an official railway message.`,
        createdAt: live.timestamp,
        status: "mock_sent" as const,
      },
    ];
  });
}
export function coordinateAt(route: Route, chainageM: number): Coordinate {
  const end = route.geometry.findIndex((p) => p.chainageM >= chainageM);
  if (end <= 0) {
    const point = end === 0 ? route.geometry[0] : route.geometry.at(-1)!;
    return { lat: point.lat, lng: point.lng };
  }
  const a = route.geometry[end - 1],
    b = route.geometry[end],
    t = (chainageM - a.chainageM) / (b.chainageM - a.chainageM);
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}
