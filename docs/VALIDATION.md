# Validation record

Validated locally on 10 September 2026. Host runtime: Node 24.19.0, Java 23. Deployment target: Cloud Functions Node 22. Node 22 itself was not available on this host; rerun in Node 22 CI before production deployment.

- Nine domain tests passed: same-day identity, invalid date, chainage consistency, station ETA/dwell, duplicate recipient overlap, thresholds/expiry/passed stations, rejected GPS, stale-primary fallback/recovery, journey completion and strict simulator endpoint envelopes.
- Next.js production static export compiled, type-checked and generated the app successfully.
- Cloud Functions TypeScript compiled successfully.
- Emulator integration passed: authenticated fake ticket import creates temporary subscribers; wrong key rejected; concurrent duplicate GPS requests accept one and reject the replay; ETA creates two mock SMS records; subsequent fixes do not duplicate them; Firestore projection publishes live RTDB data without device identity.
- Additional HTTP checks passed: invalid boarding point rejected, duplicate manual/ticket recipient produces no extra alert, mismatched phone operator rejected, fresh-primary fallback rejected, stale-primary fallback accepted, primary recovery accepted, old primary sequence rejected after switching sources, and non-admin threshold mutation rejected.
- Dependency installation completed successfully with a lockfile and explicit build-script permissions.
- Database rules were exercised with unauthenticated, passenger and admin contexts. Public journey/live reads succeed; private passenger/device reads and direct writes are rejected; admin passenger read succeeds; device hashes remain inaccessible even to client admin sessions.
- Local Next.js route returned HTTP 200 and was opened for preview.

A first integration run exposed a mismatched RTDB emulator namespace; backend, client and tests were aligned and the pipeline then passed.

Browser interaction, map tile rendering and mobile visual QA were not automated. A feature-detected, read-only `get_selected_journey_state` WebMCP tool is included; no supported WebMCP validation context was available, so its browser registration is not claimed as verified.

No production Firebase deployment, physical GNSS hardware, MQTT broker, real passenger data, external SMS delivery, surveyed railway geometry, or ETA accuracy study was tested. Those require their own acceptance gates.
