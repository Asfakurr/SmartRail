import {
  getDhakaWeekday,
  validateServiceDate,
  type ServiceDate,
} from "./service-date";
export interface ScheduleOperatingRules {
  active: boolean;
  /** Existing encoding: Sunday=0 ... Saturday=6. Never inferred for legacy data. */
  operatingDays: number[];
  /** Absent legacy bounds mean unbounded, not a fabricated activation date. */
  validFrom?: ServiceDate;
  validTo?: ServiceDate | null;
}
export function validateScheduleOperatingRules(
  schedule: ScheduleOperatingRules,
): void {
  if (
    typeof schedule.active !== "boolean" ||
    !Array.isArray(schedule.operatingDays) ||
    !schedule.operatingDays.length ||
    schedule.operatingDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  )
    throw new Error("Invalid schedule operating rules");
  if (schedule.validFrom !== undefined) validateServiceDate(schedule.validFrom);
  if (schedule.validTo != null) validateServiceDate(schedule.validTo);
  if (
    schedule.validFrom !== undefined &&
    schedule.validTo != null &&
    schedule.validTo < schedule.validFrom
  )
    throw new Error("validTo precedes validFrom");
}
/** Invalid configuration fails explicitly; valid but ineligible schedules return false. */
export function isScheduleOperatingOnDate(
  schedule: ScheduleOperatingRules,
  serviceDate: ServiceDate,
): boolean {
  validateScheduleOperatingRules(schedule);
  validateServiceDate(serviceDate);
  return (
    schedule.active &&
    schedule.operatingDays.includes(getDhakaWeekday(serviceDate)) &&
    (schedule.validFrom === undefined || serviceDate >= schedule.validFrom) &&
    (schedule.validTo == null || serviceDate <= schedule.validTo)
  );
}
/** Pure future-generator identity. Existing manual journey IDs/business keys are unchanged. */
export function buildGeneratedJourneyId(
  scheduleId: string,
  serviceDate: ServiceDate,
): string {
  validateServiceDate(serviceDate);
  if (
    typeof scheduleId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(scheduleId)
  )
    throw new Error("Invalid schedule ID");
  return `generated_${scheduleId}__${serviceDate}`;
}
