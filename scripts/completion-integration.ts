import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { getDatabase } from "firebase-admin/database";
import { seed } from "./seed";
import { demoMaster } from "../shared/seed";
import { createJourneySnapshot } from "../shared/master";
import { coordinateAt } from "../shared/engine";
import { getDhakaServiceDate } from "../shared/service-date";
import type { Journey } from "../shared/domain";
import { ensureJourneysForServiceDate } from "../functions/src/journey-generation";
import { transitionJourneyState } from "../functions/src/journey-lifecycle";
import { saveMaster } from "../functions/src/master-data";
import { buildGeneratedJourneyId } from "../shared/schedule";
import { markStaleGps } from "../functions/src/stale";
async function main() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  await seed();
  const db = getFirestore(),
    key = "terminal-test-key";
  const login = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@smartrail.test",
        password: "DemoRail2026!",
        returnSecureToken: true,
      }),
    },
  ).then((r) => r.json());
  async function call(path: string, body: unknown, auth = true) {
    const response = await fetch(
      "http://127.0.0.1:5001/demo-smartrail-bd/asia-south1/api" + path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-key": key,
          ...(auth ? { Authorization: `Bearer ${login.idToken}` } : {}),
        },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  }
  async function fixture(
    label: string,
    deviationMinutes = 0,
    status: Journey["status"] = "READY",
    deviceId = `terminal-${label}`,
  ) {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const bundle = demoMaster();
    bundle.schedule.gpsDeviceIds = [deviceId];
    const j = createJourneySnapshot(
      bundle,
      getDhakaServiceDate(now),
      `terminal-${label}`,
    );
    const departure = now - deviationMinutes * 60000,
      delta = departure - j.departureMs;
    j.routePointSnapshots.forEach((p) => {
      p.scheduledArrivalAt += delta;
      p.scheduledDepartureAt += delta;
    });
    j.departureMs = departure;
    j.expiresAt = departure + 3 * 86400000;
    j.status = status;
    j.generationSource = "SCHEDULE";
    await db.doc(`journeys/${j.id}`).create(j);
    await db.doc(`gpsDevices/${deviceId}`).set({
      id: deviceId,
      trainNumber: "701",
      active: true,
      source: "DEDICATED_GNSS_CELLULAR",
      keyHash: createHash("sha256").update(key).digest("hex"),
    });
    return { j, now, deviceId };
  }
  function ping(
    f: Awaited<ReturnType<typeof fixture>>,
    distance: number,
    timestamp: number,
    sequence: number,
  ) {
    return {
      ...coordinateAt(f.j.route, distance),
      journeyId: f.j.id,
      deviceId: f.deviceId,
      source: "DEDICATED_GNSS_CELLULAR",
      accuracyM: 8,
      timestamp,
      sequence,
    };
  }
  async function data(id: string) {
    return (await db.doc(`journeys/${id}`).get()).data()!;
  }
  async function ok(path: string, body: unknown) {
    const r = await call(path, body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  }
  async function assertClean(j: Journey) {
    const saved = await data(j.id);
    assert.deepEqual(saved.scheduleSnapshot, j.scheduleSnapshot);
    assert.deepEqual(saved.routeSnapshot, j.routeSnapshot);
    assert.deepEqual(saved.routePointSnapshots, j.routePointSnapshots);
    assert.equal(saved.serviceDate, j.serviceDate);
    assert.equal(saved.departureMs, j.departureMs);
    const subs = await db
      .collection("subscriptions")
      .where("journeyId", "==", j.id)
      .get();
    assert.ok(subs.docs.every((s) => !s.data().active));
    for (const device of j.scheduleSnapshot.gpsDeviceIds)
      assert.notEqual(
        (await db.doc(`deviceStartLocks/${device}`).get()).data()?.journeyId,
        j.id,
      );
  }
  // Saved configuration -> actual generator -> readiness -> GPS start -> whole route -> completion.
  const bundle = demoMaster("08:00");
  bundle.route.version =
    (await db.doc(`routes/${bundle.route.routeId}`).get()).data()!.version + 1;
  bundle.schedule.scheduleId = "terminal-demo";
  bundle.schedule.gpsDeviceIds = ["terminal-simulator"];
  await saveMaster(bundle);
  await db
    .doc("gpsDevices/terminal-simulator")
    .set({
      id: "terminal-simulator",
      trainNumber: "701",
      active: true,
      source: "SIMULATOR",
    });
  const date = getDhakaServiceDate(Date.now());
  const generation = await ensureJourneysForServiceDate(date);
  assert.equal(generation.failedCount, 0, JSON.stringify(generation));
  const id = buildGeneratedJourneyId("terminal-demo", date);
  const generated = (await data(id)) as Journey;
  assert.equal(generated.status, "SCHEDULED");
  await transitionJourneyState(id, "READY", generated.departureMs - 1800000);
  assert.equal((await data(id)).status, "READY");
  await ok("/mock-tickets", { journeyId: id });
  assert.equal(
    (await db.collection("subscriptions").where("journeyId", "==", id).get())
      .size,
    2,
  );
  let last: any;
  let destinationFixes = 0;
  for (let step = 0; step < 60; step++) {
    last = (
      await ok("/simulate", {
        journeyId: id,
        action: step === 3 ? "HOLD" : "STEP",
      })
    ).live;
    if (step === 0) assert.equal((await data(id)).status, "READY");
    if (step === 1) assert.equal((await data(id)).status, "RUNNING");
    if (step === 4) assert.ok(Object.keys(last.stationPredictions).length > 0);
    if (last.progress.progressPercent >= 99.9) {
      destinationFixes++;
      if (destinationFixes === 1)
        assert.equal((await data(id)).status, "RUNNING");
    }
    if (last.completed) break;
  }
  assert.ok(last.completed && destinationFixes >= 2);
  const done = await data(id);
  assert.equal(done.status, "COMPLETED");
  assert.equal(done.actualArrivalAt, last.position.timestamp);
  assert.equal(done.transitionSource, "GPS_AUTO");
  const alerts = await db
    .collection("notifications")
    .where("journeyId", "==", id)
    .get();
  assert.ok(alerts.size > 0, "delayed ticket passengers receive mock alerts");
  assert.equal(
    new Set(alerts.docs.map((d) => d.data().phone + d.data().boardingPointId))
      .size,
    alerts.size,
  );
  assert.equal(
    (await call("/simulate", { journeyId: id, action: "STEP" })).status,
    400,
  );
  assert.equal((await call("/mock-tickets", { journeyId: id })).status, 400);
  assert.equal((await data(id)).actualArrivalAt, done.actualArrivalAt);
  await assertClean(generated);
  const expectedRevision = (await db.doc(`liveInternal/${id}`).get()).data()!
    .revision;
  let projected: any;
  for (let i = 0; i < 60; i++) {
    projected = (await getDatabase().ref(`liveJourneys/${id}`).get()).val();
    if (projected?.revision >= expectedRevision) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(projected?.revision >= expectedRevision);
  assert.equal(projected.completed, true);
  assert.equal(Object.keys(projected.stationPredictions || {}).length, 0);

  const manual = await fixture("manual");
  await ok("/start-journey", { journeyId: manual.j.id });
  // GPS loss does not prove arrival.
  await ok("/gps", ping(manual, 0, manual.now, 1));
  await markStaleGps(Date.now() + 600000);
  assert.equal((await data(manual.j.id)).status, "RUNNING");
  await ok("/mock-tickets", { journeyId: manual.j.id });
  const before = Date.now();
  await ok("/complete-journey", { journeyId: manual.j.id });
  const completed = await data(manual.j.id);
  assert.ok(
    completed.actualArrivalAt >= before &&
      completed.actualArrivalAt <= Date.now(),
  );
  assert.equal(completed.transitionSource, "ADMIN_MANUAL");
  assert.equal(
    (await ok("/complete-journey", { journeyId: manual.j.id })).result,
    "UNCHANGED",
  );
  assert.equal(
    (await data(manual.j.id)).actualArrivalAt,
    completed.actualArrivalAt,
  );
  await assertClean(manual.j);
  const next = await fixture("after-complete", 0, "READY", manual.deviceId);
  await ok("/start-journey", { journeyId: next.j.id });
  assert.equal((await data(next.j.id)).status, "RUNNING");

  for (const status of ["SCHEDULED", "READY", "RUNNING"] as const) {
    const f = await fixture(
      `cancel-${status}`,
      0,
      status === "RUNNING" ? "READY" : status,
    );
    if (status === "RUNNING") await ok("/start-journey", { journeyId: f.j.id });
    await ok("/mock-tickets", { journeyId: f.j.id });
    assert.equal(
      (await call("/cancel-journey", { journeyId: f.j.id, reason: " " }))
        .status,
      400,
    );
    assert.equal(
      (
        await call(
          "/cancel-journey",
          { journeyId: f.j.id, reason: "test" },
          false,
        )
      ).status,
      401,
    );
    await ok("/cancel-journey", {
      journeyId: f.j.id,
      reason: "Demo cancellation",
    });
    const cancelled = await data(f.j.id);
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.cancellationReason, "Demo cancellation");
    assert.ok(cancelled.cancelledAt && cancelled.cancelledBy);
    assert.equal(cancelled.actualArrivalAt, undefined);
    assert.equal(
      (await ok("/cancel-journey", { journeyId: f.j.id, reason: "different" }))
        .result,
      "UNCHANGED",
    );
    assert.equal((await data(f.j.id)).cancellationReason, "Demo cancellation");
    assert.equal(
      (await call("/start-journey", { journeyId: f.j.id })).status,
      400,
    );
    assert.equal((await call("/gps", ping(f, 0, f.now, 1))).status, 400);
    assert.equal(
      (await call("/mock-tickets", { journeyId: f.j.id })).status,
      400,
    );
    await assertClean(f.j);
    const replacement = await fixture(
      `replacement-${status}`,
      0,
      "READY",
      f.deviceId,
    );
    await ok("/start-journey", { journeyId: replacement.j.id });
  }
  for (const race of [
    "auto-manual",
    "complete-cancel",
    "auto-cancel",
  ] as const) {
    const f = await fixture(race, 0, "RUNNING");
    const end = f.j.route.points.at(-1)!.cumulativeM;
    await ok("/gps", ping(f, end, f.now - 10000, 1));
    assert.equal((await data(f.j.id)).status, "RUNNING");
    const responses = await Promise.all([
      race === "complete-cancel"
        ? call("/complete-journey", { journeyId: f.j.id })
        : call("/gps", ping(f, end, f.now, 2)),
      race === "auto-manual"
        ? call("/complete-journey", { journeyId: f.j.id })
        : call("/cancel-journey", { journeyId: f.j.id, reason: "Race test" }),
      call("/mock-tickets", { journeyId: f.j.id }),
      call("/subscribe", {
        journeyId: f.j.id,
        boardingPointId: "airport",
        phone: "+8801000000003",
      }),
    ]);
    assert.ok(responses.slice(0, 2).some((r) => r.status === 200));
    assert.ok(
      responses.every((r) => [200, 400].includes(r.status)),
      JSON.stringify(responses),
    );
    const result = await data(f.j.id);
    assert.ok(["COMPLETED", "CANCELLED"].includes(result.status));
    if (result.status === "COMPLETED") {
      assert.ok(result.actualArrivalAt);
      assert.equal(result.cancelledAt, undefined);
      assert.equal(result.cancellationReason, undefined);
    } else {
      assert.ok(result.cancelledAt);
      assert.equal(result.actualArrivalAt, undefined);
    }
    await assertClean(f.j);
    assert.equal(
      (await call("/gps", ping(f, end, f.now + 1000, 3))).status,
      400,
    );
    assert.deepEqual(await data(f.j.id), result);
  }
  const ready = await fixture("invalid-complete");
  assert.equal(
    (await call("/complete-journey", { journeyId: ready.j.id })).status,
    400,
  );
  assert.equal(
    (await call("/complete-journey", { journeyId: ready.j.id }, false)).status,
    401,
  );
  console.log(
    "Completion/cancellation integration PASS: generated full route, GPS proof, manual fallback, terminal cleanup, device reuse, subscriptions and races.",
  );
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
