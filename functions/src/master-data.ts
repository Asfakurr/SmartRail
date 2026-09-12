import { getFirestore, type Transaction } from "firebase-admin/firestore";
import {
  createJourneySnapshot,
  validateMaster,
  type MasterBundle,
  type RouteConfiguration,
  type ScheduleConfiguration,
} from "../../shared/master";
import type { Journey, Train } from "../../shared/domain";
export async function saveMaster(bundle: MasterBundle) {
  validateMaster(bundle);
  const db = getFirestore();
  await db.runTransaction(async (tx) => {
    const rr = db.doc(`routes/${bundle.route.routeId}`),
      sr = db.doc(`schedules/${bundle.schedule.scheduleId}`),
      tr = db.doc(`trains/${bundle.train.number}`);
    const [oldRoute, oldSchedule, oldTrain] = await Promise.all([
      tx.get(rr),
      tx.get(sr),
      tx.get(tr),
    ]);
    if (oldRoute.exists && bundle.route.version <= oldRoute.data()!.version)
      throw new Error("Route version must increase");
    if (
      oldSchedule.exists &&
      bundle.schedule.version <= oldSchedule.data()!.version
    )
      throw new Error("Schedule version must increase");
    const oldChildren = await Promise.all([
      tx.get(rr.collection("points")),
      tx.get(rr.collection("segments")),
      tx.get(rr.collection("geometry")),
      tx.get(sr.collection("timings")),
    ]);
    const { points, segments, geometry, ...route } = bundle.route,
      { timings, ...schedule } = bundle.schedule;
    oldChildren.forEach((s) => s.docs.forEach((d) => tx.delete(d.ref)));
    tx.set(rr, route);
    points.forEach((p) => tx.set(rr.collection("points").doc(p.pointId), p));
    segments.forEach((s) =>
      tx.set(rr.collection("segments").doc(s.segmentId), s),
    );
    geometry.forEach((g) =>
      tx.set(rr.collection("geometry").doc(g.chunkId), g),
    );
    tx.set(tr, {
      ...bundle.train,
      version: (oldTrain.data()?.version || 0) + 1,
    });
    tx.set(sr, schedule);
    timings.forEach((t) =>
      tx.set(sr.collection("timings").doc(t.routePointId), t),
    );
  });
}
export async function createFromSavedSchedule(
  scheduleId: string,
  serviceDate: string,
): Promise<Journey> {
  const db = getFirestore(),
    id = db.collection("journeys").doc().id;
  return db.runTransaction(async (tx) => {
    const scheduleDoc = await tx.get(db.doc(`schedules/${scheduleId}`));
    if (!scheduleDoc.exists) throw new Error("Saved schedule missing");
    const schedule = scheduleDoc.data() as ScheduleConfiguration;
    const routeRef = db.doc(`routes/${schedule.routeId}`);
    const [train, route, points, segments, geometry, timings] =
      await Promise.all([
        tx.get(db.doc(`trains/${schedule.trainNumber}`)),
        tx.get(routeRef),
        tx.get(routeRef.collection("points").orderBy("sequence")),
        tx.get(routeRef.collection("segments").orderBy("sequence")),
        tx.get(routeRef.collection("geometry").orderBy("sequence")),
        tx.get(scheduleDoc.ref.collection("timings").orderBy("sequence")),
      ]);
    if (!train.exists || !route.exists)
      throw new Error("Configure route and train before journey");
    const bundle: MasterBundle = {
      train: train.data() as Train,
      route: {
        ...route.data(),
        points: points.docs.map((d) => d.data()),
        segments: segments.docs.map((d) => d.data()),
        geometry: geometry.docs.map((d) => d.data()),
      } as RouteConfiguration,
      schedule: {
        ...schedule,
        timings: timings.docs.map((d) => d.data()),
      } as ScheduleConfiguration,
    };
    const journey = createJourneySnapshot(bundle, serviceDate, id);
    const keyRef = db.doc(`journeyKeys/${journey.businessKey}`),
      key = await tx.get(keyRef);
    if (key.exists) {
      const existing = await tx.get(
        db.doc(`journeys/${key.data()!.journeyId}`),
      );
      if (!existing.exists) throw new Error("Broken journey key");
      return existing.data() as Journey;
    }
    tx.create(keyRef, { journeyId: id });
    tx.create(db.doc(`journeys/${id}`), journey);
    journey.routePointSnapshots.forEach((p) =>
      tx.create(db.doc(`journeys/${id}/routePoints/${p.pointId}`), p),
    );
    return journey;
  });
}
