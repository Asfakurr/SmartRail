# Phase 2.1 Prompt 1C — SCHEDULED to READY

> Historical implementation notes. Generated completion/cancellation and minimal lifecycle UI are now implemented; see [current lifecycle/demo guide](JOURNEY_COMPLETION.md), which supersedes deferred terminal-work statements below.


Only generated journeys (`generationSource: "SCHEDULE"`) participate. The existing manual/simulator MVP remains a separate compatibility path. No deployment, migration or commit is performed.

## Central transition boundary

`shared/lifecycle.ts` defines the final transition validator:

| From | Allowed target |
| --- | --- |
| SCHEDULED | READY, CANCELLED |
| READY | RUNNING, CANCELLED |
| RUNNING | COMPLETED, CANCELLED |
| COMPLETED | none |
| CANCELLED | none |

Same-state requests return UNCHANGED in the validator. Unknown states, backward edges, skipped states and reopening terminal states throw. These rules prepare future work; they do not enable operational workflows for those edges.

`functions/src/journey-lifecycle.ts::transitionJourneyState(journeyId, target, now)` is the centralized backend boundary. Currently only target READY is enabled. It validates input, reads the authoritative journey inside a Firestore transaction, requires generationSource SCHEDULE, checks the transition and saved departure threshold, then updates status and metadata atomically. Results are TRANSITIONED, UNCHANGED (already READY), or NOT_DUE. Other invalid requests throw. No-op requests write nothing, preserving first-transition metadata. Missing journeys and manual journeys are rejected rather than implicitly migrated.

Future generated lifecycle changes must extend this helper instead of writing status in individual scheduled jobs. The existing legacy GPS and admin-status handlers now reject generated journeys so they cannot bypass this boundary, start them from GPS, or cancel them. Manual MVP behavior retains its existing transitions; no new manual workflow is added.

## Threshold and metadata

The READY threshold is derived from the preserved `journey.departureMs - 30 * 60 * 1000`; no persistent readyAt field or timetable recalculation from master data is needed. Threshold comparison is inclusive. A 23:30 Asia/Dhaka departure is due at 23:00 on its origin service date. A late journey stays READY after departure indefinitely unless a future explicit lifecycle operation changes it. No GPS values enter readiness logic.

Only an effective transition writes:

```ts
status: "READY";
statusUpdatedAt: number; // captured reconciliation time, epoch milliseconds
transitionSource: "SYSTEM_TIME";
```

These metadata fields are optional for compatibility. No event-history subsystem was introduced. Scheduled timestamps, snapshots and serviceDate are unchanged.

## Query and periodic reconciliation

`reconcileJourneyReadiness(now)` selects:

- generationSource == SCHEDULE
- status == SCHEDULED
- departureMs >= now minus 48 hours
- departureMs <= now plus 30 minutes
- ascending departureMs, limit 200 per run

The matching composite collection index is included in firestore.indexes.json. This inspects due generated journeys rather than all historical documents, and includes previous service dates across midnight. Each transaction rechecks eligibility/state after the query, so concurrent reconciliation cannot produce duplicate updates or reactivate a changed terminal journey. Per-journey failures are returned and processing continues.

The 48-hour recovery bound intentionally leaves older stale SCHEDULED records untouched; it is not a historical recovery engine. Large backlogs process in batches on later runs. Persistent failures at the front of a full 200-record batch can delay later candidates; reported failures need correction. This is the explicit prototype capacity bound, not an unlimited catch-up guarantee.

`reconcileJourneyOperations(now)` first generates today's Dhaka services, then reconciles readiness across this bounded window. The existing 15-minute `reconcileScheduledJourneys` function calls it, logs both summaries, and requests retries on failures. No second scheduler or RAM/per-journey timers are introduced. Generation summary failures do not stop readiness processing; global Firestore outages propagate. Newly created overdue services become READY in the same invocation. The existing admin generation endpoint remains generation-only.

Cloud Scheduler cadence is source-defined, not deployed/executed by these local tests. The combined operation and injected clock are tested directly. Deploy the included index alongside the Functions when deployment is separately requested.

## Verification

New unit tests cover all six allowed edges, backward/skipped/terminal rejection, idempotency, the exact 30-minute boundary, late departure, overnight readiness and malformed inputs. New emulator integration tests cover true concurrent READY attempts, unchanged metadata, previous-date/missed-run recovery, terminal/manual exclusion, bounded old-history exclusion, master-edit independence, combined orchestration and guards on legacy GPS/admin paths. The manual simulator is explicitly checked to remain functional.

Run in an empty isolated suite, without importing the saved demo export:

```sh
pnpm functions:build
for suite in generation-integration lifecycle-integration integration; do
  pnpm exec firebase emulators:exec --project demo-smartrail-bd --only auth,firestore,database,functions "node --import tsx scripts/$suite.ts" || break
done
pnpm test
pnpm typecheck
pnpm build
```

Use the installed-binary equivalents from HANDOFF.md if the workstation pnpm wrapper attempts registry access. Verified: 43/43 unit tests PASS (14 new lifecycle tests); lifecycle integration PASS; generation integration PASS; existing MVP integration PASS; backend/frontend TypeScript PASS; production build and static export PASS. Production index enforcement and actual Cloud Scheduler cadence were not deployed/tested; the index configuration and scheduler source are included.

Deferred for generated journeys: READY to RUNNING, GPS start, operational cancellation/completion, lifecycle history/UI, assignment workflows, and Prompt 1D. Existing manual MVP features are preserved, not claimed as newly implemented Phase 2 workflows.

Prompt 1D supersedes the blanket generated-GPS guard: READY now accepts validated departure evidence, RUNNING tracking continues, and admin Start uses the centralized service. Completion/cancellation remain disabled for generated journeys. See GPS_JOURNEY_START.md.
