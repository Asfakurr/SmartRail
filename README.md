# SmartRail BD

**Intelligent Train Delay Detection, Real-Time Tracking, ETA Prediction and Passenger Notification System.**

SmartRail BD is an independent FYP research prototype. Saved schedules produce daily journey instances; validated GPS drives live tracking, railway progress, station-specific ETA/delay and passenger Mock SMS. Phase 2.1 includes journey lifecycle automation and manual administrative controls. It is a simulated demonstration, not an official Bangladesh Railway system or a production service.

## Current prototype features

- **Master data:** reusable trains (identified by Train Number), routes, six route-point types, configured railway distances/geometry, schedules and schedule GPS-device assignments.
- **Journey automation:** weekday/valid-date eligibility, Asia/Dhaka service dates, deterministic schedule/date IDs, multiple services per train per day, overnight timetables, immutable configuration snapshots and reconciliation recovery.
- **Lifecycle:** SCHEDULED → READY → RUNNING → COMPLETED; admin cancellation from nonterminal states. Time-based readiness, validated GPS/manual start, departure deviation, conservative GPS/manual completion and device release/reuse.
- **Tracking and ETA:** simulator through trusted ingestion, GPS validation/map matching, Leaflet live map, railway progress, upcoming station ETA/delay and bounded recent-speed adjustment.
- **Passengers:** fake tickets automatically create temporary subscriptions; manual subscription/cancellation, station-specific Mock SMS, atomic duplicate prevention and terminal subscription cleanup.
- **Reliability:** transactional lifecycle changes, deterministic journey/notification identities and guards against concurrent starts, terminal transitions and subscription creation.

## Stack and architecture

Next.js 16 / React 19, TypeScript, Tailwind CSS 4, Firebase Authentication, Cloud Firestore, Firebase Realtime Database, Node.js/Firebase Cloud Functions, Leaflet/OpenStreetMap and a Mock SMS service. Local demonstrations use the Firebase Emulator Suite. Functions target Node.js 22.

```text
Saved train / route / schedule
  → daily journey reconciliation → SCHEDULED → time reconciliation → READY
  → validated GPS / admin Start → RUNNING
  → GPS → railway progress → station ETA / delay → subscriptions → Mock SMS
  → conservative destination evidence / admin Complete → COMPLETED
Admin Cancel from any nonterminal state → CANCELLED
```

The scheduled function is implemented but not deployed. Cloud Scheduler cadence does not run automatically in local emulators; invoke generation and readiness explicitly as described in the demo guide.

**Firestore** owns structured configuration, snapshots, lifecycle metadata, history and private passenger records:

- `trains/{trainNumber}`, `routes/{routeId}` with `points`, `segments`, `geometry` children; `schedules/{scheduleId}/timings/{routePointId}`.
- `journeys/{journeyId}` with `routePoints`, `gpsHistory`, `events`, `predictionHistory` children.
- `gpsDevices`, `operators`, `passengers`, `mockTickets`, `subscriptions`, `notifications`, `systemConfig/global`.
- Backend coordination uses `liveInternal`, `deviceCheckpoints`, `deviceStartLocks` and the legacy/manual `journeyKeys` index.

**Realtime Database** projects current state under `/liveJourneys/{journeyId}`: `position`, `tracking`, `progress`, `stationPredictions`, revision and stopped-stream metadata. Backend logic owns validated GPS, progress, ETA and notification history; browser clients cannot authoritatively write these. Admin operations use authenticated backend endpoints.

## Run locally

From this repository root, use Node.js 22, pnpm 11.19.0 and Java 21+. Preserve existing environment files and emulator exports.

```sh
pnpm install
test -f .env.local || cp .env.example .env.local
pnpm emulators
```

On a fresh clone without `.emulator-data`, replace the last command with:

```sh
pnpm functions:build
pnpm exec firebase emulators:start --project demo-smartrail-bd --only auth,firestore,database,functions --export-on-exit=.emulator-data
```

In another terminal:

```sh
pnpm seed
pnpm dev --port 3010
```

Open the [app](http://127.0.0.1:3010/) and [Emulator UI](http://127.0.0.1:4000/). Under **Prototype operations**, use the local fake account `admin@smartrail.test` / `DemoRail2026!`. `.env.example` selects Firebase emulator mode and the local API on port 5001; no production credentials are needed. Other ports: Auth 9099, Firestore 8080, RTDB 9000.

The default seed reuses train `701`, route `dhaka-bhairab-demo`, schedule `701-0800` and a manual MVP journey. It does not reset terminal history. `pnpm simulate` targets that legacy manual demo; for the current generated lifecycle and an unexpired ticket window, follow the **[Demo guide](docs/DEMO_GUIDE.md)**. Browser-only demo mode is a separate sandbox, not evidence of the Firebase pipeline.

Stop emulators with Ctrl+C and let export finish. See [HANDOFF](HANDOFF.md) for workstation-specific installed-binary fallbacks.

## Testing and verified baseline

Recorded Phase 2.1 baseline at `8cb2e54` (not rerun for this documentation update):

| Check | Result |
| --- | --- |
| Unit tests | 57/57 PASS |
| Generation, lifecycle, GPS-start, original MVP integrations | PASS, isolated emulator databases |
| Completion/cancellation integration | Clock-dependent fixture issue; not consistently green |
| Frontend and backend TypeScript | PASS |
| Production build / static export | PASS |
| Visual rehearsal | PASS, including completion/cancellation and terminal passenger state |

The completion fixture still uses today's fixed **08:00** schedule. Its ticket import uses the real clock and can return `Journey is closed` after the subscription window expires. This is a known fixture limitation; it was not changed for submission preparation. Use a current-time schedule for the demonstration.

```sh
pnpm test
pnpm typecheck
pnpm build
# Stop demo emulators first. This runs the original MVP integration only:
pnpm test:emulators
```

For Phase 2.1 suites, start each in its own empty emulator database (no `--import`):

```sh
pnpm functions:build
for suite in generation-integration lifecycle-integration gps-start-integration integration completion-integration; do
  pnpm exec firebase emulators:exec --project demo-smartrail-bd --only auth,firestore,database,functions "node --import tsx scripts/$suite.ts"
done
```

Inspect each result; the loop's final exit status is not a combined report. Verification used Node 24.19; the configured Functions target remains Node 22.

## Prototype boundaries

Railway geometry/distances and GPS are illustrative, not surveyed or hardware-verified. Completion uses conservative destination heuristics; true station arrival/departure detection is absent. Basic primary/fallback selection exists, but advanced tracking-health management is deferred. ETA is configured-time/speed based, not historical/adaptive ML. There is no real Railway/e-ticket API, production SMS, deployed MQTT or production scheduler verification. Cancellation does not send an SMS. No production readiness or measured ETA accuracy is claimed.

## Documentation

- [Demo guide](docs/DEMO_GUIDE.md) and [submission checklist](docs/SUBMISSION_CHECKLIST.md).
- [Completion/cancellation and current lifecycle](docs/JOURNEY_COMPLETION.md).
- [Schedule/date foundation](docs/SCHEDULE_FOUNDATION.md), [generation](docs/JOURNEY_GENERATION.md), [readiness](docs/JOURNEY_LIFECYCLE.md), [GPS start](docs/GPS_JOURNEY_START.md): chronological implementation notes; later phases supersede their deferred-work statements.
- [HANDOFF](HANDOFF.md): recovery details and historical MVP verification.
