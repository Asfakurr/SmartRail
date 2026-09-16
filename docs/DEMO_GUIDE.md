# SmartRail BD local demonstration

Use only fake passengers and the local Firebase project `demo-smartrail-bd`. This demonstrates the existing Phase 2.1 implementation; no deployment is required. Start the emulators and frontend using [README](../README.md#run-locally). Keep both running. Commands below run from the repository root in another terminal.

## 1. Prepare a current-time saved schedule and generate

The default `pnpm seed` creates/reuses the 08:00 manual MVP journey. Late in the day its ticket window may be closed. For this generated demo, invoke the existing seed helper with the current Asia/Dhaka departure time, then invoke the existing generation service:

```sh
node --import tsx <<'JS'
const { seed } = require('./scripts/seed.ts');
const { getDhakaServiceDate } = require('./shared/service-date.ts');
const { buildGeneratedJourneyId } = require('./shared/schedule.ts');
const { ensureJourneysForServiceDate } = require('./functions/src/journey-generation.ts');
(async () => {
  const now = Date.now();
  const serviceDate = getDhakaServiceDate(now);
  const scheduleTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(now);
  const manual = await seed({ scheduleTime, serviceDate });
  const scheduleId = manual.scheduleSnapshot.scheduleId;
  const result = await ensureJourneysForServiceDate(serviceDate);
  console.log(result);
  if (result.failedCount) throw new Error('Resolve reported generation failures before continuing');
  console.log('Select generated journey:', buildGeneratedJourneyId(scheduleId, serviceDate));
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
JS
```

This reuses train `701`, route `dhaka-bhairab-demo`, schedule `701-HHmm` and its saved device assignments. The seed also creates a manual compatibility journey; select the printed **generated** ID, not that manual record. Existing schedules/history are not reset. Repeating within the same minute reuses the same schedule/date identity; after completing a rehearsal, wait for another minute and repeat to get a fresh service. Avoid beginning setup immediately across Dhaka midnight.

Open [the app](http://127.0.0.1:3010/), sign in under **Prototype operations** with `admin@smartrail.test` / `DemoRail2026!`. Show saved configuration in the master-data view or [Emulator UI](http://127.0.0.1:4000/) (`trains`, `routes`, `schedules`). Select the generated service in the journey selector; confirm **SCHEDULED** and its preserved schedule snapshot.

Generation alone does not perform readiness. The admin `POST /reconcile-journeys` endpoint with `{ "serviceDate": "YYYY-MM-DD" }` is an alternative generation-only entry point requiring a Firebase admin ID token.

## 2. Explicitly reconcile readiness

Cloud Scheduler does not execute its cadence automatically in emulators. Invoke the existing readiness helper using the real current clock:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --import tsx <<'JS'
const { initializeApp } = require('firebase-admin/app');
initializeApp({ projectId: 'demo-smartrail-bd' });
const { reconcileJourneyReadiness } = require('./functions/src/journey-lifecycle.ts');
reconcileJourneyReadiness()
  .then(result => { console.log(result); process.exit(0); })
  .catch(error => { console.error(error); process.exit(1); });
JS
```

Confirm **READY** / awaiting departure. The helper processes due generated services in its recovery window, not just the selected one. Departure must be within the readiness threshold (30 minutes before departure or already due). The scheduled backend's `reconcileJourneyOperations()` combines generation and readiness; the two separate invocations above make both stages visible.

## 3. Start, tickets, GPS and passenger view

1. In operations, click **Start** for the selected READY journey. Show **RUNNING**, actual departure and departure deviation. If another RUNNING journey owns the shared simulator device, finish or cancel that journey first; do not edit device locks directly.
2. Use **Import mock e-tickets** / the ticket import control. Confirm two fake tickets and their automatically created temporary subscriptions. Import before movement so boarding stations are still ahead.
3. On the passenger map, use **Step** once. Show the moving marker, approximately 1.8 km / 2% route progress, next point and independent station ETA/delay. OpenStreetMap tiles require network access; missing tiles do not prove backend failure.
4. Use the **+12 min** hold control while future boarding points remain ahead. Show increased predicted station delay. Leave the saved threshold configuration unchanged; if the delay has not crossed it, add another hold while the station is still ahead.
5. Optionally subscribe manually with a distinct fake phone (for example `+8801000000003`) and a future boarding point. Refresh, confirm the cancellation control returns, cancel, and confirm the subscription is inactive. To demonstrate a manual alert, subscribe again before the next GPS update.
6. Send another Step/Hold. In operations, show **Mock SMS outbox**. Eligible ticket/manual recipients receive station-specific alerts when their predicted boarding delay reaches the configured threshold. No telecom message is sent.
7. Repeat updates before passing the boarding stations and show that each journey + phone + boarding point + alert type still has only one notification. Ticket/manual overlap for the same recipient must not create another alert.

The UI simulator uses trusted backend STEP/HOLD processing and a virtual clock, including normal validation, map matching, ETA and notification evaluation. **Run** continues simulation; pause it for explanation or manual completion. `pnpm simulate` is the separate fixed-08:00 manual MVP CLI path, not the generated-service selector used here.

## 4. Complete and optionally cancel another service

Click **Complete** in operations while RUNNING, or continue the simulator to obtain the two qualifying destination observations for automatic completion. Conservative GPS completion may need another Step near the destination; arrival time alone or lost GPS does not complete a journey.

Show **COMPLETED**, actual arrival, passenger **Journey Completed**, cleared active ETA and disabled subscription/simulator controls. In Emulator UI, confirm subscriptions for that journey are inactive and its device lock is released. The saved schedule's device assignment remains in the historical snapshot.

For cancellation, prepare another current-time service (a different minute), generate and reconcile readiness again. Select it, click **Cancel**, enter a reason and confirm. Show **CANCELLED**, the reason, passenger cancelled state, no active ETA and inactive subscriptions. A later service can reuse the released device. Never reopen terminal documents by editing Firestore.

## Evidence and troubleshooting

- Firestore: `journeys/{id}` and its `routePoints`, `gpsHistory`, `predictionHistory`; `mockTickets`, `subscriptions`, `notifications`, `deviceStartLocks`, `systemConfig/global`.
- RTDB: `/liveJourneys/{id}/position`, `progress`, `tracking`, `stationPredictions`. Terminal stopped-stream metadata is shared; Firestore status distinguishes cancellation from completion.
- No SMS: check the selected journey, future boarding point, active/unexpired subscription, saved notification settings and predicted station delay. Existing deterministic alerts are not resent.
- `Journey is closed` during import: use a fresh current-time schedule. Do not disable expiry checks. The fixed-08:00 completion integration fixture has the same clock-dependent limitation.
- Start blocked: confirm READY, correct generated ID and no other RUNNING journey using its device. Do not bypass lifecycle transactions.
- Stop with Ctrl+C and let emulator export finish. Do not run isolated integration suites on occupied demo ports or import the demo export into tests.

See [README verification](../README.md#testing-and-verified-baseline) for the recorded results and [completion design](JOURNEY_COMPLETION.md) for detailed transition rules.
