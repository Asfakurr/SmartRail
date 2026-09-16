import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { demoMaster } from "../shared/seed";
import { buildGeneratedJourneyId } from "../shared/schedule";
import { getDhakaServiceDate } from "../shared/service-date";
import {
  createFromSavedSchedule,
  saveMaster,
} from "../functions/src/master-data";
import {
  ensureJourneysForServiceDate,
  reconcileTodaysJourneys,
} from "../functions/src/journey-generation";
async function main() {
  assert.equal(
    process.env.FIRESTORE_EMULATOR_HOST,
    "127.0.0.1:8080",
    "Use isolated emulators:exec, never production",
  );
  initializeApp({ projectId: "demo-smartrail-bd" });
  const db = getFirestore();
  assert.equal(
    (await db.collection("schedules").get()).size,
    0,
    "Requires empty test emulator; do not import demo data",
  );
  const date = "2026-09-14"; // Monday
  let version = 0;
  async function master(
    id: string,
    time = "23:30",
    active = true,
    days = [1],
    devices = ["test-device"],
  ) {
    const bundle = demoMaster(time);
    bundle.train.number = "759";
    bundle.train.routeIds = ["generation-route"];
    bundle.route.routeId = "generation-route";
    bundle.route.version = ++version;
    bundle.schedule = {
      ...bundle.schedule,
      scheduleId: id,
      trainNumber: "759",
      routeId: "generation-route",
      gpsDeviceIds: devices,
      active,
      operatingDays: days,
    };
    // Five-hour overnight destination, preserving preceding station order.
    const destination = bundle.schedule.timings.at(-1)!;
    destination.scheduledArrivalOffsetSeconds = 5 * 3600;
    destination.scheduledDepartureOffsetSeconds = 5 * 3600;
    await saveMaster(bundle);
  }
  await master("gen-a");
  await master("gen-b", "07:00", true, [1], []);
  await master("gen-inactive", "08:00", false);
  await master("gen-tuesday", "09:00", true, [2]);
  const manual = await createFromSavedSchedule("gen-a", date);
  const runs = await Promise.all([
    ensureJourneysForServiceDate(date),
    ensureJourneysForServiceDate(date),
  ]);
  assert.equal(
    runs.reduce((n, r) => n + r.createdCount, 0),
    2,
  );
  assert.ok(runs.every((r) => r.failedCount === 0 && r.skippedCount === 2));
  const idA = buildGeneratedJourneyId("gen-a", date),
    idB = buildGeneratedJourneyId("gen-b", date);
  const a = (await db.doc(`journeys/${idA}`).get()).data()!;
  const b = (await db.doc(`journeys/${idB}`).get()).data()!;
  assert.notEqual(a.id, b.id);
  assert.equal(a.trainNumber, b.trainNumber);
  assert.equal(a.status, "SCHEDULED");
  assert.equal(a.generationSource, "SCHEDULE");
  assert.equal(a.generatedAt, a.createdAt);
  assert.equal(a.serviceDate, date);
  assert.equal(
    new Date(a.departureMs).toISOString(),
    "2026-09-14T17:30:00.000Z",
  );
  assert.equal(
    new Date(a.routePointSnapshots.at(-1).scheduledArrivalAt).toISOString(),
    "2026-09-14T22:30:00.000Z",
  );
  assert.equal(
    getDhakaServiceDate(a.routePointSnapshots.at(-1).scheduledArrivalAt),
    "2026-09-15",
  );
  assert.deepEqual(a.scheduleSnapshot.gpsDeviceIds, ["test-device"]);
  assert.deepEqual(b.scheduleSnapshot.gpsDeviceIds, []);
  const pointSnapshots = (
    await db.collection(`journeys/${idA}/routePoints`).get()
  ).docs.map((d) => d.data());
  assert.equal(pointSnapshots.length, 6);
  assert.equal((await db.collection("journeys").get()).size, 3); // two generated plus preserved manual
  for (let i = 0; i < 2; i++) {
    const repeat = await ensureJourneysForServiceDate(date);
    assert.equal(repeat.createdCount, 0);
    assert.equal(repeat.existingCount, 2);
  }
  await db.doc("trains/759").update({ name: "Edited master" });
  await db.doc("routes/generation-route").update({ name: "Edited route" });
  await db
    .doc("schedules/gen-a")
    .update({ scheduledDepartureTime: "22:00", gpsDeviceIds: [], version: 2 });
  await ensureJourneysForServiceDate(date);
  assert.deepEqual((await db.doc(`journeys/${idA}`).get()).data(), a);
  assert.deepEqual(
    (await db.collection(`journeys/${idA}/routePoints`).get()).docs.map((d) =>
      d.data(),
    ),
    pointSnapshots,
  );
  assert.deepEqual(
    (await db.doc(`journeys/${manual.id}`).get()).data(),
    manual,
  );
  // No RAM reset needed: a newly activated missing service is created on the next invocation.
  await db.doc("schedules/gen-inactive").update({ active: true });
  const recovered = await ensureJourneysForServiceDate(date);
  assert.equal(recovered.createdCount, 1);
  assert.equal(recovered.existingCount, 2);
  assert.deepEqual((await db.doc(`journeys/${idB}`).get()).data(), b);
  // A broken schedule must not prevent later valid schedules from succeeding.
  await db
    .doc("schedules/gen-bad")
    .set({
      scheduleId: "gen-bad",
      active: true,
      operatingDays: [1],
      trainNumber: "missing",
      routeId: "missing",
    });
  await master("gen-recovery", "12:00");
  const failed = await ensureJourneysForServiceDate(date);
  assert.equal(failed.failedCount, 1);
  assert.equal(failed.createdCount, 1);
  assert.equal(failed.failures[0].scheduleId, "gen-bad");
  const badId = buildGeneratedJourneyId("gen-bad", date);
  assert.equal((await db.doc(`journeys/${badId}`).get()).exists, false);
  assert.equal(
    (await db.collection(`journeys/${badId}/routePoints`).get()).size,
    0,
  );
  // Existing generated history survives even invalid subsequent master fields.
  await db.doc("schedules/gen-a").update({ operatingDays: [99] });
  const preserved = await ensureJourneysForServiceDate(date);
  assert.equal(preserved.failedCount, 1);
  assert.deepEqual((await db.doc(`journeys/${idA}`).get()).data(), a);
  // Clock boundary: this UTC Sunday instant is Monday in Dhaka; no future window.
  const today = await reconcileTodaysJourneys(
    Date.parse("2026-09-13T18:01:00Z"),
  );
  assert.equal(today.serviceDate, date);
  assert.ok(
    (await db.collection("journeys").get()).docs.every(
      (d) => d.data().serviceDate === date,
    ),
  );
  await assert.rejects(() => ensureJourneysForServiceDate("2026-02-30"));
  console.log(
    "PASS generation: concurrent atomic creation, eligibility, multiple same-train services, repeat/restart recovery, activation, frozen snapshots, manual compatibility, overnight timestamps, optional devices, failure isolation and today-only Dhaka reconciliation.",
  );
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
