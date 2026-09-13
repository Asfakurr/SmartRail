# SmartRail BD stable MVP checkpoint — 2026-09-13

Resume from this repository, not from a new scaffold. Feature development is paused at the user's request. This handoff supersedes outdated v0.1 run instructions in docs/ARCHITECTURE.md, docs/API.md and docs/VALIDATION.md where they conflict. No threshold behavior was changed or separately validated during checkpoint completion.

## Saved state and working features

The interrupted session left v0.2 implementation changes uncommitted, no HANDOFF.md or PROJECT_STATUS.md, and the old README. Its emulator export survived in `.emulator-data/`. This checkpoint preserves those changes and documents them; it adds no feature.

- Next.js/TypeScript/Tailwind passenger UI with search, service selection, Leaflet/OpenStreetMap, progress, next point and station ETA/delay. Firebase mode is now the default.
- Reusable route points, segments, geometry, trains and schedules; six point types including CROSSING_STOP. Train documents use train numbers. Admin master editor supports a limited set of configuration edits.
- Journey creation from saved schedules: generated ID, unique business-key reservation, configuration versions and immutable train/route/schedule/station timing snapshots. Multiple same-day services are supported.
- Admin simulator STEP/HOLD uses the same trusted GPS processing engine as HTTP ingestion. Validation checks source authorization, timestamps, replay, movement, route deviation and map matching. Dedicated primary is preferred; authorized phone fallback is permitted when primary is stale.
- Backend ETA uses configured railway chainage, segment travel/dwell times and bounded recent-speed adjustment. Firestore processing state projects to nested RTDB live state for browser listeners.
- Fake ticket import automatically creates temporary unified subscriptions. Manual subscribe/cancel endpoints exist. Station-specific eligibility and deterministic atomic notification IDs prevent repeated Mock SMS. No telecom provider is contacted.
- Journey GPS/prediction history and events, stale-source service, lifecycle handling and security rules are implemented. Client writes to authoritative live/prediction/notification data are denied.

## Stabilization results — current

Resumed from `851d906`; no new features or threshold changes. The existing MVP scope is verified as **MVP v0.1 stable for local simulated demonstrations**. The package's existing internal version remains 0.2.0; it was not renumbered.

- Ticket import and manual subscription creation now read journey status inside their write transactions, preventing creation/reactivation after concurrent completion. Ticket import checks combined capacity; updating an existing manual identity at capacity remains allowed.
- The passenger view listens for the authenticated user's own subscriptions and restores the cancellation control for the selected journey/boarding station after refresh.
- **Integration PASS:** fresh isolated emulator suite, including master snapshots, same-day services, GPS security/replay/fallback, station ETA, RTDB projection, delay alerts, repeated-update deduplication, cancellation, lifecycle, history and rules. Added regressions cover concurrent completion/import/manual subscribe, post-completion rejection and the 100-subscription boundary.
- **Unit tests: 13/13 PASS. Frontend TypeScript: PASS. Functions TypeScript: PASS. Production build: PASS**, static routes `/` and `/_not-found` exported successfully.
- Browser PASS: saved journey selection, rendered Leaflet/OpenStreetMap with orange train marker, backend STEP producing 1.8 km/2% progress and station predictions, manual subscription restored after reload and cancelled successfully. CLI simulator completed today's route with a hold; operations showed two ticket alerts after repeated updates.
- An initial new race-test failure was caused by floating-point chainage advancing the fixture one step beyond completion. The test setup was corrected; final expanded integration rerun passed.

Demo data was exported before integration testing; tests ran without importing or overwriting that export. An orphaned Firestore process was separately backed up at `/private/tmp/smartrail-orphan-backup` and stopped by the user. No production services were contacted or deployed.

## Exact local startup

Requirements: Node.js 22 LTS, pnpm 11.19, Java 21+. The existing machine previously ran Node 24.19 and Java 23. Dependencies are already installed here. No production Firebase credentials or billing are needed.

```sh
cd /Users/asfakur/Documents/Codex/2026-09-10/referenced-chatgpt-conversation-this-is-an/outputs/smartrail-bd
# Only if dependencies are absent:
pnpm install
# Only if .env.local does not already exist; preserve existing local settings:
test -f .env.local || cp .env.example .env.local
```

Terminal 1, same repository:

```sh
pnpm emulators
```

This compiles Functions, imports `.emulator-data` when available, and exports on clean exit. Stop with Ctrl+C and allow export to finish. Do not launch another suite if these ports are occupied. For a first start without an export, use:

```sh
pnpm functions:build
pnpm exec firebase emulators:start --project demo-smartrail-bd --only auth,firestore,database,functions --export-on-exit=.emulator-data
```

Terminal 2:

```sh
pnpm seed
WATCHPACK_POLLING=true pnpm dev --port 3010
```

Seed is loopback-emulator-only and reuses saved master configuration and the business-key journey. It does not reset a completed or already-alerted journey. Existing data is preserved.

If Node/pnpm are unavailable in this workstation shell, prepend the bundled runtimes in each terminal:

```sh
export PATH="/Users/asfakur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/asfakur/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
export FIREBASE_EMULATORS_PATH=/private/tmp/smartrail-emulators
export XDG_CONFIG_HOME=/private/tmp/smartrail-config
```

The last two settings reuse this machine's emulator cache/config; they are not required on other machines. `.emulator-data/` is intentionally Git-ignored and exists only in this local workspace. Seed recreates fixtures if the export is unavailable.

Environment: `.env.example` lists public demo Firebase settings, project `demo-smartrail-bd`, `NEXT_PUBLIC_DATA_MODE=firebase`, `NEXT_PUBLIC_USE_EMULATORS=true`, and the local API URL. Restart Next after environment changes. Explicit `NEXT_PUBLIC_DATA_MODE=demo` selects the separate browser-only sandbox; it is not the Firebase MVP.

## Demo data and workflow

- Train `701`, SmartRail Demo Express; route `dhaka-bhairab-demo`, outbound, 91,000 configured demo metres.
- Points: Dhaka origin, Tejgaon pass-through, Biman Bandar (`airport`) passenger halt, Tongi crossing, Narsingdi passenger halt, Bhairab destination.
- Schedule `701-0800`, daily 08:00 Asia/Dhaka. Seed uses today's Dhaka service date.
- Completed demo journey: `w0sqA61uaUVhzaiWysCq`, 2026-09-13; business key `701__2026-09-13__0800__dhaka-bhairab-demo__outbound`. A fresh 2026-09-14 journey `I88yWKVbicBpROsji0Eg` is saved at 1.8 km with its manual test subscription cancelled. Inspect the imported data or seed output for the currently selected journey; do not hardcode this ID.
- Devices: `demo-gnss` SIMULATOR, `demo-primary` DEDICATED_GNSS_CELLULAR, `demo-phone` OPERATOR_PHONE. Operator `demo-operator` is assigned train 701.
- Local-only login: `admin@smartrail.test` / `DemoRail2026!`; operator login `operator@smartrail.test` / `DemoRail2026!`. The seed's device key is an emulator fixture, not a production credential.

Open **Prototype operations**, sign in as admin, and select/create a journey from the saved schedule and a service date. Master configuration is reused. For repeat demos choose a fresh service date through the journey controls; do not delete historical data to clear deduplication.

Import the two fake tickets in **Tickets**. Confirm ticket records and TICKET subscriptions exist. In **Passenger journey**, use **Step** or **Run** to move, and **+12 min hold** before the boarding stations to introduce delay. Backend virtual time/coordinates are calculated server-side; only validated state reaches the map.

Alternatively, in Terminal 3:

```sh
pnpm simulate
```

The script signs into emulator Auth, creates/reuses today's `701-0800` journey, imports fake tickets, sends STEP commands every two seconds, and inserts a HOLD at loop step 3. Ctrl+C stops it. It resumes existing progress; it does not clear alerts. Do not run CLI and UI simulators concurrently for the same demo.

To verify Mock SMS: inspect **Notifications** and Firestore `notifications`. Eligible future boarding stations produce one DELAY_ALERT per normalized phone + boarding station + journey. Continue repeated steps/holds and confirm no duplicate for that recipient key. Already-passed boarding stations must not receive new alerts. The saved prior demo had two alerts; use a fresh journey to observe new ones. Delay configuration is left as-is and is read from `systemConfig/global`; this checkpoint makes no claim about a newly verified numeric value.

Manual workflow: select a future boarding point, enter a fake number matching `+880100000xxxx`, subscribe, then cancel using the displayed control. Anonymous Auth is used if not already signed in. Verify the MANUAL subscription becomes inactive and receives no subsequent alert. Refresh the page and select the same journey and boarding point: the cancellation control is restored from the authenticated user’s saved subscriptions. Cancel it and verify it remains inactive. API cancellation is restricted to an owned MANUAL subscription.

## URLs and storage

- Frontend: http://127.0.0.1:3010/ (passenger and operations panels share this page).
- Emulator UI: http://127.0.0.1:4000/; Auth 9099, Firestore 8080, RTDB 9000, Functions 5001, hub 4400.
- API base: http://127.0.0.1:5001/demo-smartrail-bd/asia-south1/api
- POST routes: `/journey`, `/master`, `/simulate`, `/gps`, `/mock-tickets`, `/subscribe`, `/unsubscribe`, `/journey-status`, `/threshold`, `/config`. See current `functions/src/index.ts` for exact validation and authentication; older API docs may differ.
- Existing hosted preview https://smartrail-bd-fyp-asfakur.asfaakur.chatgpt.site/ is an older browser-only demonstration, not this v0.2 Firebase deployment. Nothing was published during checkpointing.

Firestore:

```text
trains/{trainNumber}
routes/{routeId}/{points|segments|geometry}/{documentId}
schedules/{scheduleId}/timings/{routePointId}
journeys/{journeyId}
journeys/{journeyId}/{routePoints|gpsHistory|events|predictionHistory}/{documentId}
journeyKeys/{businessKey}
gpsDevices/{deviceId}
operators/{operatorId}
passengers/{passengerId}
mockTickets/{ticketId}
subscriptions/{subscriptionId}
notifications/{notificationId}
systemConfig/global
liveInternal/{journeyId}
deviceCheckpoints/{deviceId}_{journeyId}
```

RTDB: `/liveJourneys/{journeyId}/position`, `/tracking`, `/progress`, `/stationPredictions/{routePointId}`, plus projection revision/completion metadata. Configuration includes delay, GPS tolerances, primary stale timeout, recent-speed adjustment and notification/mock flags. Keep existing settings unchanged for this checkpoint.

## Remaining scope limitations

The previously documented subscription/completion races and refresh cancellation issue are fixed and verified. No known blocking failure remains in the tested simulated MVP pipeline. Remaining scope limitations follow; they are not completed production features.

4. Firestore `liveInternal` duplicates live processing state to provide a durable atomic transaction boundary; RTDB remains the public live projection. This is a deliberate MVP difference from a purely RTDB processing design.
5. Geometry/chainage are illustrative configured fixtures, not surveyed Bangladesh railway track data. Point-crossing events are inferred from samples rather than independently observed station halts.
6. Full admin CRUD, geometry import UI, device/operator provisioning UI and phone GPS capture UI are unfinished. Current master editor edits a subset and increments route/schedule versions together. Legacy v1 documents are preserved; UI selects schemaVersion 2, with no general migration implemented.
7. Stale-check service was tested directly; scheduled execution is not automatically exercised by the local suite without supporting scheduler/PubSub setup.
8. Prototype transaction limits include 100 subscriptions, 60 route points, 10 geometry chunks. No ML, production MQTT broker, real ticketing or real SMS integration. Mock service is replaceable; future history-based ETA is an extension point only.
9. Some UI version labels and older architecture/API/validation documents still describe v0.1. Prefer this handoff and current code.

This is an unofficial simulated university research prototype, not an official Bangladesh Railway service.

## Checks for a future session

```sh
pnpm test
pnpm typecheck
pnpm functions:build
pnpm build
# Only after stopping other emulators; this runs integration fixtures:
pnpm test:emulators
```

Restricted-shell alternative for the unit runner: `node --import tsx --test tests/*.test.ts`. Do not run integration against demo data you intend to preserve. Stop after stabilization. Phase 2 requires an explicit new request.

## Workstation command fallback verified in this session

This workstation's pnpm wrapper tried registry/supply-chain checks even with dependencies installed, and the original sandboxed invocation failed DNS resolution. The following commands run the same installed script entry points without reinstalling dependencies. They were used successfully for stabilization; keep the PATH/cache settings above. Use polling to avoid macOS watcher-limit errors.

```sh
# Terminal 1
node node_modules/typescript/bin/tsc -p functions/tsconfig.json
node node_modules/firebase-tools/lib/bin/firebase.js emulators:start --project demo-smartrail-bd --only auth,firestore,database,functions --import=.emulator-data --export-on-exit=.emulator-data
# Terminal 2
node --import tsx scripts/seed.ts
WATCHPACK_POLLING=true node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3010
# Terminal 3, optional
node --import tsx scripts/simulate.ts
# Verification; stop the demo emulator suite cleanly before the integration command
node --import tsx --test tests/*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p functions/tsconfig.json --noEmit
node node_modules/next/dist/bin/next build --webpack
node node_modules/firebase-tools/lib/bin/firebase.js emulators:exec --project demo-smartrail-bd --only auth,firestore,database,functions 'node --import tsx scripts/integration.ts'
```

Tests/build were executed with the installed Node 24.19 runtime; deployment runtime remains Node 22. Scheduled stale detection still requires scheduler/PubSub support and was tested through its service directly. The emulator warns about that omitted scheduled wrapper; this does not affect the manually driven MVP pipeline. Avoid simultaneous dev/build commands because Next writes generated output. Native date fields may require keyboard input to commit a date during browser automation; filling alone did not update React state in this browser tool.
