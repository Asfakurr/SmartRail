# SmartRail BD

Unofficial simulated FYP prototype: saved train/route/schedule → journey → validated simulated GPS → live map → station ETA/delay → fake ticket subscriptions → automatic Mock SMS.

**Resume here: [MVP checkpoint and complete handoff](HANDOFF.md).** It records working features, known issues, prior versus current test results, data paths and remaining work. Older files under `docs/` contain v0.1 details and may be stale.

## Run the Firebase MVP

Requirements: Node.js 22 LTS, pnpm 11.19 and Java 21+. No production Firebase credentials are needed.

```sh
pnpm install
# Preserve any existing .env.local:
test -f .env.local || cp .env.example .env.local
pnpm emulators
```

In another terminal in the same repository:

```sh
pnpm seed
WATCHPACK_POLLING=true pnpm dev --port 3010
```

Open http://127.0.0.1:3010/ and emulator UI http://127.0.0.1:4000/. Emulators import/export `.emulator-data/`; do not start duplicate services. See the handoff for first-start and machine-specific runtime commands.

Firebase is the default mode. `.env.example` supplies local project/API settings. `NEXT_PUBLIC_DATA_MODE=demo` explicitly selects the separate browser-only sandbox. Restart Next after environment changes.

Sign into **Prototype operations** with emulator-only `admin@smartrail.test` / `DemoRail2026!`. Seed creates/reuses train 701, route `dhaka-bhairab-demo`, schedule `701-0800`, and today's Dhaka service journey from saved configuration.

Import fake tickets, then use **Step/Run** and **+12 min hold** on the passenger view. Check **Notifications** for automatic boarding-station alerts without duplicates. Manual subscriptions accept fake `+880100000xxxx` numbers; cancellation is restored after refresh when the same journey and boarding station are selected. Existing journeys retain progress and alerts; create a fresh service-date journey for a repeat demo.

CLI alternative (imports tickets and includes a hold automatically):

```sh
pnpm simulate
```

## Minimal checks

```sh
pnpm test
pnpm typecheck
```

Stabilization passed the expanded emulator integration suite, 13 unit tests, both TypeScript checks, and the production build. Browser checks verified the live map and cancellation after refresh. The local simulated MVP v0.1 scope is stable; the package retains its existing 0.2.0 internal version. Threshold behavior was preserved unchanged. See the handoff for verified direct-command fallbacks if this workstation’s pnpm wrapper attempts registry access.

No real SMS, official railway integration, production MQTT or ML is included. Route geometry and distances are illustrative demo fixtures. The previously hosted preview is older than this local Firebase MVP.

## Phase 2.1 generated lifecycle

See [Journey completion and demo instructions](docs/JOURNEY_COMPLETION.md) for automatic generation through completion, admin Start/Complete/Cancel, destination thresholds, device release and all five isolated regression suites. Existing `pnpm emulators`, `pnpm seed`, `pnpm dev --port 3010` startup commands remain unchanged. The CLI `pnpm simulate` retains the manual MVP demo; select a generated journey and use the existing UI simulator for the generated lifecycle. Cloud Scheduler cadence is not automatically run by local emulators.
