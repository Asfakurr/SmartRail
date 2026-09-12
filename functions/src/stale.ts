import { getFirestore } from "firebase-admin/firestore";
import { defaults } from "../../shared/domain";
export async function markStaleGps(now = Date.now()) {
  const db = getFirestore();
  const config = {
    ...defaults,
    ...(await db.doc("systemConfig/global").get()).data(),
  };
  const rows = await db
    .collection("liveInternal")
    .where("receivedAt", "<=", now - config.primaryStaleMs)
    .get();
  for (const row of rows.docs)
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(row.ref),
        state = fresh.data();
      if (
        !state ||
        state.completed ||
        state.gpsStatus === "STALE" ||
        state.receivedAt > now - config.primaryStaleMs
      )
        return;
      tx.update(row.ref, {
        gpsStatus: "STALE",
        revision: state.revision + 1,
        projection: {
          ...state.projection,
          tracking: {
            ...state.projection.tracking,
            gpsStatus: "STALE",
            primaryDeviceHealthy: false,
          },
        },
      });
      tx.set(db.doc(`journeys/${row.id}/events/GPS_LOST_${state.timestamp}`), {
        type: "GPS_LOST",
        recordedAt: now,
      });
    });
}
