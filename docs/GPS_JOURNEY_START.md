# Phase 2.1 Prompt 1D — generated-journey start

> Historical implementation notes. Generated completion/cancellation and minimal lifecycle UI are now implemented; see [current lifecycle/demo guide](JOURNEY_COMPLETION.md), which supersedes deferred terminal-work statements below.


Extends the existing GPS ingestion and centralized lifecycle service. No new tracking engine, ETA formula, UI, dependency, deployment or commit.

## Automatic start

Authenticated GPS still supplies a journeyId and deviceId using the existing envelope. For a generated-journey request, the backend queries journeys assigned to that device with status READY/RUNNING. One RUNNING journey wins even when the packet names a different generated journey. Otherwise, exactly one generated READY journey within the start window and existing map-match corridor may be selected. Multiple plausible candidates return a descriptive ambiguity error with no transition; there is no nearest-departure guess. The effective journeyId is returned in live state. Packet sequence/timestamp validation applies to the effective journey; clients must maintain chronological device sequences.

Selection is not validation: existing device credentials, train/device snapshot assignment, operator authorization, replay/timestamp checks, accuracy, source priority, impossible speed, route deviation and progress matching still run before evidence is considered. A SCHEDULED journey cannot start; terminal journeys cannot restart. Existing RUNNING precedence can route GPS away from a named SCHEDULED/READY journey without mutating the named journey.

A READY journey requires two accepted VALID observations from the same device/journey, strictly chronological, with meaningful forward matched railway progress. Defaults in systemConfig/global (merged with shared defaults for legacy configuration):

```ts
startMinProgressM: 100;
startMaxObservationGapMs: 300000; // five minutes
startMaxOriginProgressM: 2000;   // first observation near origin
autoStartLateMs: 21600000;     // six hours
```

The existing admin `/config` endpoint validates these fields; omitted new fields receive defaults. The existing simulator advances 1800 metres per three minutes, so it can satisfy this rule with two steps. Jitter, one observation, low confidence, source/device changes and long gaps do not satisfy it. Rejected packets never contribute evidence. Accepted pre-start state is retained in the existing liveInternal record and published normally; notifications are evaluated for generated journeys only when RUNNING or starting in that transaction.

Both observations and the trusted processing clock must be inside `[departureMs - 30 minutes, departureMs + autoStartLateMs]`. The early bound reuses READY_LEAD_MS. The simulator's existing trusted virtual clock remains its processing clock; real HTTP GPS is checked against backend time. Delayed GPS timestamps within normal tolerance cannot extend an expired automatic-start window. Outside the late window a journey stays READY and manual Start is available.

## Central transition and manual fallback

All generated starts use `transitionJourneyState`. GPS processing joins its existing Firestore transaction, so validated evidence, status, metadata, history and live state commit together. Manual `startJourney(journeyId)` invokes the same service with backend time.

Admin-only endpoint:

```text
POST /start-journey
Authorization: Bearer <Firebase admin ID token>
{"journeyId":"generated_<scheduleId>__<serviceDate>"}
```

No client timestamp is accepted. READY is required; already RUNNING returns UNCHANGED. Manual/legacy documents and other states are rejected. Both paths serialize against assigned-device lock documents and check other RUNNING assignments. Manual Start can resolve ambiguous READY candidates, but cannot override an existing RUNNING assignment.

Effective transitions write epoch-millisecond metadata:

```ts
status: "RUNNING";
actualDepartureAt: number;
departureDeviationMinutes: (actualDepartureAt - departureMs) / 60000;
statusUpdatedAt: number;
transitionSource: "GPS_AUTO" | "ADMIN_MANUAL";
```

GPS_AUTO uses the timestamp of the second qualifying observation. ADMIN_MANUAL uses captured trusted backend time. Deviation is signed and unrounded (fractional minutes retained). Scheduled departure and all snapshots remain unchanged. First committed transition wins; retries and later GPS do not rewrite departure metadata.

## Concurrency and live pipeline

`deviceStartLocks/{deviceId}` are server-only transaction serialization records, not a new assignment model. GPS and admin starts read/write these records and the journey in their transactions. All assigned device locks are considered at start, preventing conflicting starts across multi-device assignments. Existing queries remain authoritative for RUNNING precedence. Added Firestore index: scheduleSnapshot.gpsDeviceIds ARRAY_CONTAINS plus status ASCENDING.

Generated RUNNING journeys reuse existing progress, map projection, station predictions and mock-notification deduplication. Their tracking is not stopped by the legacy scheduled expiry, which may precede a substantially delayed actual trip. Timetable-based ticket expiry remains unchanged. Destination progress does not complete generated journeys: live completed remains false and legacy status/completion writes apply only to manual MVP journeys. GPS loss never changes RUNNING status.

Legacy manual requests retain their existing MVP path. No reassignment, completion, cancellation, lifecycle UI or Prompt 1E workflow is implemented. Until a later completion workflow exists, an old RUNNING assignment deliberately blocks another journey using the same device rather than guessing it has finished.

## Verification

Run against an empty isolated emulator suite (no demo import):

```sh
pnpm functions:build
for suite in generation-integration lifecycle-integration integration gps-start-integration; do
  pnpm exec firebase emulators:exec --project demo-smartrail-bd --only auth,firestore,database,functions "node --import tsx scripts/$suite.ts" || break
done
pnpm test
pnpm typecheck
pnpm build
```

Workstation direct-binary fallbacks are documented in HANDOFF.md. The earlier lifecycle test now verifies RUNNING routing precedence and replay rejection, while retaining assertions that the requested generated journey and its metadata remain unchanged and legacy admin writes are rejected. This updates the old blanket GPS-rejection expectation to the explicitly authorized Prompt 1D behavior.

Each suite must start with a fresh emulator database. The lifecycle fixture edits schedule 701-0800, which can collide with the MVP test’s clock-derived schedule when suites share data; isolation removes this time-dependent fixture contamination without changing production behavior.

## Final verified results

51/51 unit tests PASS; GPS-start integration PASS; lifecycle integration PASS; generation integration PASS; existing MVP integration PASS; backend and frontend TypeScript PASS; production build/static export PASS. Each integration suite passed in its own empty emulator database. The MVP RTDB assertion now waits for the expected backend revision before checking device recovery, retaining all original assertions and removing an asynchronous publication race. Includes the trusted-clock late-window boundary regression. No Git commit, production deployment, completion/cancellation workflow or Prompt 1E implementation was made.
