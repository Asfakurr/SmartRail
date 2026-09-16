/** Operational calendar dates, never instants or machine-local dates. */
export type ServiceDate = string;
export const RAILWAY_TIMEZONE = "Asia/Dhaka" as const;
const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: RAILWAY_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: RAILWAY_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function parts(format: Intl.DateTimeFormat, timestamp: number) {
  if (!Number.isFinite(timestamp)) throw new Error("Invalid timestamp");
  return Object.fromEntries(
    format.formatToParts(timestamp).map((p) => [p.type, p.value]),
  );
}
export function validateServiceDate(value: ServiceDate): void {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000")
  )
    throw new Error("Invalid service date");
  const instant = Date.parse(`${value}T12:00:00Z`);
  if (
    !Number.isFinite(instant) ||
    new Date(instant).toISOString().slice(0, 10) !== value
  )
    throw new Error("Invalid service date");
}
export function getDhakaServiceDate(timestamp: number): ServiceDate {
  const p = parts(dateFormat, timestamp);
  const date = `${p.year.padStart(4, "0")}-${p.month}-${p.day}`;
  validateServiceDate(date);
  return date;
}
/** Sunday=0 through Saturday=6, matching existing operatingDays. */
export function getDhakaWeekday(serviceDate: ServiceDate): number {
  validateServiceDate(serviceDate);
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: RAILWAY_TIMEZONE,
    weekday: "short",
  }).format(Date.parse(`${serviceDate}T12:00:00Z`));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}
export function scheduleTimeToServiceMinute(
  time: string,
  dayOffset = 0,
): number {
  if (
    typeof time !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
    !Number.isSafeInteger(dayOffset) ||
    dayOffset < 0
  )
    throw new Error("Invalid schedule time");
  const [hours, minutes] = time.split(":").map(Number);
  const result = dayOffset * 1440 + hours * 60 + minutes;
  if (!Number.isSafeInteger(result)) throw new Error("Invalid service minute");
  return result;
}
/** Convert a service-day minute (including >1440) using the named timezone. */
export function serviceMinuteToTimestamp(
  serviceDate: ServiceDate,
  serviceMinute: number,
): number {
  validateServiceDate(serviceDate);
  if (!Number.isSafeInteger(serviceMinute) || serviceMinute < 0)
    throw new Error("Invalid service minute");
  // UTC arithmetic here constructs a wall-clock tuple, not a service-date boundary.
  const wall = Date.parse(`${serviceDate}T00:00:00Z`) + serviceMinute * 60000;
  if (!Number.isSafeInteger(wall) || !Number.isFinite(new Date(wall).getTime()))
    throw new Error("Timetable out of range");
  let candidate = wall;
  for (let i = 0; i < 4; i++) {
    const p = parts(clockFormat, candidate);
    const rendered = Date.parse(
      `${p.year.padStart(4, "0")}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
    );
    if (rendered === wall) return candidate;
    candidate += wall - rendered;
  }
  throw new Error("Nonexistent or unsupported Dhaka wall time");
}
export function combineServiceDateAndScheduleTime(
  serviceDate: ServiceDate,
  time: string,
): number {
  return serviceMinuteToTimestamp(
    serviceDate,
    scheduleTimeToServiceMinute(time),
  );
}
/** Existing timetable offsets are elapsed seconds from origin departure, including overnight. */
export function scheduledOffsetToTimestamp(
  serviceDate: ServiceDate,
  departureTime: string,
  offsetSeconds: number,
): number {
  if (!Number.isSafeInteger(offsetSeconds) || offsetSeconds < 0)
    throw new Error("Invalid timetable offset");
  const timestamp =
    combineServiceDateAndScheduleTime(serviceDate, departureTime) +
    offsetSeconds * 1000;
  if (
    !Number.isSafeInteger(timestamp) ||
    !Number.isFinite(new Date(timestamp).getTime())
  )
    throw new Error("Timetable out of range");
  return timestamp;
}
