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

Follow the [current demo guide](DEMO_GUIDE.md) for exact startup, current-time saved configuration, generation-only reconciliation, explicit local READY reconciliation, simulator/ticket/SMS steps and terminal-state checks. Cloud Scheduler cadence does not execute automatically in local emulators. `pnpm simulate` remains the manual MVP CLI path.

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

## Current recorded verification

Baseline `8cb2e54`: 57/57 unit tests PASS; generation, lifecycle, GPS-start and original MVP integrations PASS in isolated emulator databases. Backend/frontend TypeScript and production build/static export PASS. Visual rehearsal PASS, including admin Start/Complete/Cancel, passenger terminal state, subscription cleanup, Mock SMS deduplication and device reuse. The earlier browser suspension was resolved for rehearsal.

The completion/cancellation integration suite is **not consistently green**: its `demoMaster("08:00")` fixture uses today's date, while ticket import checks real-clock expiry. A later rerun failed with `Journey is closed` at fake ticket import. The fixture remains unchanged. This result must not be reported as an unconditional integration PASS; use the current-time demo guide for rehearsal.

Prototype boundaries include illustrative geometry, conservative completion/manual fallback, no cancellation SMS and no locally automatic or deployed scheduler cadence. Verification used Node 24.19; the configured Functions target remains Node 22. This documentation update did not rerun tests or deploy anything.
