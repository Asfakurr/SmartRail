# SmartRail BD

An unofficial FYP prototype: train/route → journey → simulated GPS → live map → station ETA/delay → fake ticket subscribers → automatic mock SMS.

**Start here:** [Architecture, data model, security and phased plan](docs/ARCHITECTURE.md). [API contract](docs/API.md). [Validation results](docs/VALIDATION.md).

## Run the interactive demo

Requirements: Node.js 22 LTS and pnpm 11. Install pnpm with your preferred Node package manager if needed.

```sh
pnpm install
pnpm dev
```

Open the printed local address. No Firebase account or environment file is needed in default demo mode. On systems with restrictive file-watcher limits, use `WATCHPACK_POLLING=true pnpm dev`.

1. Choose train **701**, service date **10 September 2026**, and either **08:00** or **16:00**.
2. Open **Prototype operations → Tickets** and import the two fake tickets.
3. Return to **Passenger journey**, press **Run** or **Step**, and add a **+12 min hold** before Biman Bandar.
4. Open **Prototype operations → Notifications** to see two boarding-station mock alerts. Repeated pings do not send duplicates.
5. Add a manual fake subscription to Narsingdi to try another recipient. Only `+880100000xxxx` fake numbers are accepted.

The browser demo keeps state in memory. Refreshing, switching departures or resetting the simulator creates a fresh demonstration context. It sends no real messages. Map tiles require internet access. Map geometry, distances, names and schedules are illustrative fixtures, not operational railway data.

## Run the Firebase vertical slice locally

Requirements: Node.js 22, pnpm 11, Java 21+ for emulators. No production credentials or Firebase billing needed for emulators.

Terminal 1:

```sh
pnpm install
pnpm emulators
```

Terminal 2:

```sh
pnpm seed
cp .env.example .env.local
# Change NEXT_PUBLIC_DATA_MODE to firebase in .env.local.
pnpm dev
```

The seed makes an active service journey scheduled approximately 30 minutes before the current time. It provisions the route first, then train/schedule/journey, two emulator users, one GNSS device and one operator fallback device. The default project is deliberately `demo-smartrail-bd`.

In **Prototype operations**, sign in with local-only credentials:

- `admin@smartrail.test` / `DemoRail2026!`
- Fallback operator: `operator@smartrail.test` / `DemoRail2026!`

Import mock tickets, then in Terminal 3:

```sh
pnpm simulate
```

This script sends authenticated primary-device GPS over the local HTTP endpoint every 5 seconds at a plausible 72 km/h chainage speed. The same engine runs inside Cloud Functions. Firestore stores the accepted fix and two mock alerts transactionally; the projection function updates RTDB; the browser map and admin outbox update via Firebase listeners. Stop the simulator with Ctrl+C. Re-running seed resets device assignment but does not wipe historical data; for a clean repeat restart emulators without persisted data.

Manual subscriptions use anonymous Firebase Authentication if not already signed in. Admin access still requires the custom claim. Phone fallback is exposed via the HTTP API and tested at the engine level; there is no phone GPS capture screen yet.

## Check the code

```sh
pnpm test
pnpm typecheck
pnpm functions:build
pnpm build
pnpm test:emulators
```

Stop any already-running emulator suite before `test:emulators`. It creates isolated test data and checks the secure HTTP pipeline, concurrent replay handling, mock alerts, RTDB projection and database rules. Builds export the web app to `out/`; deployable Functions JavaScript is in `functions/lib/`.

## Connect a real Firebase project later

The code and rules are included; no live Firebase project has been created or deployed by this work. Create Auth, Firestore and RTDB in your own project, enable email/password and anonymous Auth, select appropriate regions, configure the public Firebase client settings/API URL, and set `NEXT_PUBLIC_USE_EMULATORS=false`. Rebuild after changing `NEXT_PUBLIC_*` values. Use a trusted provisioning process for real devices and claims; **never deploy emulator fixtures**. Cloud Functions need project billing where required by Firebase.

For an explicitly fake hosted backend, set `DEMO_MODE=true` in the Functions environment; otherwise mock ticket/manual subscription APIs remain disabled. Follow the production gaps in the architecture before handling real passengers. The hosted preview, if available, remains a standalone browser simulation and is not evidence of a deployed Firebase backend.

## First-slice boundaries

Implemented: passenger search/date/time, Leaflet map, ETA/progress/route points, manual fake subscription, operations panels, mock import, threshold endpoint, demo journey creation, primary/fallback validation and durable duplicate-safe mock notification records.

Provisioned rather than fully editable: trains, routes/points, schedules, devices and operators. Analytics is the current journey summary. Advanced ML, full admin CRUD, MQTT broker, official ticketing integration and real SMS are planned phases, not claimed functionality.
