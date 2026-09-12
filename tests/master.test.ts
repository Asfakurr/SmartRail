import test from "node:test";
import assert from "node:assert/strict";
import { demoMaster, makeJourney } from "../shared/seed";
import { createJourneySnapshot, validateMaster } from "../shared/master";
import { coordinateAt, ingest, manualEta } from "../shared/engine";
import { defaults } from "../shared/domain";
test("generated journey ID is independent of stable business key and snapshot changes", () => {
  const master = demoMaster(),
    j = createJourneySnapshot(master, "2026-09-12", "generated-1");
  assert.equal(
    j.businessKey,
    "701__2026-09-12__0800__dhaka-bhairab-demo__outbound",
  );
  master.train.name = "changed";
  master.route.points[2].name = "changed station";
  master.schedule.timings[2].scheduledArrivalOffsetSeconds += 600;
  assert.notEqual(j.trainSnapshot.name, master.train.name);
  assert.notEqual(j.routePointSnapshots[2].name, master.route.points[2].name);
  assert.equal(
    j.routePointSnapshots[2].scheduledArrivalAt,
    j.departureMs + 26 * 60000,
  );
});
test("schedule calendars, segments and offset coverage validated", () => {
  const master = demoMaster();
  master.schedule.operatingDays = [1];
  assert.throws(() => createJourneySnapshot(master, "2026-09-12", "id"));
  master.schedule.operatingDays = [0, 1, 2, 3, 4, 5, 6];
  master.route.segments[0].distanceMeters = 5;
  assert.throws(() => validateMaster(master));
});
test("bounded speed adjustment changes current segment only", () => {
  const j = makeJourney();
  const slow = manualEta.predict(j, 6000, j.departureMs, 1, defaults),
    fast = manualEta.predict(j, 6000, j.departureMs, 300, defaults);
  assert.equal(
    slow[2].etaMs - j.departureMs,
    16 * 60000 * defaults.etaMaxFactor,
  );
  assert.equal(
    fast[2].etaMs - j.departureMs,
    16 * 60000 * defaults.etaMinFactor,
  );
  assert.equal(slow[4].etaMs - slow[2].etaMs, fast[4].etaMs - fast[2].etaMs);
});
test("recent speed is smoothed; simulator cannot override healthy dedicated primary", () => {
  const j = makeJourney();
  const t = j.departureMs + 60000;
  const first = ingest(
    j,
    {
      ...coordinateAt(j.route, 0),
      journeyId: j.id,
      deviceId: "gnss",
      source: "DEDICATED_GNSS_CELLULAR",
      timestamp: t,
      sequence: 1,
      accuracyM: 5,
    },
    null,
    t,
  );
  assert.throws(() =>
    ingest(
      j,
      {
        ...coordinateAt(j.route, 500),
        journeyId: j.id,
        deviceId: "sim",
        source: "SIMULATOR",
        timestamp: t + 60000,
        sequence: 1,
        accuracyM: 5,
      },
      first,
      t + 60000,
    ),
  );
  const next = ingest(
    j,
    {
      ...coordinateAt(j.route, 600),
      journeyId: j.id,
      deviceId: "gnss",
      source: "DEDICATED_GNSS_CELLULAR",
      timestamp: t + 60000,
      sequence: 2,
      accuracyM: 5,
    },
    first,
    t + 60000,
  );
  assert.ok(Math.abs(next.smoothedSpeedKph - 36) < 0.01);
  assert.throws(() =>
    ingest(
      { ...j, status: "CANCELLED" },
      {
        ...coordinateAt(j.route, 600),
        journeyId: j.id,
        deviceId: "gnss",
        source: "DEDICATED_GNSS_CELLULAR",
        timestamp: t + 60000,
        sequence: 2,
        accuracyM: 5,
      },
      null,
      t + 60000,
    ),
  );
});
