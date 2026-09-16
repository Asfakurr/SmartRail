import test from "node:test";
import assert from "node:assert/strict";
import { makeJourney } from "../shared/seed";
import { defaults } from "../shared/domain";
import { ingest, coordinateAt } from "../shared/engine";
import {
  hasDepartureEvidence,
  selectGpsJourney,
  withinAutoStartWindow,
} from "../shared/gps-start";
const j = {
  ...makeJourney(),
  generationSource: "SCHEDULE" as const,
  status: "READY" as const,
};
const device = j.scheduleSnapshot.gpsDeviceIds[0];
function observation(
  distance: number,
  timestamp: number,
  sequence: number,
  previous: ReturnType<typeof ingest> | null = null,
) {
  return ingest(
    j,
    {
      ...coordinateAt(j.route, distance),
      timestamp,
      sequence,
      journeyId: j.id,
      deviceId: device,
      source: "SIMULATOR",
      accuracyM: 8,
    },
    previous,
    timestamp,
  );
}
test("one point, jitter, long gaps and low confidence cannot prove departure", () => {
  const first = observation(0, j.departureMs, 1);
  assert.equal(hasDepartureEvidence(j, null, first, defaults), false);
  const jitter = observation(5, j.departureMs + 10000, 2, first);
  assert.equal(hasDepartureEvidence(j, first, jitter, defaults), false);
  const move = observation(200, j.departureMs + 60000, 2, first);
  assert.equal(hasDepartureEvidence(j, first, move, defaults), true);
  assert.equal(
    hasDepartureEvidence(
      j,
      { ...first, gpsStatus: "LOW_CONFIDENCE" },
      move,
      defaults,
    ),
    false,
  );
  assert.equal(
    hasDepartureEvidence(
      j,
      first,
      {
        ...move,
        timestamp: j.departureMs + defaults.startMaxObservationGapMs + 1,
      },
      defaults,
    ),
    false,
  );
  assert.equal(
    hasDepartureEvidence(
      j,
      first,
      { ...move, timestamp: first.timestamp },
      defaults,
    ),
    false,
  );
  assert.equal(
    hasDepartureEvidence({ ...j, status: "SCHEDULED" }, first, move, defaults),
    false,
  );
  assert.equal(
    hasDepartureEvidence(
      j,
      { ...first, chainageM: 3000 },
      { ...move, chainageM: 3200 },
      defaults,
    ),
    false,
  );
});
for (const [name, offset, allowed] of [
  ["early boundary", -1800000, true],
  ["before early", -1800001, false],
  ["on time", 0, true],
  ["late", 2 * 3600000, true],
  ["late boundary", 6 * 3600000, true],
  ["expired", 6 * 3600000 + 1, false],
] as const)
  test(`start window ${name}`, () =>
    assert.equal(
      withinAutoStartWindow(j, j.departureMs + offset, defaults),
      allowed,
    ));
test("candidate selection respects assignment, ambiguity and RUNNING precedence", () => {
  const point = coordinateAt(j.route, 0),
    second = { ...j, id: "second" };
  assert.equal(
    selectGpsJourney([j], "unrelated", point, j.departureMs, defaults),
    null,
  );
  assert.equal(
    selectGpsJourney([j], device, point, j.departureMs, defaults)?.id,
    j.id,
  );
  assert.throws(
    () => selectGpsJourney([j, second], device, point, j.departureMs, defaults),
    /Ambiguous/,
  );
  assert.equal(
    selectGpsJourney(
      [j, { ...second, status: "RUNNING" }],
      device,
      point,
      j.departureMs,
      defaults,
    )?.id,
    "second",
  );
  assert.throws(() =>
    selectGpsJourney(
      [
        { ...j, status: "RUNNING" },
        { ...second, status: "RUNNING" },
      ],
      device,
      point,
      j.departureMs,
      defaults,
    ),
  );
});
