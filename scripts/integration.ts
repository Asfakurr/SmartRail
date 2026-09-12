import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getFirestore } from "firebase-admin/firestore";
import { getDatabase } from "firebase-admin/database";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { ref, set, get } from "firebase/database";
import { seed } from "./seed";
import { coordinateAt } from "../shared/engine";
async function main() {
  const local = new Date(Date.now() + 21600000 - 1800000).toISOString();
  const j = await seed({
    scheduleTime: local.slice(11, 16),
    serviceDate: local.slice(0, 10),
  });
  const base = "http://127.0.0.1:5001/demo-smartrail-bd/asia-south1/api";
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
  async function call(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }
  assert.equal((await call("/mock-tickets", { journeyId: j.id })).status, 401);
  assert.equal(
    (
      await call(
        "/mock-tickets",
        { journeyId: j.id },
        { Authorization: `Bearer ${login.idToken}` },
      )
    ).status,
    200,
  );
  const db = getFirestore();
  assert.equal(
    (await db.collection("subscriptions").where("journeyId", "==", j.id).get())
      .size,
    2,
  );
  assert.equal(
    (
      await call(
        "/subscribe",
        { journeyId: j.id, boardingPointId: "tongi", phone: "+8801000000003" },
        { Authorization: `Bearer ${login.idToken}` },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/subscribe",
        {
          journeyId: j.id,
          boardingPointId: "airport",
          phone: "+8801000000001",
        },
        { Authorization: `Bearer ${login.idToken}` },
      )
    ).status,
    200,
  );
  const ping = {
    ...coordinateAt(j.route, 0),
    journeyId: j.id,
    deviceId: "demo-gnss",
    source: "SIMULATOR",
    timestamp: Date.now(),
    sequence: 1,
    accuracyM: 8,
  };
  assert.equal(
    (await call("/gps", ping, { "x-device-key": "wrong" })).status,
    401,
  );
  const responses = await Promise.all([
    call("/gps", ping, { "x-device-key": "local-demo-device-key" }),
    call("/gps", ping, { "x-device-key": "local-demo-device-key" }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
  assert.equal(
    (await db.collection("notifications").where("journeyId", "==", j.id).get())
      .size,
    2,
  );
  assert.equal(
    (
      await call(
        "/gps",
        { ...ping, timestamp: ping.timestamp + 1000, sequence: 2 },
        { "x-device-key": "local-demo-device-key" },
      )
    ).status,
    200,
  );
  assert.equal(
    (await db.collection("notifications").where("journeyId", "==", j.id).get())
      .size,
    2,
  );
  const operatorLogin = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "operator@smartrail.test",
        password: "DemoRail2026!",
        returnSecureToken: true,
      }),
    },
  ).then((r) => r.json());
  const phonePing = {
    ...ping,
    source: "OPERATOR_PHONE",
    deviceId: "demo-phone",
    timestamp: ping.timestamp + 2000,
    sequence: 1,
  };
  assert.equal(
    (
      await call("/gps", phonePing, {
        Authorization: `Bearer ${login.idToken}`,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/gps", phonePing, {
        Authorization: `Bearer ${operatorLogin.idToken}`,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/threshold",
        { delayMinutes: 3 },
        { Authorization: `Bearer ${operatorLogin.idToken}` },
      )
    ).status,
    403,
  );
  await db
    .doc(`liveInternal/${j.id}`)
    .update({ primaryLastSeen: Date.now() - 121000 });
  assert.equal(
    (
      await call("/gps", phonePing, {
        Authorization: `Bearer ${operatorLogin.idToken}`,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/gps",
        { ...ping, timestamp: ping.timestamp + 3000, sequence: 1 },
        { "x-device-key": "local-demo-device-key" },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/gps",
        { ...ping, timestamp: ping.timestamp + 3000, sequence: 3 },
        { "x-device-key": "local-demo-device-key" },
      )
    ).status,
    200,
  );
  assert.equal(
    (await db.collection("notifications").where("journeyId", "==", j.id).get())
      .size,
    2,
  );
  let published = false;
  for (let i = 0; i < 30; i++) {
    const snap = await getDatabase().ref(`liveJourneys/${j.id}`).get();
    if (snap.exists()) {
      assert.equal(snap.val().journeyId, j.id);
      assert.equal(snap.val().position.latitude, j.route.points[0].lat);
      assert.equal(snap.val().tracking.deviceId, "demo-gnss");
      assert.equal(snap.val().progress.totalRouteDistanceMeters, 91000);
      assert.ok(snap.val().stationPredictions.airport.delaySeconds > 0);
      published = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(published, "RTDB projection published");
  const auth = { Authorization: `Bearer ${login.idToken}` };
  const post = async (path: string, body: unknown) => {
    const r = await call(path, body, auth);
    const data = await r.json();
    assert.equal(r.status, 200, JSON.stringify(data));
    return data;
  };
  const manual = (
    await db.collection("subscriptions").where("journeyId", "==", j.id).get()
  ).docs.find((d) => d.data().source === "MANUAL")!;
  assert.equal(
    (
      await call(
        "/unsubscribe",
        { subscriptionId: manual.id },
        { Authorization: `Bearer ${operatorLogin.idToken}` },
      )
    ).status,
    403,
  );
  await post("/unsubscribe", { subscriptionId: manual.id });
  assert.equal((await manual.ref.get()).data()?.active, false);
  // Reusing the same saved configuration never mutates permanent train data or old snapshots.
  const original = structuredClone(
    (await db.doc(`journeys/${j.id}`).get()).data()!,
  );
  const changed = {
    train: { ...j.trainSnapshot, name: "Updated master name" },
    route: { ...j.routeSnapshot, version: j.routeSnapshot.version + 1 },
    schedule: {
      ...j.scheduleSnapshot,
      version: j.scheduleSnapshot.version + 1,
      timings: j.scheduleSnapshot.timings.map((t, i) => ({
        ...t,
        scheduledArrivalOffsetSeconds:
          t.scheduledArrivalOffsetSeconds + (i > 1 ? 60 : 0),
        scheduledDepartureOffsetSeconds:
          t.scheduledDepartureOffsetSeconds + (i > 1 ? 60 : 0),
      })),
    },
  };
  await post("/master", changed);
  assert.equal(
    (await call("/master", changed, auth)).status,
    400,
    "stale master edit rejected",
  );
  const futureDate = new Date(
    Date.parse(`${j.serviceDate}T00:00:00Z`) + 86400000,
  )
    .toISOString()
    .slice(0, 10);
  const input = {
    scheduleId: j.scheduleSnapshot.scheduleId,
    serviceDate: futureDate,
  };
  const pair = await Promise.all([
    post("/journey", input),
    post("/journey", input),
  ]);
  assert.equal(
    pair[0].journey.id,
    pair[1].journey.id,
    "unique business key is atomic",
  );
  const future = pair[0].journey;
  assert.notEqual(future.id, future.businessKey);
  assert.equal(future.trainSnapshot.name, "Updated master name");
  assert.equal(
    future.routePointSnapshots[2].scheduledArrivalAt - future.departureMs,
    j.routePointSnapshots[2].scheduledArrivalAt - j.departureMs + 60000,
  );
  assert.deepEqual(
    (await db.doc(`journeys/${j.id}`).get()).data(),
    original,
    "master edit preserves historical snapshot",
  );
  assert.equal(
    (await db.collection(`journeys/${future.id}/routePoints`).get()).size,
    6,
  );
  assert.equal(
    (await db.doc(`trains/${j.trainNumber}`).get()).data()?.lat,
    undefined,
  );
  const secondMaster = {
    ...changed,
    route: { ...changed.route, version: changed.route.version + 1 },
    schedule: {
      ...changed.schedule,
      scheduleId: "701-second-departure",
      scheduledDepartureTime:
        changed.schedule.scheduledDepartureTime === "16:00" ? "17:00" : "16:00",
      version: 1,
    },
  };
  await post("/master", secondMaster);
  const second = (
    await post("/journey", {
      scheduleId: secondMaster.schedule.scheduleId,
      serviceDate: futureDate,
    })
  ).journey;
  assert.notEqual(second.id, future.id);
  assert.equal(second.serviceDate, future.serviceDate);
  assert.notEqual(second.businessKey, future.businessKey);
  await post("/journey-status", { journeyId: second.id, status: "READY" });
  await post("/journey-status", { journeyId: second.id, status: "CANCELLED" });
  assert.equal(
    (await call("/simulate", { journeyId: second.id, action: "STEP" }, auth))
      .status,
    400,
  );
  const currentHistory = await db
    .collection(`journeys/${j.id}/gpsHistory`)
    .get();
  assert.ok(currentHistory.size >= 4);
  assert.ok(currentHistory.docs[0].data().matchedCoordinates);
  assert.ok(
    (await db.collection(`journeys/${j.id}/predictionHistory`).get()).size >= 4,
  );
  const currentEvents = (
    await db.collection(`journeys/${j.id}/events`).get()
  ).docs.map((d) => d.data().type);
  assert.ok(currentEvents.includes("GPS_SOURCE_SWITCHED"));
  await post("/mock-tickets", { journeyId: future.id });
  // Move beyond airport before introducing delay. Only the future Narsingdi passenger should be alerted.
  for (let i = 0; i < 11; i++)
    await post("/simulate", { journeyId: future.id, action: "STEP" });
  const before = (
    await db
      .collection("notifications")
      .where("journeyId", "==", future.id)
      .get()
  ).size;
  assert.equal(before, 0);
  const config = (await db.doc("systemConfig/global").get()).data()!;
  await post("/config", { ...config, notificationsEnabled: false });
  await post("/simulate", { journeyId: future.id, action: "HOLD" });
  assert.equal(
    (
      await db
        .collection("notifications")
        .where("journeyId", "==", future.id)
        .get()
    ).size,
    0,
  );
  await post("/config", { ...config, notificationsEnabled: true });
  await post("/simulate", { journeyId: future.id, action: "STEP" });
  const alerts = await db
    .collection("notifications")
    .where("journeyId", "==", future.id)
    .get();
  assert.equal(alerts.size, 1);
  assert.equal(alerts.docs[0].data().boardingPointId, "narsingdi");
  assert.equal(alerts.docs[0].data().notificationType, "DELAY_ALERT");
  await post("/simulate", { journeyId: future.id, action: "HOLD" });
  assert.equal(
    (
      await db
        .collection("notifications")
        .where("journeyId", "==", future.id)
        .get()
    ).size,
    1,
  );
  const stale = await import("../functions/src/stale");
  await stale.markStaleGps(Date.now() + config.primaryStaleMs + 1);
  assert.equal(
    (await db.doc(`liveInternal/${future.id}`).get()).data()?.gpsStatus,
    "STALE",
  );
  await post("/simulate", { journeyId: future.id, action: "STEP" });
  const events = (
    await db.collection(`journeys/${future.id}/events`).get()
  ).docs.map((d) => d.data().type);
  for (const type of [
    "GPS_LOST",
    "GPS_RECOVERED",
    "STATION_REACHED",
    "STATION_DEPARTED",
    "DELAY_THRESHOLD_CROSSED",
  ])
    assert.ok(events.includes(type), type);
  // Complete the journey; subscriptions cannot produce additional alerts after completion.
  for (let i = 0; i < 50; i++) {
    const { live } = await post("/simulate", {
      journeyId: future.id,
      action: "STEP",
    });
    if (live.completed) break;
  }
  assert.equal(
    (await db.doc(`journeys/${future.id}`).get()).data()?.status,
    "COMPLETED",
  );
  assert.equal(
    (await call("/simulate", { journeyId: future.id, action: "STEP" }, auth))
      .status,
    400,
  );
  assert.equal(
    (
      await db
        .collection("notifications")
        .where("journeyId", "==", future.id)
        .get()
    ).size,
    1,
  );
  assert.ok(
    (
      await db
        .collection("subscriptions")
        .where("journeyId", "==", future.id)
        .get()
    ).docs.every((d) => !d.data().active),
  );
  const env = await initializeTestEnvironment({
    projectId: "demo-smartrail-bd",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("firestore.rules", "utf8"),
    },
    database: {
      host: "127.0.0.1",
      port: 9000,
      rules: readFileSync("database.rules.json", "utf8"),
    },
  });
  const anon = env.unauthenticatedContext();
  await assertSucceeds(getDoc(doc(anon.firestore(), `journeys/${j.id}`)));
  await assertFails(getDoc(doc(anon.firestore(), "passengers/fake-1")));
  await assertFails(getDoc(doc(anon.firestore(), "gpsDevices/demo-gnss")));
  await assertFails(
    setDoc(doc(anon.firestore(), `journeys/${j.id}`), { status: "COMPLETED" }),
  );
  await assertFails(
    set(
      ref(
        anon.database("https://demo-smartrail-bd-default-rtdb.firebaseio.com"),
        `liveJourneys/${j.id}`,
      ),
      { lat: 0 },
    ),
  );
  await assertSucceeds(
    get(
      ref(
        anon.database("https://demo-smartrail-bd-default-rtdb.firebaseio.com"),
        `liveJourneys/${j.id}`,
      ),
    ),
  );
  const passenger = env.authenticatedContext("passenger");
  await assertFails(
    setDoc(doc(passenger.firestore(), "systemConfig/global"), {
      delayMinutes: 1,
    }),
  );
  await assertFails(getDoc(doc(passenger.firestore(), "passengers/fake-1")));
  const admin = env.authenticatedContext("demo-admin", { admin: true });
  await assertSucceeds(getDoc(doc(admin.firestore(), "passengers/fake-1")));
  await assertFails(getDoc(doc(admin.firestore(), "gpsDevices/demo-gnss")));
  await env.cleanup();
  console.log(
    "PASS: reusable master data, frozen snapshots, unique business keys, secure GPS, speed ETA, nested RTDB, passed-station exclusion, config toggles, atomic mock alerts, subscription cancellation, source recovery, history, completion and security rules.",
  );
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
