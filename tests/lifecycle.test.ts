import test from "node:test";
import assert from "node:assert/strict";
import {
  validateJourneyTransition,
  readyThreshold,
  isReadyDue,
  type JourneyStatus,
} from "../shared/lifecycle";
import { combineServiceDateAndScheduleTime } from "../shared/service-date";
for (const [from, to] of [
  ["SCHEDULED", "READY"],
  ["SCHEDULED", "CANCELLED"],
  ["READY", "RUNNING"],
  ["READY", "CANCELLED"],
  ["RUNNING", "COMPLETED"],
  ["RUNNING", "CANCELLED"],
] as const)
  test(`transition rule ${from} -> ${to}`, () =>
    assert.equal(validateJourneyTransition(from, to), "ALLOWED"));
test("backward, skipped and terminal transitions are rejected", () => {
  for (const [from, to] of [
    ["READY", "SCHEDULED"],
    ["RUNNING", "READY"],
    ["SCHEDULED", "RUNNING"],
    ["COMPLETED", "READY"],
    ["CANCELLED", "READY"],
    ["COMPLETED", "CANCELLED"],
  ] as const)
    assert.throws(() => validateJourneyTransition(from, to));
});
test("same-state requests are unchanged for every status", () => {
  for (const status of [
    "SCHEDULED",
    "READY",
    "RUNNING",
    "COMPLETED",
    "CANCELLED",
  ] as JourneyStatus[])
    assert.equal(validateJourneyTransition(status, status), "UNCHANGED");
});
const departure = combineServiceDateAndScheduleTime("2026-09-14", "23:30");
test("READY threshold is 23:00 Dhaka for overnight 23:30 departure", () =>
  assert.equal(
    new Date(readyThreshold(departure)).toISOString(),
    "2026-09-14T17:00:00.000Z",
  ));
for (const [label, offset, expected] of [
  ["before threshold", -1800001, false],
  ["at threshold", -1800000, true],
  ["after threshold", -1799999, true],
  ["late departure", 8100000, true],
] as const)
  test(`READY timing ${label}`, () =>
    assert.equal(isReadyDue(departure, departure + offset), expected));
test("malformed transition/timing inputs are rejected", () => {
  assert.throws(() => readyThreshold(NaN));
  assert.throws(() => isReadyDue(departure, Infinity));
  assert.throws(() =>
    validateJourneyTransition("unknown" as JourneyStatus, "READY"),
  );
});
