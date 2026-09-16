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
async function main() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  await seed();
  const db = getFirestore(),
    key = "gps-start-test-key";
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
    deviceId = `start-${label}`,
  ) {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const bundle = demoMaster();
    bundle.schedule.gpsDeviceIds = [deviceId];
    const j = createJourneySnapshot(
      bundle,
      getDhakaServiceDate(now),
      `start-${label}`,
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
  for (const [label, deviation] of [
    ["early", -8],
    ["ontime", 0],
    ["late", 140],
  ] as const) {
    const f = await fixture(label, deviation);
    assert.equal(
      (await call("/gps", ping(f, 0, f.now - 10000, 1))).status,
      200,
    );
    assert.equal((await data(f.j.id)).status, "READY");
    const started = await call("/gps", ping(f, 200, f.now, 2));
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const saved = await data(f.j.id);
    assert.equal(saved.status, "RUNNING");
    assert.equal(saved.actualDepartureAt, f.now);
    assert.equal(saved.departureDeviationMinutes, deviation);
    assert.equal(saved.transitionSource, "GPS_AUTO");
    assert.equal(
      (await call("/gps", ping(f, 220, f.now + 1000, 3))).status,
      200,
    );
    assert.equal(
      (await data(f.j.id)).actualDepartureAt,
      saved.actualDepartureAt,
    );
    assert.equal((await data(f.j.id)).transitionSource, saved.transitionSource);
    // RTDB publication is asynchronous, so wait briefly for the normal projection trigger.
    let live: any;
    for (let i = 0; i < 30; i++) {
      live = (await getDatabase().ref(`liveJourneys/${f.j.id}`).get()).val();
      if (live?.progress?.distanceFromOriginMeters >= 219) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(live?.progress?.distanceFromOriginMeters >= 219);
    assert.ok(live.stationPredictions.airport.predictedArrivalAt);
    if (label === "late") {
      assert.equal(
        (await call("/mock-tickets", { journeyId: f.j.id })).status,
        200,
      );
      await call("/gps", ping(f, 240, f.now + 2000, 4));
      await call("/gps", ping(f, 260, f.now + 3000, 5));
      assert.equal(
        (
          await db
            .collection("notifications")
            .where("journeyId", "==", f.j.id)
            .get()
        ).size,
        2,
      );
    }
  }
  for (const [label, status, deviation] of [
    ["scheduled", "SCHEDULED", 0],
    ["expired", "READY", 361],
    ["jitter", "READY", 0],
  ] as const) {
    const f = await fixture(label, deviation, status);
    await call("/gps", ping(f, 0, f.now - 10000, 1));
    await call("/gps", ping(f, label === "jitter" ? 5 : 200, f.now, 2));
    assert.equal((await data(f.j.id)).status, status);
    if (label === "expired") {
      const before = Date.now();
      const result = await call("/start-journey", { journeyId: f.j.id });
      assert.equal(result.status, 200);
      const saved = await data(f.j.id);
      assert.ok(
        saved.actualDepartureAt >= before &&
          saved.actualDepartureAt <= Date.now(),
      );
      assert.equal(saved.transitionSource, "ADMIN_MANUAL");
      assert.equal(
        (await call("/start-journey", { journeyId: f.j.id })).body.result,
        "UNCHANGED",
      );
      assert.deepEqual(await data(f.j.id), saved);
    }
    if (status === "SCHEDULED")
      assert.equal(
        (await call("/start-journey", { journeyId: f.j.id })).status,
        400,
      );
  }
  // A timestamp within tolerance must not extend the trusted backend's expired start window.
  const originalConfig = (await db.doc("systemConfig/global").get()).data()!;
  await db.doc("systemConfig/global").update({ autoStartLateMs: 60000 });
  const boundary = await fixture("late-clock-boundary", 70 / 60);
  await call("/gps", ping(boundary, 0, boundary.now - 20000, 1));
  await call("/gps", ping(boundary, 200, boundary.now - 10000, 2));
  assert.equal((await data(boundary.j.id)).status, "READY");
  await db.doc("systemConfig/global").set(originalConfig);
  const unrelated = await fixture("unrelated", 0, "SCHEDULED");
  const invalid = await fixture("invalid");
  assert.equal(
    (
      await call("/gps", {
        ...ping(invalid, 0, invalid.now, 1),
        accuracyM: 999,
      })
    ).status,
    400,
  );
  assert.equal((await data(invalid.j.id)).status, "READY");
  assert.equal(
    (await call("/start-journey", { journeyId: invalid.j.id }, false)).status,
    401,
  );
  assert.equal(
    (
      await call("/gps", {
        ...ping(invalid, 0, invalid.now, 1),
        deviceId: unrelated.deviceId,
      })
    ).status,
    403,
  ); // An unrelated assigned device cannot start this READY journey.
  assert.equal((await data(invalid.j.id)).status, "READY");
  const a = await fixture("amb-a"),
    b = await fixture("amb-b", 0, "READY", a.deviceId);
  assert.match(
    (await call("/gps", ping(a, 0, a.now - 10000, 1))).body.error,
    /Ambiguous/,
  );
  assert.equal((await data(a.j.id)).status, "READY");
  assert.equal((await data(b.j.id)).status, "READY");
  assert.equal(
    (await call("/start-journey", { journeyId: a.j.id })).status,
    200,
  );
  assert.equal(
    (await call("/start-journey", { journeyId: b.j.id })).status,
    400,
  );
  const routed = await call("/gps", ping(b, 0, b.now, 1));
  assert.equal(routed.status, 200);
  assert.equal(routed.body.live.journeyId, a.j.id);
  assert.equal((await data(b.j.id)).status, "READY");
  for (const mode of ["admin", "gps"] as const) {
    const f = await fixture(`race-${mode}`);
    await call("/gps", ping(f, 0, f.now - 10000, 1));
    const results = await Promise.all([
      call("/gps", ping(f, 200, f.now, 2)),
      mode === "admin"
        ? call("/start-journey", { journeyId: f.j.id })
        : call("/gps", ping(f, 200, f.now, 2)),
    ]);
    assert.ok(results.some((r) => r.status === 200));
    assert.ok(results.every((r) => [200, 400].includes(r.status)));
    const saved = await data(f.j.id);
    assert.equal(saved.status, "RUNNING");
    assert.ok(["GPS_AUTO", "ADMIN_MANUAL"].includes(saved.transitionSource));
    assert.equal(
      saved.departureDeviationMinutes,
      (saved.actualDepartureAt - f.j.departureMs) / 60000,
    );
    await call("/start-journey", { journeyId: f.j.id });
    assert.deepEqual(await data(f.j.id), saved);
  }
  console.log(
    "PASS GPS start: two observations, early/on-time/late metadata, jitter/invalid/SCHEDULED/late-window exclusion, device routing, ambiguity, RUNNING precedence, manual fallback, concurrent starts, RTDB/ETA and mock notification deduplication.",
  );
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
