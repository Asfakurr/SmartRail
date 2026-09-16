# API contract

> Historical phase notes. See the [current README](../README.md) for the Phase 2.1 baseline and [demo guide](DEMO_GUIDE.md) for current local commands. Later implementation supersedes earlier deferred-work, verification and API/schema statements below.

Cloud Functions base: `https://asia-south1-PROJECT.cloudfunctions.net/api`.
Local base: `http://127.0.0.1:5001/demo-smartrail-bd/asia-south1/api`.
All operations use POST with JSON, with a small payload limit. Errors use `{ "error": "..." }` and 400, 401, 403, 404 or 405 status.

| Path            | Authorization                                                             | JSON body / result                                                                                       |
| --------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/gps`          | Primary: `x-device-key`; phone: Firebase `Authorization: Bearer ID_TOKEN` | GPS envelope below → `{live}`                                                                            |
| `/mock-tickets` | Admin claim, demo mode                                                    | `{journeyId}` → two fake tickets plus automatic Firestore subscriptions                                  |
| `/subscribe`    | Firebase user, demo mode                                                  | `{journeyId, boardingPointId, phone}` → `{id}`; fake phone only                                          |
| `/threshold`    | Admin claim                                                               | `{delayMinutes: 10}` integer 1–120                                                                       |
| `/journey`      | Admin claim, demo mode                                                    | `{date: "2026-09-10", time: "12:00"}` → `{journey}`; fixed seeded demo route/train, create-only identity |

GPS envelope:

```json
{
  "journeyId": "701_2026-09-10_0800_dhaka-bhairab-demo_outbound",
  "deviceId": "demo-gnss",
  "source": "primary",
  "lat": 23.7603,
  "lng": 90.3949,
  "accuracyM": 8,
  "timestamp": 1789007100000,
  "sequence": 1
}
```

Use the actual seeded journey ID, current UTC epoch milliseconds and a persistent increasing sequence. The example timestamp is illustrative and will be rejected when stale. The request body cannot override its device's registered source or journey. A phone uses `demo-phone` and `source: phone` with the operator token; fresh-primary fixes prevent fallback.

## MQTT-ready boundary

Future topic: `smartrail/v1/devices/{deviceId}/gps`. Require TLS, individually provisioned broker credentials/client certificates, topic ACLs and payload size limits. The bridge must derive the device identity from the authenticated principal, reject topic/body mismatch and dispatch to `processGps` through a private trusted adapter or HTTPS with the device credential. Never accept a client-supplied `operatorUid` as identity. The existing HTTP adapter verifies the phone's ID token and supplies the trusted UID.

No MQTT server, broker or subscription worker is implemented. Transport-independent processing and the documented envelope make that a bounded future adapter.
