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
  const j = await seed();
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
    source: "primary",
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
    source: "phone",
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
      assert.equal(snap.val().deviceId, undefined);
      published = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(published, "RTDB projection published");
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
  await assertFails(getDoc(doc(anon.firestore(), "devices/demo-gnss")));
  await assertFails(
    setDoc(doc(anon.firestore(), `journeys/${j.id}`), { status: "completed" }),
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
    setDoc(doc(passenger.firestore(), "settings/thresholds"), {
      delayMinutes: 1,
    }),
  );
  await assertFails(getDoc(doc(passenger.firestore(), "passengers/fake-1")));
  const admin = env.authenticatedContext("demo-admin", { admin: true });
  await assertSucceeds(getDoc(doc(admin.firestore(), "passengers/fake-1")));
  await assertFails(getDoc(doc(admin.firestore(), "devices/demo-gnss")));
  await env.cleanup();
  console.log(
    "PASS: authenticated mock tickets → subscriptions → secure concurrent GPS → ETA → 2 unique mock SMS → public RTDB; public/private rules checked.",
  );
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
