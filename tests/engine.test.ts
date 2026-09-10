import test from "node:test";
import assert from "node:assert/strict";
import { makeJourney, route, ticketSubscriptions } from "../shared/seed";
import {
  coordinateAt,
  ingest,
  manualEta,
  notificationsFor,
  validateRoute,
} from "../shared/engine";
import { defaults, journeyId, type GpsPing } from "../shared/domain";
const j = makeJourney();
const ping = (overrides: Partial<GpsPing> = {}): GpsPing => ({
  ...coordinateAt(route, 6000),
  journeyId: j.id,
  deviceId: "primary-1",
  source: "primary",
  timestamp: j.departureMs + 25 * 60000,
  sequence: 1,
  accuracyM: 8,
  ...overrides,
});
test("same-day scheduled departures and directions have distinct identity", () => {
  assert.notEqual(j.id, makeJourney(j.serviceDate, "16:00").id);
  assert.notEqual(
    j.id,
    journeyId("701", j.serviceDate, "08:00", j.routeId, "inbound"),
  );
  assert.throws(() => makeJourney("2026-02-30"));
});
test("route has exact additive numeric chainage, rejects corrupt route", () => {
  validateRoute(route);
  const r = structuredClone(route);
  r.points[2].segmentM = 1;
  assert.throws(() => validateRoute(r));
});
test("GPS snaps to route and ETA uses remaining segment time and intermediate dwell", () => {
  const p = ping();
  const live = ingest(j, p, null, p.timestamp);
  assert.ok(Math.abs(live.chainageM - 6000) < 1);
  const airport = live.predictions.find((x) => x.pointId === "airport")!;
  assert.equal(airport.delayMinutes, 15);
  assert.equal(airport.etaMs, p.timestamp + 16 * 60000);
  assert.equal(live.nextPointId, "airport");
});
test("one alert per recipient journey boarding station, including duplicate sources", () => {
  const p = ping(),
    live = ingest(j, p, null, p.timestamp),
    subs = ticketSubscriptions(j);
  const ids = new Set<string>();
  const alerts = notificationsFor(
    j,
    live,
    [...subs, { ...subs[0], id: "manual-duplicate", source: "manual" }],
    ids,
    10,
  );
  assert.equal(alerts.length, 2);
  assert.equal(notificationsFor(j, live, subs, ids, 10).length, 0);
});
test("below-threshold, expired and passed boarding stations do not alert", () => {
  const p = ping({ timestamp: j.departureMs + 12 * 60000 }),
    live = ingest(j, p, null, p.timestamp);
  assert.equal(
    notificationsFor(j, live, ticketSubscriptions(j), new Set(), 10).length,
    0,
  );
  const late = manualEta.predict(j, 24000, j.departureMs + 80 * 60000);
  const passed = {
    ...live,
    predictions: late,
    timestamp: j.departureMs + 80 * 60000,
  };
  assert.equal(
    notificationsFor(j, passed, ticketSubscriptions(j), new Set(), 10).length,
    1,
  );
  assert.equal(
    notificationsFor(
      j,
      live,
      ticketSubscriptions(j).map((s) => ({ ...s, expiresAt: 0 })),
      new Set(),
      1,
    ).length,
    0,
  );
});
test("invalid fixes, off-route, stale, replay, jumps and reverse movement rejected", () => {
  const p = ping(),
    live = ingest(j, p, null, p.timestamp);
  for (const edit of [
    { lat: NaN },
    { lat: 0 },
    { accuracyM: 500 },
    { timestamp: p.timestamp - 120000 },
    { sequence: -1 },
  ])
    assert.throws(() => ingest(j, ping(edit), null, p.timestamp));
  assert.throws(() => ingest(j, p, live, p.timestamp));
  assert.throws(() =>
    ingest(
      j,
      ping({
        ...coordinateAt(route, 57000),
        timestamp: p.timestamp + 1000,
        sequence: 2,
      }),
      live,
      p.timestamp + 1000,
    ),
  );
  assert.throws(() =>
    ingest(
      j,
      ping({
        ...coordinateAt(route, 0),
        timestamp: p.timestamp + 60000,
        sequence: 2,
      }),
      live,
      p.timestamp + 60000,
    ),
  );
});
test("phone fallback blocked while primary fresh, allowed when stale, primary recovers", () => {
  const p = ping(),
    live = ingest(j, p, null, p.timestamp);
  assert.throws(() =>
    ingest(
      j,
      ping({
        deviceId: "phone",
        source: "phone",
        timestamp: p.timestamp + 30000,
      }),
      live,
      p.timestamp + 30000,
    ),
  );
  const phone = ingest(
    j,
    ping({
      deviceId: "phone",
      source: "phone",
      timestamp: p.timestamp + defaults.primaryStaleMs + 1,
    }),
    live,
    p.timestamp + defaults.primaryStaleMs + 1,
  );
  assert.equal(phone.source, "phone");
  const recovered = ingest(
    j,
    ping({ sequence: 2, timestamp: phone.timestamp + 1000 }),
    phone,
    phone.timestamp + 1000,
  );
  assert.equal(recovered.source, "primary");
});
test("completion suppresses alerts and expired journeys reject ingestion", () => {
  const p = ping({
    ...coordinateAt(route, 91000),
    timestamp: j.departureMs + 180 * 60000,
  });
  const live = ingest(j, p, null, p.timestamp);
  assert.equal(live.completed, true);
  assert.equal(
    notificationsFor(j, live, ticketSubscriptions(j), new Set(), 1).length,
    0,
  );
  assert.throws(() => ingest(j, p, null, j.expiresAt + 1));
});
