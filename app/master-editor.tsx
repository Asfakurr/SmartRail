"use client";
import { useState } from "react";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
} from "firebase/firestore";
import { firebaseClient, api } from "@/lib/firebase";
import type { Journey } from "@/shared/domain";
import type { MasterBundle } from "@/shared/master";
export default function MasterEditor({
  journey,
  onSaved,
}: {
  journey: Journey;
  onSaved: () => void;
}) {
  const [bundle, setBundle] = useState<MasterBundle | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try {
      const db = firebaseClient().firestore,
        routeRef = doc(db, "routes", journey.routeId),
        scheduleRef = doc(db, "schedules", journey.scheduleSnapshot.scheduleId);
      const [train, route, schedule, points, segments, geometry, timings] =
        await Promise.all([
          getDoc(doc(db, "trains", journey.trainNumber)),
          getDoc(routeRef),
          getDoc(scheduleRef),
          getDocs(query(collection(routeRef, "points"), orderBy("sequence"))),
          getDocs(query(collection(routeRef, "segments"), orderBy("sequence"))),
          getDocs(query(collection(routeRef, "geometry"), orderBy("sequence"))),
          getDocs(
            query(collection(scheduleRef, "timings"), orderBy("sequence")),
          ),
        ]);
      setBundle({
        train: train.data(),
        route: {
          ...route.data(),
          points: points.docs.map((d) => d.data()),
          segments: segments.docs.map((d) => d.data()),
          geometry: geometry.docs.map((d) => d.data()),
        },
        schedule: {
          ...schedule.data(),
          timings: timings.docs.map((d) => d.data()),
        },
      } as MasterBundle);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(change: (draft: MasterBundle) => void) {
    setBundle((old) => {
      if (!old) return old;
      const draft = structuredClone(old);
      change(draft);
      return draft;
    });
  }
  return (
    <section>
      <button disabled={busy} onClick={() => void load()}>
        Edit saved master configuration
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {bundle && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            void api("/master", {
              ...bundle,
              route: { ...bundle.route, version: bundle.route.version + 1 },
              schedule: {
                ...bundle.schedule,
                version: bundle.schedule.version + 1,
              },
            })
              .then(() => {
                setBundle(null);
                onSaved();
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Permanent train name
            <input
              required
              value={bundle.train.name}
              onChange={(e) =>
                edit((d) => {
                  d.train.name = e.target.value;
                })
              }
            />
          </label>
          <label>
            Reusable departure time
            <input
              type="time"
              required
              value={bundle.schedule.scheduledDepartureTime}
              onChange={(e) =>
                edit((d) => {
                  d.schedule.scheduledDepartureTime = e.target.value;
                })
              }
            />
          </label>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Saved point</th>
                  <th>Segment travel (seconds)</th>
                  <th>Dwell (seconds)</th>
                  <th>Arrival offset (seconds)</th>
                  <th>Departure offset (seconds)</th>
                </tr>
              </thead>
              <tbody>
                {bundle.route.points.map((p, i) => (
                  <tr key={p.pointId}>
                    <td>{p.name}</td>
                    <td>
                      {i > 0 ? (
                        <input
                          aria-label={`${p.name} travel seconds`}
                          type="number"
                          min="1"
                          value={
                            bundle.route.segments[i - 1].defaultTravelSeconds
                          }
                          onChange={(e) =>
                            edit((d) => {
                              d.route.segments[i - 1].defaultTravelSeconds =
                                Number(e.target.value);
                            })
                          }
                        />
                      ) : (
                        0
                      )}
                    </td>
                    <td>
                      <input
                        aria-label={`${p.name} dwell seconds`}
                        type="number"
                        min="0"
                        value={p.defaultDwellSeconds}
                        onChange={(e) =>
                          edit((d) => {
                            d.route.points[i].defaultDwellSeconds = Number(
                              e.target.value,
                            );
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${p.name} arrival offset`}
                        type="number"
                        min="0"
                        value={
                          bundle.schedule.timings[i]
                            .scheduledArrivalOffsetSeconds
                        }
                        onChange={(e) =>
                          edit((d) => {
                            d.schedule.timings[
                              i
                            ].scheduledArrivalOffsetSeconds = Number(
                              e.target.value,
                            );
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${p.name} departure offset`}
                        type="number"
                        min="0"
                        value={
                          bundle.schedule.timings[i]
                            .scheduledDepartureOffsetSeconds
                        }
                        onChange={(e) =>
                          edit((d) => {
                            d.schedule.timings[
                              i
                            ].scheduledDepartureOffsetSeconds = Number(
                              e.target.value,
                            );
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="primary" disabled={busy}>
            Save for future journeys
          </button>
          <button type="button" onClick={() => setBundle(null)}>
            Close
          </button>
          <small>
            Existing journeys retain their original names, distances and
            scheduled station timestamps.
          </small>
        </form>
      )}
    </section>
  );
}
