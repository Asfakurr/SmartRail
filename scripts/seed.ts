import { getDhakaServiceDate } from "../shared/service-date";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { demoMaster } from "../shared/seed";
import { defaults } from "../shared/domain";
import {
  createFromSavedSchedule,
  saveMaster,
} from "../functions/src/master-data";
export async function seed(
  options: { scheduleTime?: string; serviceDate?: string } = {},
) {
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
  const db = getFirestore(),
    bundle = demoMaster(options.scheduleTime || "08:00");
  const saved = await db.doc(`schedules/${bundle.schedule.scheduleId}`).get();
  if (!saved.exists) {
    const old = await db.doc(`routes/${bundle.route.routeId}`).get();
    bundle.route.version = (old.data()?.version || 0) + 1;
    await saveMaster(bundle);
  }
  if (!(await db.doc("systemConfig/global").get()).exists)
    await db.doc("systemConfig/global").set(defaults);
  for (const role of ["admin", "operator"]) {
    const uid = `demo-${role}`;
    try {
      await getAuth().getUser(uid);
    } catch (error) {
      if ((error as { code: string }).code !== "auth/user-not-found")
        throw error;
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
  // Reusable train-level configuration; creating a second journey does not reassign the device.
  for (const [id, source] of [
    ["demo-gnss", "SIMULATOR"],
    ["demo-primary", "DEDICATED_GNSS_CELLULAR"],
    ["demo-phone", "OPERATOR_PHONE"],
  ]) {
    const r = db.doc(`gpsDevices/${id}`);
    if (!(await r.get()).exists)
      await r.set({
        id,
        trainNumber: "701",
        source,
        active: true,
        ...(source === "OPERATOR_PHONE"
          ? { operatorUid: "demo-operator" }
          : {
              keyHash: createHash("sha256")
                .update("local-demo-device-key")
                .digest("hex"),
            }),
      });
  }
  if (!(await db.doc("operators/demo-operator").get()).exists)
    await db
      .doc("operators/demo-operator")
      .set({
        uid: "demo-operator",
        displayName: "Demo operator",
        trainNumbers: ["701"],
        active: true,
      });
  const date = options.serviceDate || getDhakaServiceDate(Date.now());
  return createFromSavedSchedule(bundle.schedule.scheduleId, date);
}
if (process.argv[1]?.endsWith("/seed.ts"))
  seed()
    .then((j) => {
      console.log(
        `Seeded/reused journey ${j.id}\nBusiness key: ${j.businessKey}\nAdmin: admin@smartrail.test / DemoRail2026!\nRun pnpm simulate or use the authenticated simulator controls.`,
      );
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
