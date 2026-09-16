import test from "node:test";
import assert from "node:assert/strict";
import {
  isScheduleOperatingOnDate,
  validateScheduleOperatingRules,
  buildGeneratedJourneyId,
} from "../shared/schedule";
import {
  getDhakaServiceDate,
  getDhakaWeekday,
  scheduleTimeToServiceMinute,
  serviceMinuteToTimestamp,
  scheduledOffsetToTimestamp,
  validateServiceDate,
} from "../shared/service-date";
import { demoMaster } from "../shared/seed";
import { createJourneySnapshot, validateMaster } from "../shared/master";
const rules = {
  active: true,
  operatingDays: [1, 2, 3, 4, 5],
  validFrom: "2026-09-14",
  validTo: "2026-09-18",
};
for (const [name, schedule, date, expected] of [
  ["active on operating weekday", rules, "2026-09-15", true],
  ["inactive", { ...rules, active: false }, "2026-09-15", false],
  ["incorrect weekday", { ...rules, validTo: null }, "2026-09-19", false],
  ["inclusive validFrom", rules, "2026-09-14", true],
  ["before validFrom", rules, "2026-09-11", false],
  ["inclusive validTo", rules, "2026-09-18", true],
  ["after validTo", rules, "2026-09-21", false],
  ["no validTo", { ...rules, validTo: undefined }, "2027-09-14", true],
  ["null validTo", { ...rules, validTo: null }, "2027-09-14", true],
  [
    "legacy unbounded dates",
    { active: true, operatingDays: [1] },
    "2020-01-06",
    true,
  ],
] as const)
  test(`eligibility: ${name}`, () => {
    assert.equal(
      isScheduleOperatingOnDate(
        { ...schedule, operatingDays: [...schedule.operatingDays] },
        date,
      ),
      expected,
    );
  });
test("Dhaka date extraction and midnight use the named timezone", () => {
  assert.equal(
    getDhakaServiceDate(Date.parse("2026-09-14T12:00:00Z")),
    "2026-09-14",
  );
  assert.equal(
    getDhakaServiceDate(Date.parse("2026-09-14T17:59:59.999Z")),
    "2026-09-14",
  );
  assert.equal(
    getDhakaServiceDate(Date.parse("2026-09-14T18:00:00Z")),
    "2026-09-15",
  );
  assert.equal(getDhakaWeekday("2026-09-14"), 1);
  assert.equal(
    getDhakaWeekday(getDhakaServiceDate(Date.parse("2026-09-13T18:00:00Z"))),
    1,
  );
});
test("overnight service minutes and instants remain unambiguous beyond 24 hours", () => {
  assert.equal(scheduleTimeToServiceMinute("23:30"), 1410);
  assert.equal(scheduleTimeToServiceMinute("00:45"), 45);
  assert.equal(scheduleTimeToServiceMinute("00:45", 1), 1485);
  assert.equal(scheduleTimeToServiceMinute("04:15", 1), 1695);
  for (const [minute, iso] of [
    [1410, "2026-09-14T17:30:00.000Z"],
    [1485, "2026-09-14T18:45:00.000Z"],
    [1695, "2026-09-14T22:15:00.000Z"],
    [2925, "2026-09-15T18:45:00.000Z"],
  ] as const)
    assert.equal(
      new Date(serviceMinuteToTimestamp("2026-09-14", minute)).toISOString(),
      iso,
    );
  assert.equal(
    scheduledOffsetToTimestamp("2026-09-14", "23:30", 75 * 60),
    serviceMinuteToTimestamp("2026-09-14", 1485),
  );
});
test("existing snapshot keeps origin service date after overnight arrival", () => {
  const bundle = demoMaster("23:30");
  const journey = createJourneySnapshot(
    bundle,
    "2026-09-14",
    "existing-manual-id",
  );
  assert.equal(journey.serviceDate, "2026-09-14");
  assert.equal(
    getDhakaServiceDate(journey.routePointSnapshots.at(-1)!.scheduledArrivalAt),
    "2026-09-15",
  );
  assert.equal(journey.scheduleSnapshot.scheduleId, bundle.schedule.scheduleId);
});
test("deterministic IDs separate schedules and dates, including the same train", () => {
  const id = buildGeneratedJourneyId("701-outbound-0700", "2026-09-14");
  assert.equal(id, "generated_701-outbound-0700__2026-09-14");
  assert.equal(id, buildGeneratedJourneyId("701-outbound-0700", "2026-09-14"));
  assert.notEqual(
    id,
    buildGeneratedJourneyId("701-outbound-0700", "2026-09-15"),
  );
  assert.notEqual(
    id,
    buildGeneratedJourneyId("701-inbound-1630", "2026-09-14"),
  );
  assert.match(id, /^[a-zA-Z0-9_-]+$/);
  for (const bad of ["", "a/b", "..", "x".repeat(101)])
    assert.throws(() => buildGeneratedJourneyId(bad, "2026-09-14"));
});
test("validation rejects malformed dates, calendars and timetable values", () => {
  for (const date of [
    "2026-02-30",
    "2026-13-01",
    "2026-9-14",
    "0000-01-01",
    "not-a-date",
  ])
    assert.throws(() => validateServiceDate(date));
  validateServiceDate("2024-02-29");
  for (const operatingDays of [[], [-1], [7], [1.5]])
    assert.throws(() =>
      validateScheduleOperatingRules({ ...rules, operatingDays }),
    );
  assert.throws(() =>
    validateScheduleOperatingRules({ ...rules, validTo: "2026-09-13" }),
  );
  assert.throws(() =>
    validateScheduleOperatingRules({ ...rules, validFrom: "2026-02-30" }),
  );
  for (const minute of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(() => serviceMinuteToTimestamp("2026-09-14", minute));
  for (const time of ["24:00", "12:60", "1:00", ""])
    assert.throws(() => scheduleTimeToServiceMinute(time));
  assert.throws(() => scheduleTimeToServiceMinute("12:00", -1));
  assert.throws(() => scheduledOffsetToTimestamp("2026-09-14", "23:30", -1));
  assert.throws(() => getDhakaServiceDate(NaN));
});
test("inactive master configuration can be saved but cannot operate; new bounds enforced centrally", () => {
  const bundle = demoMaster();
  bundle.schedule.active = false;
  validateMaster(bundle);
  assert.throws(() => createJourneySnapshot(bundle, "2026-09-14", "id"));
  bundle.schedule.active = true;
  bundle.schedule.validFrom = "2026-09-15";
  assert.throws(() => createJourneySnapshot(bundle, "2026-09-14", "id"));
  bundle.schedule.validTo = "2026-09-13";
  assert.throws(() => validateMaster(bundle));
});
