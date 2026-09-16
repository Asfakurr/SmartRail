import assert from "node:assert/strict";
import { getFirestore } from "firebase-admin/firestore";
import { seed } from "./seed";
import { demoMaster } from "../shared/seed";
import { createJourneySnapshot } from "../shared/master";
import {
  transitionJourneyState,
  reconcileJourneyReadiness,
} from "../functions/src/journey-lifecycle";
import { reconcileJourneyOperations } from "../functions/src/journey-generation";
import type { Journey } from "../shared/domain";
async function main() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  await seed();
  const db = getFirestore(),
    now = Date.parse("2026-11-10T18:15:00Z"); // Nov 11 00:15 Dhaka
  async function fixture(
    label: string,
    departure: number,
    status: Journey["status"] = "SCHEDULED",
    generated = true,
  ) {
    const j = createJourneySnapshot(
      demoMaster(),
      "2026-11-10",
      `lifecycle-${label}`,
    );
    const delta = departure - j.departureMs;
    j.routePointSnapshots.forEach((p) => {
      p.scheduledArrivalAt += delta;
      p.scheduledDepartureAt += delta;
    });
    j.expiresAt += delta;
    j.departureMs = departure;
    j.status = status;
    if (generated) j.generationSource = "SCHEDULE";
    await db.doc(`journeys/${j.id}`).create(j);
    return j;
  }
  const early = await fixture("early", now + 1800001);
  const due = await fixture("due", now + 1800000);
  const overdue = await fixture("overdue", now - 2 * 3600000);
  const midnight = await fixture(
    "midnight",
    Date.parse("2026-11-10T17:30:00Z"),
  );
  const manual = await fixture("manual", now - 1000, "SCHEDULED", false);
  const complete = await fixture("complete", now - 1000, "COMPLETED");
  const cancelled = await fixture("cancelled", now - 1000, "CANCELLED");
  const running = await fixture("running", now - 1000, "RUNNING");
  const tooOld = await fixture("old", now - 49 * 3600000);
  assert.equal(await transitionJourneyState(early.id, "READY", now), "NOT_DUE");
  assert.deepEqual((await db.doc(`journeys/${early.id}`).get()).data(), early);
  const concurrent = await Promise.all([
    transitionJourneyState(due.id, "READY", now),
    transitionJourneyState(due.id, "READY", now + 1),
  ]);
  assert.deepEqual(concurrent.sort(), ["TRANSITIONED", "UNCHANGED"]);
  const saved = (await db.doc(`journeys/${due.id}`).get()).data()!;
  assert.equal(saved.status, "READY");
  assert.equal(saved.transitionSource, "SYSTEM_TIME");
  assert.ok([now, now + 1].includes(saved.statusUpdatedAt));
  assert.equal(
    await transitionJourneyState(due.id, "READY", now + 2),
    "UNCHANGED",
  );
  assert.deepEqual((await db.doc(`journeys/${due.id}`).get()).data(), saved);
  for (const j of [complete, cancelled, running, manual])
    await assert.rejects(() => transitionJourneyState(j.id, "READY", now));
  await assert.rejects(() => transitionJourneyState(due.id, "RUNNING", now));
  // Master schedule edits do not move the preserved journey departure threshold.
  await db
    .doc("schedules/701-0800")
    .update({ scheduledDepartureTime: "23:59" });
  const summary = await reconcileJourneyReadiness(now);
  assert.equal(summary.failedCount, 0);
  assert.equal(summary.readyCount, 2);
  for (const j of [overdue, midnight]) {
    const data = (await db.doc(`journeys/${j.id}`).get()).data()!;
    assert.equal(data.status, "READY");
    assert.equal(data.statusUpdatedAt, now);
    assert.equal(data.serviceDate, "2026-11-10");
  }
  assert.equal((await reconcileJourneyReadiness(now)).readyCount, 0);
  for (const j of [early, manual, complete, cancelled, running, tooOld])
    assert.deepEqual((await db.doc(`journeys/${j.id}`).get()).data(), j);
  // The existing periodic orchestration generates today and repairs overdue previous-date journeys.
  const recovered = await fixture("restart", now - 1000);
  const combined = await reconcileJourneyOperations(now);
  assert.equal(combined.generation.serviceDate, "2026-11-11");
  assert.equal(
    (await db.doc(`journeys/${recovered.id}`).get()).data()?.status,
    "READY",
  );
  // Legacy HTTP paths must not start/cancel generated journeys, even with GPS or admin auth.
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
  assert.ok(login.idToken);
  async function post(path: string, body: unknown) {
    return fetch(
      "http://127.0.0.1:5001/demo-smartrail-bd/asia-south1/api" + path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${login.idToken}`,
        },
        body: JSON.stringify(body),
      },
    );
  }
  for (const j of [early, due]) {
    const before = (await db.doc(`journeys/${j.id}`).get()).data();
    // Prompt 1D routes assigned GPS to the already RUNNING fixture, never starts these targets.
    const gps = await post("/simulate", { journeyId: j.id, action: "STEP" });
    if (j.id === early.id) {
      assert.equal(gps.status, 200);
      assert.equal((await gps.json()).live.journeyId, running.id);
    } else {
      assert.equal(gps.status, 400);
      assert.match((await gps.json()).error, /Replay/);
    }
    assert.equal(
      (await post("/journey-status", { journeyId: j.id, status: "CANCELLED" }))
        .status,
      400,
    );
    assert.equal(
      (await post("/journey-status", { journeyId: j.id, status: "READY" }))
        .status,
      400,
    );
    assert.deepEqual((await db.doc(`journeys/${j.id}`).get()).data(), before);
    assert.equal((await db.doc(`liveInternal/${j.id}`).get()).exists, false);
  }
  assert.equal(
    (await post("/simulate", { journeyId: manual.id, action: "STEP" })).status,
    200,
  );
  assert.equal(
    (await db.doc(`journeys/${manual.id}`).get()).data()?.status,
    "RUNNING",
  );
  console.log(
    "PASS lifecycle: threshold boundary, late/overnight readiness, concurrency, immutable metadata, terminal safety, bounded recovery, combined reconciliation, generated GPS/admin guards, and manual compatibility.",
  );
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
