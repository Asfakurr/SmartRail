# Phase 2.1 Prompt 1B — automatic journey reconciliation

Uses the Prompt 1A foundation without migrating timetables or replacing manual creation. No deployment or Git commit is performed by this implementation session.

## Entry points

- `functions/src/journey-generation.ts`: `ensureJourneysForServiceDate(serviceDate)`.
- `reconcileTodaysJourneys(now = Date.now())`: explicit Asia/Dhaka clock boundary, today only.
- `reconcileScheduledJourneys`: Firebase v2 `onSchedule`, every 15 minutes, timezone Asia/Dhaka, region asia-south1, retryCount 3. Logs a JSON summary; schedule failures cause a retry after the remaining schedules have been processed. Global Firestore failures propagate.
- Admin-only POST `/reconcile-journeys` with JSON `{ "serviceDate": "2026-09-14" }`, using the existing Firebase Bearer ID token. No UI added. The endpoint returns per-schedule failures in the summary; it does not silently report them as created.

The scheduled function is defined in source but is not deployed. Local emulator suites do not run Cloud Scheduler cadence automatically. Tests invoke the same service and injected-clock boundary directly. In a deployed Firebase setup, Cloud Scheduler invokes the function; no in-memory timer/startup state is required.

## Flow and atomicity

Validate serviceDate, list saved schedules, and process each in a Firestore transaction. The deterministic ID is `generated_<scheduleId>__<YYYY-MM-DD>`. First check whether that document exists; return existing without changing it, even if the master has since been deactivated or damaged. An occupied ID belonging to a different kind of journey is reported as a failure, not overwritten.

For a missing journey, reread its saved schedule inside the transaction, check centralized eligibility, load the train/route/schedule via `loadJourneyMaster`, and call the existing `createJourneySnapshot`. `writeJourneySnapshot` atomically creates the journey and its routePoints children. Manual and generated flows share these helpers. Concurrent executions conflict on the same deterministic document; Firestore retries the transaction and observes the winner. Failed transactions cannot leave partial snapshots.

The summary contains serviceDate, eligibleCount, createdCount, existingCount, skippedCount, failedCount and failures (scheduleId/message). eligibleCount counts missing-journey attempts that passed eligibility; existing documents are counted directly without revalidating historical master configuration. The created/existing/skipped/failed outcome counts partition the schedules processed.

## Stored document and compatibility

New metadata is optional on the shared Journey type:

```ts
generationSource?: "SCHEDULE";
generatedAt?: number; // epoch milliseconds, equal to createdAt at generation
```

Generated documents contain existing `id`, `journeyId`, `businessKey`, `schemaVersion: 2`, `status: "SCHEDULED"`, `serviceDate`, `trainNumber`, `departureMs`, `createdAt`, `expiresAt`, `trainSnapshot`, `routeSnapshot`, `scheduleSnapshot`, `routePointSnapshots`, and the compatibility route view. Schedule identity and device IDs remain in `scheduleSnapshot.scheduleId` and `.gpsDeviceIds`. Destination arrival remains in the destination route-point snapshot, without adding another duplicate field.

The train model has no separate default-device field. Existing default assignments belong to reusable schedules. Their identifier list is copied into the snapshot and may now be empty; no device reassignment or implicit device lookup occurs. No device is required merely to create a scheduled journey. Existing GPS source authentication remains unchanged.

Origin serviceDate remains fixed overnight. UTC epoch-millisecond scheduled timestamps are materialized using Asia/Dhaka utilities and existing elapsed-second timetable offsets. Master edits never rewrite existing journey/station snapshots.

Manual random IDs and their existing business-key reservations remain intact. The generated ID namespace is separate and does not rewrite or adopt manual records. Therefore a manual demo and a generated journey for the same conceptual service can coexist; manual creation remains a development fallback. Automatic reconciliation itself creates exactly one document per schedule/date. It does not insert generated records into the manual `journeyKeys` index, which could otherwise collapse distinct schedules sharing a business key.

Missed runs and restarts recover on the next reconciliation. A newly activated eligible schedule is picked up then. No yesterday catch-up, tomorrow pre-generation or rolling window is implemented.

## Verification commands

Run against an empty isolated emulator suite, without `--import`. Existing demo exports remain untouched. The new script intentionally refuses nonempty schedules and non-loopback Firestore.

```sh
pnpm functions:build
pnpm exec firebase emulators:exec --project demo-smartrail-bd --only auth,firestore,database,functions 'node --import tsx scripts/generation-integration.ts && node --import tsx scripts/integration.ts'
pnpm test
pnpm typecheck
pnpm build
```

If this workstation's pnpm wrapper attempts registry checks, use the documented runtime PATH from HANDOFF.md and equivalent installed binaries:

```sh
node node_modules/typescript/bin/tsc -p functions/tsconfig.json
node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project demo-smartrail-bd --only auth,firestore,database,functions 'node --import tsx scripts/generation-integration.ts && node --import tsx scripts/integration.ts'
```

The new integration test covers true concurrent reconciliations, operating/inactive schedules, same-train multiple services, repeated calls, master-edit preservation, manual coexistence, overnight timestamps, assigned/empty device lists, mid-day activation/missing-service recovery, malformed-schedule isolation, atomic child snapshots, invalid dates and today-only Dhaka clock selection.

Deferred: all new lifecycle transitions beyond SCHEDULED, assignment workflows, operational UI and Prompt 1C.

## Verified results

29/29 unit tests PASS; new generation integration PASS with true concurrent attempts; existing MVP integration PASS; backend and frontend TypeScript PASS; production build/static export PASS. Emulator execution used installed Node 24 (configured deployment target remains Node 22). The scheduled wrapper loaded successfully but its production cadence was not executed or deployed; its shared reconciliation service and Dhaka clock boundary were exercised directly.

Prompt 1C follow-up: the existing periodic job now calls combined generation/readiness orchestration. See JOURNEY_LIFECYCLE.md. The generation-only service and admin endpoint retain their Prompt 1B behavior.
