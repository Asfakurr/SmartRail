# Phase 2.1 Prompt 1A — schedule foundation

> Historical phase notes. See the [current README](../README.md) for the Phase 2.1 baseline and [demo guide](DEMO_GUIDE.md) for current local commands. Later implementation supersedes earlier deferred-work, verification and API/schema statements below.

Pure utilities only; no automatic journey generator, scheduled job or new lifecycle behavior. Starting checkpoint: 6798eb5. Changes are intentionally uncommitted.

## Model

ScheduleConfiguration extends ScheduleOperatingRules:

```ts
active: boolean;
operatingDays: number[]; // existing Sunday=0 ... Saturday=6
validFrom?: ServiceDate; // YYYY-MM-DD; absent = no lower date bound
validTo?: ServiceDate | null; // absent/null = no upper date bound
```

Existing fields remain: scheduleId, trainNumber, routeId, direction, gpsDeviceIds, scheduledDepartureTime (HH:mm), timezone (Asia/Dhaka), version, timings. Master persistence already spreads schedule fields into Firestore, so no separate storage migration or rule change is required. Existing journeys already carry serviceDate and scheduleSnapshot.scheduleId; no duplicate top-level scheduleId is introduced.

Missing validity dates preserve legacy unbounded behavior. Active and operatingDays are still required: missing/malformed values are rejected, never replaced with invented operating days. Duplicate weekdays are harmless membership entries, as before. Dates are validated and validTo cannot precede validFrom. Inactive schedules may now pass master validation for storage, but are ineligible for journey creation.

## Calendar and time

ServiceDate is a string alias with strict runtime YYYY-MM-DD/calendar validation. It always identifies the Asia/Dhaka date when the origin departs, even if the destination arrives later. getDhakaServiceDate extracts an operational date from an epoch-millisecond instant using Intl and the explicit Asia/Dhaka timezone. getDhakaWeekday uses that date's Dhaka weekday, not the host's local timezone.

serviceMinuteToTimestamp accepts nonnegative integer minutes from service-day midnight, including values greater than 1440. It resolves wall-clock components through Intl's named timezone rather than assuming the developer/server timezone or treating UTC midnight as service midnight. Invalid/out-of-range inputs and unresolved nonexistent wall times throw.

```ts
scheduleTimeToServiceMinute("23:30")    // 1410
scheduleTimeToServiceMinute("00:45", 1) // 1485
serviceMinuteToTimestamp("2026-09-14", 1695)
// 2026-09-14T22:15:00.000Z = September 15, 04:15 Asia/Dhaka
```

Persisted timetables retain the existing, already unambiguous departure-relative representation:

```ts
scheduledArrivalOffsetSeconds: number;
scheduledDepartureOffsetSeconds: number;
```

These are nonnegative integer elapsed seconds after origin departure, not wall-clock HH:mm values. For a 23:30 departure, a 00:45 next-day arrival is +4500 seconds; 04:15 next day is +17100 seconds. Offsets may exceed 86400. scheduledOffsetToTimestamp converts them without truncating at midnight. Existing master validation retains station ordering and arrival/departure constraints. No representation migration was needed; service-minute utilities provide the requested future-generator interface.

## Eligibility and identity

isScheduleOperatingOnDate centralizes active status, weekday membership and inclusive validity bounds. Invalid dates/configuration throw; valid but non-operating schedules return false. Existing manual snapshot construction delegates to these utilities, preserving its behavior while enforcing new optional bounds. No new snapshot creation pipeline is implemented.

buildGeneratedJourneyId(scheduleId, serviceDate) returns:

```text
generated_701-outbound-0700__2026-09-14
```

Schedule IDs use the existing 1–100 ASCII letters/digits/underscore/hyphen validation. The fixed-length date suffix makes this format unambiguous and Firestore-safe. Same schedule/date yields the same ID; different schedules or dates yield distinct IDs. Train number alone never determines this ID. The function has no database side effects and is not wired into existing manual creation. Existing random manual IDs and business-key reservations remain unchanged.

## Verification

29 unit tests passed (13 existing + 16 new grouped tests). New tests cover all requested eligibility boundaries, Dhaka midnight/date/weekday behavior, multi-day timetable conversion, unchanged origin service date, deterministic identity distinctions, legacy dates, inactive master storage and invalid input rejection. Full suite passed under TZ=America/Los_Angeles; the 16 new tests also passed under TZ=Pacific/Auckland. Frontend and backend TypeScript checks passed. Production build passed, including static export of `/` and `/_not-found`.

No Firebase emulator data, RTDB schema, GPS/ETA/notification behavior, UI, automatic generation, device inheritance, scheduling jobs or lifecycle automation was added or changed. Prompt 1B is deferred.
