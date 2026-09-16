import test from "node:test";
import assert from "node:assert/strict";
import { makeJourney } from "../shared/seed";
import { defaults } from "../shared/domain";
import { ingest, coordinateAt } from "../shared/engine";
import { hasDestinationEvidence } from "../shared/gps-completion";
import {
  passengerStatus,
  lifecycleActions,
  isTerminal,
} from "../shared/lifecycle-view";
const journey = {
  ...makeJourney(),
  generationSource: "SCHEDULE" as const,
  status: "RUNNING" as const,
};
const end = journey.route.points.at(-1)!.cumulativeM;
const ping = {
  ...coordinateAt(journey.route, end),
  journeyId: journey.id,
  deviceId: journey.scheduleSnapshot.gpsDeviceIds[0],
  source: "SIMULATOR" as const,
  accuracyM: 8,
  timestamp: journey.departureMs,
  sequence: 1,
};
const first = ingest(journey, ping, null, ping.timestamp);
const second = ingest(
  journey,
  { ...ping, timestamp: ping.timestamp + 3000, sequence: 2 },
  first,
  ping.timestamp + 3000,
);
test("completion requires two valid destination observations", () => {
  assert.equal(hasDestinationEvidence(journey, null, first, defaults), false);
  assert.equal(hasDestinationEvidence(journey, first, second, defaults), true);
});
test("progress and geographic destination proximity are both required", () => {
  assert.equal(
    hasDestinationEvidence(
      journey,
      first,
      { ...second, progress: 0.97 },
      defaults,
    ),
    false,
  );
  assert.equal(
    hasDestinationEvidence(
      journey,
      first,
      { ...second, lat: second.lat + 0.02 },
      defaults,
    ),
    false,
  );
  assert.equal(
    hasDestinationEvidence(
      journey,
      first,
      { ...second, routeDeviationMeters: 751 },
      defaults,
    ),
    false,
  );
});
test("completion cannot use a stale, low confidence, unrelated, reversed or distant observation", () => {
  for (const bad of [
    { ...first, gpsStatus: "STALE" as const },
    { ...first, gpsStatus: "LOW_CONFIDENCE" as const },
    { ...first, deviceId: "other" },
    { ...first, journeyId: "other" },
    { ...first, timestamp: second.timestamp },
    {
      ...first,
      timestamp: second.timestamp - defaults.completionMaxObservationGapMs - 1,
    },
    { ...first, progress: 0.5 },
  ])
    assert.equal(hasDestinationEvidence(journey, bad, second, defaults), false);
});
test("destination jitter alone is only one observation; impossible jumps fail existing validation", () => {
  const originPing = { ...ping, ...coordinateAt(journey.route, 0) };
  const origin = ingest(journey, originPing, null, ping.timestamp);
  assert.throws(
    () =>
      ingest(
        journey,
        { ...ping, timestamp: ping.timestamp + 3000, sequence: 2 },
        origin,
        ping.timestamp + 3000,
      ),
    /Implausible speed/,
  );
  assert.equal(
    hasDestinationEvidence(journey, origin, second, defaults),
    false,
  );
});
test("only RUNNING can complete; terminal GPS never reactivates", () => {
  for (const status of [
    "SCHEDULED",
    "READY",
    "COMPLETED",
    "CANCELLED",
  ] as const) {
    assert.equal(
      hasDestinationEvidence({ ...journey, status }, first, second, defaults),
      false,
    );
    if (isTerminal(status))
      assert.throws(
        () => ingest({ ...journey, status }, ping, null, ping.timestamp),
        /not active/,
      );
  }
});
test("admin action and passenger status mappings cover every lifecycle state", () => {
  assert.deepEqual(lifecycleActions("SCHEDULED"), ["Cancel"]);
  assert.deepEqual(lifecycleActions("READY"), ["Start", "Cancel"]);
  assert.deepEqual(lifecycleActions("RUNNING"), ["Complete", "Cancel"]);
  assert.deepEqual(lifecycleActions("COMPLETED"), []);
  assert.deepEqual(lifecycleActions("CANCELLED"), []);
  assert.equal(passengerStatus.READY, "Awaiting Departure");
  assert.equal(passengerStatus.COMPLETED, "Journey Completed");
  assert.equal(passengerStatus.CANCELLED, "Service Cancelled");
  assert.equal(isTerminal("RUNNING"), false);
});
