# Phase 2.1 — completion, cancellation and demo lifecycle

Extends the existing generated-journey lifecycle and GPS ingestion. No ETA, geometry, station detection, real SMS, deployment or Git commit changes.

## Destination evidence

A generated RUNNING journey completes only after two chronological VALID observations for the same assigned device and journey. Both must have at least 98% configured railway progress and lie within a conservative 750 m destination bound (matched-coordinate geographic distance plus matching deviation). This uses geographic proximity only for arrival evidence, never as operational track distance. The observations must be no more than five minutes apart. Existing timestamp, accuracy, speed/jump, source authorization and matching validation still apply first. RUNNING device precedence is unchanged.

`systemConfig/global`, merged with shared defaults, exposes:

- `completionMinProgress: 0.98` (admin validation: 0.98–1).
- `completionRadiusM: 750` (100–1000 m).
- `completionMaxObservationGapMs: 300000` (1000–600000 ms).

One fix, elapsed scheduled arrival, stale GPS, disconnect or ETA zero cannot complete a journey. A 12-minute simulator HOLD interrupts the observation pair; use two subsequent STEP fixes near the destination or manual Complete.

Automatic `actualArrivalAt` is the second qualifying fix's epoch-millisecond timestamp; `transitionSource` is `GPS_AUTO`. Manual Complete uses trusted backend time and `ADMIN_MANUAL`. Both preserve scheduled timestamps, serviceDate, snapshots and existing actual departure fields.

## Admin endpoints and concurrency

All endpoints require the existing Firebase admin Bearer ID token and reject client timestamps:

```text
POST /start-journey     {"journeyId":"..."}             READY -> RUNNING
POST /complete-journey  {"journeyId":"..."}             RUNNING -> COMPLETED
POST /cancel-journey    {"journeyId":"...","reason":"Demo cancellation"}
```

Cancel accepts SCHEDULED, READY or RUNNING; a trimmed 1–300 character reason is required. It records `cancelledAt`, `cancellationReason`, `cancelledBy` (existing admin UID), `statusUpdatedAt` and `transitionSource: ADMIN_MANUAL`. Repeating the same terminal action returns UNCHANGED and does not rewrite metadata. A conflicting terminal action fails; the first valid committed transition wins.

The centralized Firestore transaction writes terminal state, subscription cleanup and active-device release together. GPS completion joins the ingestion transaction. No RAM lifecycle state is used. Ticket imports/manual subscriptions read the journey transactionally, preventing activation after completion/cancellation races. All matching subscriptions become inactive and expiry is capped; normal ETA/SMS evaluation stops. Cancellation SMS is intentionally omitted. Existing delay-notification deduplication is unchanged.

Owned `deviceStartLocks/{deviceId}` records are deleted. Queries consider only RUNNING/READY journeys, so terminal journeys stop blocking future starts while historical device IDs remain in snapshots. A packet naming an old generated journey can still route to another eligible active journey under the existing device-precedence policy; it cannot reactivate or mutate the terminal journey.

The durable `liveInternal` record and its ordered RTDB projection retain final position/progress, mark `completed: true` for either terminal state (existing stopped-stream convention), and clear predictions. Firestore journey status distinguishes cancelled from completed. No artificial live position is created when cancellation precedes any GPS.

## Minimal UI

Journey choices show raw status and identify generated services. In **Prototype operations → Journeys**, generated journeys expose only valid Start/Complete/Cancel actions, actual timestamps and cancellation reason. Cancel requires a reason and confirmation. Terminal journeys have no lifecycle actions.

Passenger status shows Scheduled, Awaiting Departure, Tracking active, Journey Completed or Service Cancelled. Terminal views suppress ETA/delay, stop simulator controls and disable new subscriptions. Final map/progress remains available. Firestore status listeners survive refresh.

## Local generated demo

Use the existing startup commands from HANDOFF.md:

```sh
pnpm emulators
pnpm seed
pnpm dev --port 3010
```

Open http://127.0.0.1:3010 and sign in under Prototype operations with the local fake admin (`admin@smartrail.test`, `DemoRail2026!`). The original `pnpm simulate` still runs the legacy manual MVP demo; use the UI simulator for a generated service.

For a local generated service, invoke the existing admin `/reconcile-journeys` endpoint with today's Asia/Dhaka serviceDate. This endpoint only generates eligible saved schedules; it does not advance journeys to READY. Local rehearsal must also invoke the backend readiness reconciliation service against the emulator before demonstrating Start. The scheduled `reconcileJourneyOperations()` path combines generation and readiness, but Cloud Scheduler's 15-minute cadence does not run automatically in the local emulator. For a controlled demonstration at any wall-clock time, the integration suite below invokes the same generation/readiness services with a test clock; no production clock override endpoint was added.

Select the generated service in the journey dropdown. A saved schedule more than 30 minutes in the future remains SCHEDULED; choose an eligible current/due service for READY. Import mock tickets before movement. Click Run on the passenger map: the first two steps provide departure evidence, a +12 min hold introduces delay, and two destination fixes complete the journey. Alternatively use Start then Complete in operations. Use another generated service to show cancellation. Do not change terminal history to replay: create/use another saved schedule or service date.

## Isolated verification

Preserve demo exports; run each integration suite against a fresh emulator without `--import`:

```sh
pnpm functions:build
for suite in generation-integration lifecycle-integration gps-start-integration completion-integration integration; do
  pnpm exec firebase emulators:exec --project demo-smartrail-bd --only auth,firestore,database,functions "node --import tsx scripts/$suite.ts" || break
done
pnpm test
pnpm typecheck
pnpm build
```

Installed-binary/workstation fallbacks remain in HANDOFF.md. The completion suite covers saved master -> generated SCHEDULED -> READY -> simulated RUNNING -> live RTDB/progress/ETA/deduplicated ticket SMS -> COMPLETED, plus manual fallback, cancellations, device reuse, immutable snapshots, stale non-completion, authorization and concurrent auto/manual/Cancel/subscription races.

## Verification result — 2026-09-15

57/57 unit tests PASS; generation, readiness/lifecycle, GPS-start, new completion/cancellation, and legacy MVP integrations all PASS in separate empty emulator suites. Backend/frontend TypeScript and production build/static export PASS. Local HTTP smoke: 200.

The in-app browser returned ERR_NETWORK_IO_SUSPENDED, so interactive admin-button/confirmation and passenger refresh/visual verification could not be completed. Status/action mappings are covered by focused unit tests; final visual rehearsal remains necessary before submission. The disposable UI test emulator and dev server were stopped; existing demo exports are untouched.

No known blocking failure remains in the tested backend flow. Prototype limitations: illustrative railway geometry, conservative completion may require manual fallback, no cancellation SMS, and scheduler cadence is not deployed/automatically exercised locally. Node 24.19 was used for verification; configured deployment runtime remains Node 22. No commit or deployment performed.
