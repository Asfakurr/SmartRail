import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { makeJourney, route, train } from "../shared/seed";
import { validateRoute } from "../shared/engine";
import { defaults } from "../shared/domain";
export async function seed() {
  // Fail closed: this script never writes to a production Firebase project.
  process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
  process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= "127.0.0.1:9000";
  for (const key of [
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_AUTH_EMULATOR_HOST",
    "FIREBASE_DATABASE_EMULATOR_HOST",
  ])
    if (!/^127\.0\.0\.1:\d+$/.test(process.env[key]!))
      throw new Error("Seed supports loopback emulators only");
  if (!getApps().length)
    initializeApp({
      projectId: "demo-smartrail-bd",
      databaseURL: "https://demo-smartrail-bd-default-rtdb.firebaseio.com",
    });
  const db = getFirestore();
  validateRoute(route);
  await db.doc(`routes/${route.id}`).set(route);
  await db.doc(`trains/${train.number}`).set(train);
  const local = new Date(Date.now() + 6 * 3600000 - 30 * 60000).toISOString();
  const journey = makeJourney(local.slice(0, 10), local.slice(11, 16));
  await db.doc(`journeys/${journey.id}`).set(journey);
  await db
    .doc(`schedules/${train.number}-demo`)
    .set({
      id: `${train.number}-demo`,
      trainNumber: train.number,
      routeId: route.id,
      direction: route.direction,
      scheduledTime: journey.scheduledTime,
    });
  await db.doc("settings/thresholds").set(defaults);
  for (const role of ["admin", "operator"]) {
    const uid = `demo-${role}`;
    try {
      await getAuth().getUser(uid);
    } catch {
      await getAuth().createUser({
        uid,
        email: `${role}@smartrail.test`,
        password: "DemoRail2026!",
      });
    }
    await getAuth().setCustomUserClaims(
      uid,
      role === "admin" ? { admin: true } : { operator: true },
    );
  }
  await db
    .doc("devices/demo-gnss")
    .set({
      id: "demo-gnss",
      journeyId: journey.id,
      source: "primary",
      active: true,
      keyHash: createHash("sha256")
        .update("local-demo-device-key")
        .digest("hex"),
    });
  await db
    .doc("devices/demo-phone")
    .set({
      id: "demo-phone",
      journeyId: journey.id,
      source: "phone",
      active: true,
      operatorUid: "demo-operator",
    });
  await db
    .doc("operators/demo-operator")
    .set({
      uid: "demo-operator",
      displayName: "Demo operator",
      journeyIds: [journey.id],
      active: true,
    });
  return journey;
}
if (process.argv[1]?.endsWith("/seed.ts"))
  seed()
    .then((j) => {
      console.log(
        `Seeded emulator journey: ${j.id}\nAdmin: admin@smartrail.test / DemoRail2026!\nRun pnpm simulate for secure HTTP GPS.`,
      );
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
