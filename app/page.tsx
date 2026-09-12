"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import MasterEditor from "./master-editor";
import {
  TrainFront,
  MapPin,
  Radio,
  ArrowUpRight,
  Play,
  Pause,
  RotateCcw,
  Bell,
  Layers,
  Activity,
  ChevronRight,
  ShieldCheck,
  Clock3,
  Ticket,
  LogOut,
} from "lucide-react";
import {
  makeJourney,
  train,
  makeTickets,
  ticketSubscriptions,
  passengers,
} from "@/shared/seed";
import { toLiveView } from "@/shared/live";
import type { ScheduleConfiguration } from "@/shared/master";
import { coordinateAt, ingest, notificationsFor } from "@/shared/engine";
import {
  defaults,
  type Journey,
  type LiveState,
  type Notification,
  type Subscription,
} from "@/shared/domain";
import { firebaseClient, api } from "@/lib/firebase";
import { collection, onSnapshot, query, where, doc } from "firebase/firestore";
import { ref, onValue } from "firebase/database";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  type User,
} from "firebase/auth";
const RailMap = dynamic(() => import("./map"), {
  ssr: false,
  loading: () => <div className="map loading">Loading route map…</div>,
});
const firebaseMode = process.env.NEXT_PUBLIC_DATA_MODE !== "demo";
const format = (ms: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
const kindLabel: Record<string, string> = {
  origin: "Origin",
  destination: "Destination",
  passenger_halt: "Passenger halt",
  operational_stop: "Operational stop",
  crossing_stop: "Crossing stop",
  pass_through: "Pass-through",
};
export default function Home() {
  const [journeys, setJourneys] = useState<Journey[]>(
    firebaseMode ? [] : [makeJourney(), makeJourney("2026-09-10", "16:00")],
  );
  const [selected, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [date, setDate] = useState("2026-09-10"),
    [error, setError] = useState("");
  useEffect(() => {
    if (!firebaseMode) return;
    return onSnapshot(
      collection(firebaseClient().firestore, "journeys"),
      (s) => {
        const data = s.docs
          .map((d) => d.data() as Journey)
          .filter((j) => j.schemaVersion === 2);
        setJourneys(data);
        if (data.length)
          setDate((previous) =>
            data.some((j) => j.serviceDate === previous)
              ? previous
              : data[0].serviceDate,
          );
      },
      (e) => setError(e.message),
    );
  }, []);
  const filtered = journeys.filter(
    (j) =>
      j.serviceDate === date &&
      `${j.trainNumber} ${j.trainSnapshot.name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const journey = filtered.find((j) => j.id === selected) || filtered[0];
  return (
    <div className="shell">
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-icon">
            <TrainFront size={23} />
          </span>
          <span>
            SmartRail <b>BD</b>
          </span>
        </a>
        <div className="side-caption">JOURNEY INTELLIGENCE</div>
        <div className="side-link active">
          <Activity size={19} /> Live operations
        </div>
        <div className="side-note">
          <ShieldCheck size={23} />
          <strong>Built for the journey ahead.</strong>
          <p>An academic prototype for more informed rail travel.</p>
        </div>
        <div className="side-bottom">
          <span className="dot" /> FYP prototype{" "}
          <small>Unofficial · Bangladesh</small>
        </div>
      </aside>
      <main>
        <header>
          <span className="breadcrumb">
            Workspace <ChevronRight size={14} /> Live operations
          </span>
          <span className="badge">
            {firebaseMode ? "Firebase backend mode" : "Offline sandbox"}
          </span>
        </header>
        <div className="content">
          <div className="heading">
            <div>
              <p className="eyebrow">SMARTER JOURNEYS, STATION BY STATION</p>
              <h1>Every arrival matters.</h1>
              <p className="muted">
                Follow a journey. See the delay. Keep passengers informed.
              </p>
            </div>
            <span className="tag">
              <Radio size={15} />{" "}
              {firebaseMode ? "Live data service" : "Research prototype"}
            </span>
          </div>
          <div className="notice">
            Independent academic prototype. No affiliation with Bangladesh
            Railway. All demo distances, schedules, passengers and alerts are
            simulated.
          </div>
          <section className="searchbar">
            <label>
              Find a train
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Train number or name"
              />
            </label>
            <label>
              Service date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              Departure
              <select
                value={journey?.id || ""}
                onChange={(e) => setSelected(e.target.value)}
              >
                {filtered.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.scheduledTime} · {j.direction}
                  </option>
                ))}
              </select>
            </label>
            <div className="search-result">
              <TrainFront size={20} />
              <span>
                {filtered.length} matching{" "}
                {filtered.length === 1 ? "journey" : "journeys"}
              </span>
            </div>
          </section>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {journey ? (
            <JourneyView
              key={journey.id}
              journey={journey}
              onJourney={(j) => {
                setJourneys((old) => [...old.filter((x) => x.id !== j.id), j]);
                setDate(j.serviceDate);
                setSelected(j.id);
              }}
            />
          ) : (
            <section className="card empty">
              <TrainFront />
              <h2>No matching saved journeys</h2>
              <p>
                Try train 701 on 10 September 2026, or load emulator seed data
                in Firebase mode.
              </p>
              <button
                onClick={() => {
                  setSearch("");
                  setDate(journeys[0]?.serviceDate || "2026-09-10");
                }}
              >
                Show available journeys
              </button>
            </section>
          )}
          <footer>
            SmartRail BD{" "}
            <span>Prototype v0.1 · Times shown in Asia/Dhaka (UTC+06)</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
function JourneyView({
  journey,
  onJourney,
}: {
  journey: Journey;
  onJourney: (j: Journey) => void;
}) {
  const [wallClock, setWallClock] = useState(0);
  useEffect(() => {
    if (!firebaseMode) return;
    setWallClock(Date.now());
    const timer = setInterval(() => setWallClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const [scheduleList, setScheduleList] = useState<ScheduleConfiguration[]>([]);
  const [scheduleId, setScheduleId] = useState(
    journey.scheduleSnapshot.scheduleId,
  );
  const [manualId, setManualId] = useState("");
  useEffect(() => {
    if (!firebaseMode) return;
    return onSnapshot(
      collection(firebaseClient().firestore, "schedules"),
      (s) =>
        setScheduleList(s.docs.map((d) => d.data() as ScheduleConfiguration)),
      (e) => setError(e.message),
    );
  }, []);
  const [tab, setTab] = useState("journey"),
    [adminTab, setAdminTab] = useState("Overview");
  const [live, setLive] = useState<LiveState | null>(null),
    [running, setRunning] = useState(false),
    [subscriptions, setSubscriptions] = useState<Subscription[]>([]),
    [notifications, setNotifications] = useState<Notification[]>([]),
    [threshold, setThreshold] = useState(10),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [station, setStation] = useState("narsingdi"),
    [phone, setPhone] = useState("+8801000000003"),
    [user, setUser] = useState<User | null>(null),
    [isAdmin, setAdmin] = useState(false),
    [email, setEmail] = useState("admin@smartrail.test"),
    [password, setPassword] = useState(""),
    [newDate, setNewDate] = useState(journey.serviceDate),
    [newTime, setNewTime] = useState("12:00");
  useEffect(() => {
    if (!firebaseMode) return;
    const c = firebaseClient();
    const stops = [
      onValue(
        ref(c.database, `liveJourneys/${journey.id}`),
        (s) => setLive(s.exists() ? toLiveView(s.val(), journey) : null),
        (e) => setError(e.message),
      ),
      onSnapshot(
        doc(c.firestore, "systemConfig/global"),
        (s) => setThreshold(s.data()?.delayMinutes || 10),
        (e) => setError(e.message),
      ),
      onAuthStateChanged(c.auth, async (u) => {
        setUser(u);
        setAdmin(!!(await u?.getIdTokenResult())?.claims.admin);
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }, [journey.id]);
  useEffect(() => {
    if (!firebaseMode || !isAdmin) return;
    const c = firebaseClient();
    const stops = [
      onSnapshot(
        query(
          collection(c.firestore, "notifications"),
          where("journeyId", "==", journey.id),
        ),
        (s) => setNotifications(s.docs.map((d) => d.data() as Notification)),
        (e) => setError(e.message),
      ),
      onSnapshot(
        query(
          collection(c.firestore, "subscriptions"),
          where("journeyId", "==", journey.id),
        ),
        (s) => setSubscriptions(s.docs.map((d) => d.data() as Subscription)),
        (e) => setError(e.message),
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [isAdmin, journey.id]);
  async function step(wait = false) {
    if (firebaseMode) {
      try {
        const result = await api("/simulate", {
          journeyId: journey.id,
          action: wait ? "HOLD" : "STEP",
        });
        if (result.live.completed) setRunning(false);
      } catch (e) {
        setError((e as Error).message);
        setRunning(false);
      }
      return;
    }
    try {
      const timestamp =
        (live?.timestamp || journey.departureMs) + (wait ? 12 : 3) * 60000;
      const distance = Math.min(
        journey.route.points.at(-1)!.cumulativeM,
        (live?.chainageM || 0) + (wait ? 0 : 1800),
      );
      const ping = {
        ...coordinateAt(journey.route, distance),
        journeyId: journey.id,
        deviceId: "demo-gnss",
        source: "SIMULATOR" as const,
        timestamp,
        sequence: (live?.sequence || 0) + 1,
        accuracyM: 8,
      };
      const next = ingest(journey, ping, live, timestamp);
      setLive(next);
      setNotifications((old) => [
        ...old,
        ...notificationsFor(
          journey,
          next,
          subscriptions,
          new Set(old.map((n) => n.id)),
          threshold,
        ),
      ]);
      if (next.completed) setRunning(false);
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
    }
  }
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => step(), 1200);
    return () => clearTimeout(timer);
  });
  async function act(work: () => Promise<void>) {
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function importTickets() {
    if (firebaseMode) {
      await api("/mock-tickets", { journeyId: journey.id });
    } else
      setSubscriptions((old) => [
        ...old.filter((s) => s.source !== "TICKET"),
        ...ticketSubscriptions(journey),
      ]);
    setMessage(
      "Two fake tickets imported. Boarding-station subscriptions are active until journey expiry.",
    );
  }
  async function subscribe() {
    if (
      live?.completed ||
      live?.predictions.find((p) => p.pointId === station)?.passed
    )
      throw new Error(
        "This boarding station has already been passed. Choose a later journey.",
      );
    if (!/^\+880100000\d{4}$/.test(phone))
      throw new Error("Use a fake number in the +8801000000000–9999 range.");
    if (firebaseMode) {
      if (!user) await signInAnonymously(firebaseClient().auth);
      const result = await api("/subscribe", {
        journeyId: journey.id,
        boardingPointId: station,
        phone,
      });
      setManualId(result.id);
    } else {
      const id = `manual-${station}-${phone}`;
      setSubscriptions((old) => [
        ...old.filter((s) => s.id !== id),
        {
          id,
          journeyId: journey.id,
          boardingPointId: station,
          phone,
          passengerId: "demo-manual",
          source: "MANUAL",
          expiresAt: journey.expiresAt,
          active: true,
        },
      ]);
    }
    setMessage(
      "Subscribed to a single mock delay alert for your boarding station.",
    );
  }
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(
        context.registerTool(
          {
            name: "get_selected_journey_state",
            description:
              "Read the selected SmartRail journey, station predictions and simulation status. No passenger information is returned.",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: false },
            execute: (input: unknown) => {
              if (
                !input ||
                typeof input !== "object" ||
                Array.isArray(input) ||
                Object.keys(input).length
              )
                throw new Error("Expected an empty object");
              return {
                journeyId: journey.id,
                mode: firebaseMode ? "firebase" : "demo",
                progress: live?.progress || 0,
                predictions: live?.predictions || [],
                running,
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, [journey.id, live, running]);
  const stale = firebaseMode && live && wallClock - live.timestamp > 120000;
  const nextPoint = journey.route.points.find(
    (p) => p.id === live?.nextPointId,
  );
  const nextPrediction = live?.predictions.find(
    (p) => p.pointId === nextPoint?.id,
  );
  const lastPrediction = live?.predictions.at(-1);
  const adminAllowed = !firebaseMode || isAdmin;
  return (
    <>
      <div className="tabs">
        <button
          className={tab === "journey" ? "selected" : ""}
          onClick={() => setTab("journey")}
        >
          <MapPin size={17} /> Passenger journey
        </button>
        <button
          className={tab === "admin" ? "selected" : ""}
          onClick={() => setTab("admin")}
        >
          <Layers size={17} /> Prototype operations
        </button>
      </div>
      <div aria-live="polite">
        {message && <p className="success">{message}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      {tab === "journey" ? (
        <>
          <div className="journey-title">
            <div>
              <span className="train-number">{journey.trainNumber}</span>
              <h2>{journey.trainSnapshot?.name || "Archived train"}</h2>
              <span className="muted">{journey.route.name}</span>
            </div>
            <span className="badge">
              {live?.completed
                ? "Journey complete"
                : live
                  ? stale
                    ? "GPS stale · last known position"
                    : "Tracking active"
                  : "Awaiting GPS"}
            </span>
          </div>
          <section className="stats">
            <Stat
              label="NEXT ROUTE POINT"
              value={live ? nextPoint?.name || "Arrived" : "Awaiting fix"}
              detail={
                nextPrediction
                  ? `Expected ${format(nextPrediction.etaMs)}`
                  : "Start the simulation below"
              }
              icon={<MapPin />}
            />
            <Stat
              label="PREDICTED DELAY"
              value={
                nextPrediction ? `${nextPrediction.delayMinutes} min` : "—"
              }
              detail="At the next route point"
              icon={<Clock3 />}
              warning={
                !!nextPrediction && nextPrediction.delayMinutes >= threshold
              }
            />
            <Stat
              label="DESTINATION ETA"
              value={lastPrediction ? format(lastPrediction.etaMs) : "—"}
              detail="Bhairab Bazar · Bangladesh time"
              icon={<TrainFront />}
            />
            <Stat
              label="ROUTE PROGRESS"
              value={`${Math.round((live?.progress || 0) * 100)}%`}
              detail={`${((live?.chainageM || 0) / 1000).toFixed(1)} of 91 demo km`}
              icon={<Activity />}
            />
          </section>
          <div className="journey-grid">
            <section className="card map-card">
              <div className="card-head">
                <h3>Journey map</h3>
                <span className="small">
                  <span className="dot" />{" "}
                  {live
                    ? `${format(live.timestamp)} · ${live.source}`
                    : "Waiting for first location"}
                </span>
              </div>
              <RailMap journey={journey} live={live} />
              <div className="map-legend">
                <span>
                  <i className="line-key" /> Demo route geometry
                </span>
                <span>
                  <i className="train-key" /> Train position
                </span>
                <span>Approximate geography</span>
              </div>
              {(!firebaseMode || isAdmin) && (
                <div className="simulator">
                  <div>
                    <strong>GPS simulator</strong>
                    <small>Each step advances 3 journey minutes.</small>
                  </div>
                  <div className="button-group">
                    <button
                      className="primary"
                      disabled={live?.completed}
                      onClick={() => setRunning(!running)}
                    >
                      {running ? <Pause size={16} /> : <Play size={16} />}{" "}
                      {running ? "Pause" : "Run"}
                    </button>
                    <button
                      disabled={running || live?.completed}
                      onClick={() => step()}
                    >
                      Step
                    </button>
                    <button
                      disabled={live?.completed}
                      onClick={() => step(true)}
                    >
                      +12 min hold
                    </button>
                    <button
                      disabled={firebaseMode}
                      aria-label="Reset offline sandbox"
                      title="Reset GPS and mock alerts"
                      onClick={() => {
                        setRunning(false);
                        setLive(null);
                        setNotifications([]);
                      }}
                    >
                      <RotateCcw size={16} />
                    </button>
                  </div>
                </div>
              )}
            </section>
            <section className="card route-card">
              <div className="card-head">
                <h3>Along the route</h3>
                <span className="small">6 points</span>
              </div>
              <div className="route-list">
                {journey.route.points.map((p, i) => {
                  const pred = live?.predictions[i];
                  return (
                    <div
                      key={p.id}
                      className={`route-stop ${pred?.passed ? "passed" : ""}`}
                    >
                      <span className="stop-dot" />
                      <div>
                        <strong>{p.name}</strong>
                        <small>
                          {kindLabel[p.kind]} · {p.cumulativeM / 1000} km
                        </small>
                      </div>
                      <div className="stop-time">
                        <strong>
                          {pred
                            ? pred.passed
                              ? "Passed"
                              : format(pred.etaMs)
                            : "—"}
                        </strong>
                        {pred && !pred.passed && (
                          <small
                            className={
                              pred.delayMinutes >= threshold ? "orange" : ""
                            }
                          >
                            +{pred.delayMinutes} min
                          </small>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="route-foot">
                ETA uses configured travel, dwell and bounded recent-speed
                adjustment.
              </div>
            </section>
          </div>
          <div className="bottom-grid">
            <section className="card subscription">
              <div className="card-head">
                <div>
                  <p className="eyebrow">YOUR BOARDING STATION</p>
                  <h3>A useful alert, at the right time.</h3>
                </div>
                <Bell className="teal" />
              </div>
              <p className="muted">
                Receive a mock SMS when your station’s predicted delay reaches{" "}
                {threshold} minutes.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(subscribe);
                }}
              >
                <label>
                  Boarding station
                  <select
                    value={station}
                    onChange={(e) => setStation(e.target.value)}
                  >
                    {journey.route.points
                      .filter((p) => p.passengerBoardingAllowed)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Fake mobile number
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </label>
                <button className="primary" type="submit">
                  Subscribe <ArrowUpRight size={16} />
                </button>
              </form>
              {manualId && (
                <button
                  onClick={() =>
                    void act(async () => {
                      await api("/unsubscribe", { subscriptionId: manualId });
                      setManualId("");
                      setMessage("Manual subscription cancelled.");
                    })
                  }
                >
                  Cancel my manual subscription
                </button>
              )}
              <small>
                No real SMS is sent. Subscription expires with this journey.
              </small>
            </section>
            <section className="card pipeline">
              <div className="card-head">
                <h3>The first pipeline</h3>
                <Ticket className="teal" />
              </div>
              <ol>
                <li>Import two fake passenger tickets</li>
                <li>Run GPS, then add a 12-minute hold</li>
                <li>Inspect station-specific mock SMS alerts</li>
              </ol>
              <button
                onClick={() => {
                  setTab("admin");
                  setAdminTab("Notifications");
                }}
              >
                Open prototype operations <ChevronRight size={16} />
              </button>
            </section>
          </div>
        </>
      ) : (
        <section className="card admin">
          <div className="card-head">
            <div>
              <p className="eyebrow">OPERATIONS CONSOLE</p>
              <h2>One journey, end to end.</h2>
            </div>
            <span className="badge">
              {firebaseMode
                ? isAdmin
                  ? "Administrator"
                  : "Sign-in required"
                : "Demo sandbox"}
            </span>
          </div>
          {firebaseMode && !isAdmin ? (
            <form
              className="login"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await signInWithEmailAndPassword(
                    firebaseClient().auth,
                    email,
                    password,
                  );
                  setMessage(
                    "Signed in. Admin access requires a trusted custom claim.",
                  );
                });
              }}
            >
              <p>
                Use the administrator account created by the emulator seed
                script.
              </p>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <button className="primary">Sign in</button>
            </form>
          ) : (
            <>
              <div className="admin-nav">
                {[
                  "Overview",
                  "Routes & trains",
                  "Journeys",
                  "Tickets",
                  "Notifications",
                  "Devices & operators",
                  "Analytics",
                ].map((name) => (
                  <button
                    key={name}
                    className={adminTab === name ? "selected" : ""}
                    onClick={() => setAdminTab(name)}
                  >
                    {name}
                  </button>
                ))}
                {firebaseMode && (
                  <button
                    onClick={() =>
                      void act(async () => {
                        await signOut(firebaseClient().auth);
                        setNotifications([]);
                        setSubscriptions([]);
                      })
                    }
                  >
                    <LogOut size={16} /> Sign out
                  </button>
                )}
              </div>
              {adminAllowed && (
                <>
                  {adminTab === "Overview" && (
                    <div className="admin-body">
                      <h3>Prototype controls</h3>
                      <p>
                        Import tickets before running GPS. Alerts are evaluated
                        on each accepted GPS fix.
                      </p>
                      <div className="button-group">
                        <button
                          className="primary"
                          onClick={() => void act(importTickets)}
                        >
                          Import mock e-tickets
                        </button>
                        <button onClick={() => setTab("journey")}>
                          Go to live map
                        </button>
                      </div>
                      <label className="threshold">
                        Delay alert threshold (minutes)
                        <input
                          type="number"
                          min="1"
                          max="120"
                          value={threshold}
                          onChange={(e) => {
                            const value = Number(e.target.value);
                            if (
                              Number.isInteger(value) &&
                              value >= 1 &&
                              value <= 120
                            )
                              setThreshold(value);
                          }}
                        />
                      </label>
                      {firebaseMode && (
                        <button
                          onClick={() =>
                            void act(async () => {
                              await api("/threshold", {
                                delayMinutes: threshold,
                              });
                              setMessage("Threshold saved.");
                            })
                          }
                        >
                          Save threshold
                        </button>
                      )}
                      <p className="small">
                        One mock SMS per recipient / journey / boarding station.
                        Subscriptions: {subscriptions.length}. Alerts:{" "}
                        {notifications.length}.
                      </p>
                    </div>
                  )}
                  {adminTab === "Routes & trains" && (
                    <div className="admin-body">
                      <h3>
                        {train.number} · {journey.trainSnapshot.name}
                      </h3>
                      <p>
                        Route {journey.route.id} · v{journey.route.version} ·{" "}
                        {journey.direction}. Demo distances must be replaced by
                        surveyed railway chainage.
                      </p>
                      {firebaseMode && (
                        <MasterEditor
                          journey={journey}
                          onSaved={() =>
                            setMessage(
                              "Master configuration saved. Existing journey snapshots remain unchanged.",
                            )
                          }
                        />
                      )}
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Route point</th>
                              <th>Type</th>
                              <th>Segment m</th>
                              <th>Cumulative m</th>
                              <th>Travel min</th>
                              <th>Dwell min</th>
                            </tr>
                          </thead>
                          <tbody>
                            {journey.route.points.map((p) => (
                              <tr key={p.id}>
                                <td>{p.name}</td>
                                <td>{kindLabel[p.kind]}</td>
                                <td>{p.segmentM}</td>
                                <td>{p.cumulativeM}</td>
                                <td>{p.segmentMinutes}</td>
                                <td>{p.dwellMinutes}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="small">
                        This first slice provisions routes and trains through
                        the validated seed script. Full editing is phase 2.
                      </p>
                    </div>
                  )}
                  {adminTab === "Journeys" && (
                    <div className="admin-body">
                      <h3>Create a journey from a saved schedule</h3>
                      <p className="mono">{journey.id}</p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void act(async () => {
                            const j = firebaseMode
                              ? (
                                  await api("/journey", {
                                    serviceDate: newDate,
                                    scheduleId,
                                  })
                                ).journey
                              : makeJourney(newDate, newTime);
                            onJourney(j);
                          });
                        }}
                      >
                        <label>
                          Service date
                          <input
                            type="date"
                            required
                            value={newDate}
                            onChange={(e) => setNewDate(e.target.value)}
                          />
                        </label>
                        {firebaseMode ? (
                          <label>
                            Saved schedule
                            <select
                              value={scheduleId}
                              onChange={(e) => setScheduleId(e.target.value)}
                            >
                              {scheduleList.map((s) => (
                                <option key={s.scheduleId} value={s.scheduleId}>
                                  {s.trainNumber} · {s.scheduledDepartureTime} ·{" "}
                                  {s.direction}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <label>
                            Sandbox scheduled time
                            <input
                              type="time"
                              required
                              value={newTime}
                              onChange={(e) => setNewTime(e.target.value)}
                            />
                          </label>
                        )}
                        <button className="primary">Create journey</button>
                      </form>
                      <p className="small">
                        Identity includes train number, date, scheduled time,
                        route and direction. Backend device assignment is
                        provisioned separately.
                      </p>
                    </div>
                  )}
                  {adminTab === "Tickets" && (
                    <div className="admin-body">
                      <h3>Mock e-ticket integration</h3>
                      <button
                        className="primary"
                        onClick={() => void act(importTickets)}
                      >
                        Import / refresh two fake tickets
                      </button>
                      <p>
                        Fake passengers:{" "}
                        {passengers.map((p) => p.name).join(", ")}. No official
                        ticketing API is connected.
                      </p>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Subscription source</th>
                              <th>Boarding point</th>
                              <th>Fake recipient</th>
                              <th>Expires</th>
                            </tr>
                          </thead>
                          <tbody>
                            {subscriptions.map((s) => (
                              <tr key={s.id}>
                                <td>{s.source}</td>
                                <td>{s.boardingPointId}</td>
                                <td>{s.phone}</td>
                                <td>{format(s.expiresAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!subscriptions.length && (
                        <p>
                          Import tickets to automatically create temporary
                          subscribers.
                        </p>
                      )}
                    </div>
                  )}
                  {adminTab === "Notifications" && (
                    <div className="admin-body">
                      <div className="card-head">
                        <h3>
                          Mock SMS outbox{" "}
                          <span className="count">{notifications.length}</span>
                        </h3>
                        <button onClick={() => void act(importTickets)}>
                          Import mock tickets
                        </button>
                      </div>
                      {!notifications.length ? (
                        <div className="empty">
                          <Bell />
                          <h3>No alerts yet</h3>
                          <p>
                            Import tickets, then run the GPS simulator and add a
                            12-minute hold.
                          </p>
                          <button onClick={() => setTab("journey")}>
                            Open live journey
                          </button>
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <article className="sms" key={n.id}>
                            <div>
                              <strong>{n.phone}</strong>
                              <span className="tag">Mock sent</span>
                              <small>
                                {format(n.createdAt)} · {n.boardingPointId} · +
                                {n.delayMinutes} min
                              </small>
                            </div>
                            <p>{n.message}</p>
                          </article>
                        ))
                      )}
                    </div>
                  )}
                  {adminTab === "Devices & operators" && (
                    <div className="admin-body">
                      <h3>GPS trust boundary</h3>
                      <p>
                        Dedicated GNSS + cellular is primary. A registered
                        operator phone is accepted only after 120 seconds
                        without a primary fix.
                      </p>
                      <p>
                        HTTPS ingestion checks device assignment, device key or
                        Firebase operator identity, timestamp, sequence,
                        accuracy, route proximity, direction and plausible
                        speed.
                      </p>
                      <p className="small">
                        Device credentials remain server-only. Emulator seed
                        provisions one primary device and one fallback operator.
                        A future MQTT bridge must authenticate topic ownership
                        and call the same ingestion service. No MQTT broker is
                        included.
                      </p>
                    </div>
                  )}
                  {adminTab === "Analytics" && (
                    <div className="admin-body">
                      <h3>Journey summary</h3>
                      <div className="stats">
                        <Stat
                          label="PROGRESS"
                          value={`${Math.round((live?.progress || 0) * 100)}%`}
                          detail="Current route"
                          icon={<Activity />}
                        />
                        <Stat
                          label="SUBSCRIPTIONS"
                          value={String(subscriptions.length)}
                          detail="Tickets + manual"
                          icon={<Ticket />}
                        />
                        <Stat
                          label="MOCK ALERTS"
                          value={String(notifications.length)}
                          detail="Unique recipients / stations"
                          icon={<Bell />}
                        />
                      </div>
                      <p>
                        Accepted GPS fixes are retained by the Firebase backend
                        for future historical calibration. No learned model or
                        historical accuracy claim is made in this version.
                      </p>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
function Stat({
  label,
  value,
  detail,
  icon,
  warning = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  warning?: boolean;
}) {
  return (
    <div className={`stat ${warning ? "warning" : ""}`}>
      <div className="stat-label">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}
