import {
  isScheduleOperatingOnDate,
  validateScheduleOperatingRules,
  type ScheduleOperatingRules,
} from "./schedule";
import {
  combineServiceDateAndScheduleTime,
  scheduledOffsetToTimestamp,
} from "./service-date";
import type { Journey, Route, Train } from "./domain";
import { journeyId as businessKey } from "./domain";
import { validateRoute } from "./engine";

export type RoutePointType =
  | "ORIGIN"
  | "PASSENGER_HALT"
  | "OPERATIONAL_STOP"
  | "CROSSING_STOP"
  | "PASS_THROUGH"
  | "DESTINATION";
export interface MasterRoutePoint {
  pointId: string;
  name: string;
  sequence: number;
  type: RoutePointType;
  latitude: number;
  longitude: number;
  distanceFromOriginMeters: number;
  defaultDwellSeconds: number;
  passengerBoardingAllowed: boolean;
  passengerDropoffAllowed: boolean;
  active: boolean;
}
export interface RouteSegment {
  segmentId: string;
  sequence: number;
  fromPointId: string;
  toPointId: string;
  startDistanceMeters: number;
  endDistanceMeters: number;
  distanceMeters: number;
  defaultTravelSeconds: number;
}
export interface GeometryChunk {
  chunkId: string;
  sequence: number;
  vertices: {
    latitude: number;
    longitude: number;
    distanceFromOriginMeters: number;
  }[];
}
export interface RouteConfiguration {
  routeId: string;
  name: string;
  direction: string;
  version: number;
  active: boolean;
  distanceQuality: "surveyed" | "demo";
  points: MasterRoutePoint[];
  segments: RouteSegment[];
  geometry: GeometryChunk[];
}
export interface ScheduleTiming {
  routePointId: string;
  sequence: number;
  scheduledArrivalOffsetSeconds: number;
  scheduledDepartureOffsetSeconds: number;
}
export interface ScheduleConfiguration extends ScheduleOperatingRules {
  scheduleId: string;
  trainNumber: string;
  routeId: string;
  direction: string;
  gpsDeviceIds: string[];
  scheduledDepartureTime: string;
  timezone: "Asia/Dhaka";
  version: number;
  timings: ScheduleTiming[];
}
export interface JourneyRoutePoint extends MasterRoutePoint {
  scheduledArrivalAt: number;
  scheduledDepartureAt: number;
}
export interface MasterBundle {
  train: Train;
  route: RouteConfiguration;
  schedule: ScheduleConfiguration;
}
const kinds = {
  ORIGIN: "origin",
  PASSENGER_HALT: "passenger_halt",
  OPERATIONAL_STOP: "operational_stop",
  CROSSING_STOP: "crossing_stop",
  PASS_THROUGH: "pass_through",
  DESTINATION: "destination",
} as const;
export function routeView(config: RouteConfiguration): Route {
  return {
    id: config.routeId,
    name: config.name,
    direction: config.direction,
    version: config.version,
    distanceQuality: config.distanceQuality,
    points: config.points.map((p, i) => ({
      id: p.pointId,
      name: p.name,
      kind: kinds[p.type],
      lat: p.latitude,
      lng: p.longitude,
      cumulativeM: p.distanceFromOriginMeters,
      segmentM: i ? config.segments[i - 1].distanceMeters : 0,
      segmentMinutes: i ? config.segments[i - 1].defaultTravelSeconds / 60 : 0,
      dwellMinutes: p.defaultDwellSeconds / 60,
      passengerBoardingAllowed: p.passengerBoardingAllowed,
      passengerDropoffAllowed: p.passengerDropoffAllowed,
    })),
    geometry: config.geometry.flatMap((c) =>
      c.vertices.map((p) => ({
        lat: p.latitude,
        lng: p.longitude,
        chainageM: p.distanceFromOriginMeters,
      })),
    ),
  };
}
export function validateMaster(bundle: MasterBundle) {
  const { train, route, schedule } = bundle;
  validateScheduleOperatingRules(schedule);
  const ids = [
    train.number,
    route.routeId,
    schedule.scheduleId,
    ...route.points.map((p) => p.pointId),
    ...route.segments.map((s) => s.segmentId),
    ...route.geometry.map((g) => g.chunkId),
    ...schedule.gpsDeviceIds,
  ];
  if (
    ids.some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id),
    ) ||
    !/^\d{1,8}$/.test(train.number) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.scheduledDepartureTime) ||
    JSON.stringify(bundle).length > 600000
  )
    throw new Error("Invalid master IDs, departure time or capacity");
  if (
    !schedule.operatingDays.length ||
    [train.name, route.name, ...route.points.map((p) => p.name)].some(
      (name) => typeof name !== "string" || !name.trim() || name.length > 120,
    )
  )
    throw new Error("Invalid master names or operating days");
  if (
    route.points.some(
      (p) =>
        typeof p.passengerBoardingAllowed !== "boolean" ||
        typeof p.passengerDropoffAllowed !== "boolean",
    )
  )
    throw new Error("Invalid passenger permissions");
  if (
    !train.active ||
    !route.active ||
    !train.routeIds.includes(route.routeId) ||
    train.number !== schedule.trainNumber ||
    route.routeId !== schedule.routeId ||
    route.direction !== schedule.direction
  )
    throw new Error("Inconsistent or inactive master configuration");
  if (
    route.points.length > 60 ||
    route.geometry.length > 10 ||
    route.geometry.flatMap((c) => c.vertices).length > 2000
  )
    throw new Error("Prototype route capacity exceeded");
  if (
    route.segments.length !== route.points.length - 1 ||
    schedule.timings.length !== route.points.length ||
    schedule.timezone !== "Asia/Dhaka"
  )
    throw new Error("Invalid schedule or segment coverage");
  if (
    !Number.isInteger(route.version) ||
    route.version < 1 ||
    !Number.isInteger(schedule.version) ||
    schedule.version < 1
  )
    throw new Error("Invalid version");
  route.points.forEach((p, i) => {
    if (!p.active || p.sequence !== i || !Object.hasOwn(kinds, p.type))
      throw new Error("Invalid route point sequence/type");
    if (i) {
      const s = route.segments[i - 1],
        prev = route.points[i - 1];
      if (
        s.sequence !== i - 1 ||
        s.fromPointId !== prev.pointId ||
        s.toPointId !== p.pointId ||
        s.startDistanceMeters !== prev.distanceFromOriginMeters ||
        s.endDistanceMeters !== p.distanceFromOriginMeters ||
        s.distanceMeters !== s.endDistanceMeters - s.startDistanceMeters
      )
        throw new Error("Invalid track segment");
    }
    const t = schedule.timings[i];
    if (
      t.routePointId !== p.pointId ||
      t.sequence !== i ||
      ![
        t.scheduledArrivalOffsetSeconds,
        t.scheduledDepartureOffsetSeconds,
      ].every(Number.isSafeInteger) ||
      t.scheduledArrivalOffsetSeconds < 0 ||
      t.scheduledDepartureOffsetSeconds < t.scheduledArrivalOffsetSeconds ||
      (i > 0 &&
        t.scheduledArrivalOffsetSeconds <
          schedule.timings[i - 1].scheduledDepartureOffsetSeconds) ||
      (i === 0 &&
        (t.scheduledArrivalOffsetSeconds !== 0 ||
          t.scheduledDepartureOffsetSeconds !== 0))
    )
      throw new Error("Invalid station timing offsets");
  });
  if (
    new Set(route.segments.map((s) => s.segmentId)).size !==
      route.segments.length ||
    new Set(route.geometry.map((c) => c.chunkId)).size !==
      route.geometry.length ||
    route.geometry.some((c, i) => c.sequence !== i)
  )
    throw new Error("Duplicate IDs or invalid geometry sequence");
  validateRoute(routeView(route));
}
export function createJourneySnapshot(
  bundle: MasterBundle,
  serviceDate: string,
  id: string,
  createdAt = Date.now(),
): Journey {
  validateMaster(bundle);
  const { train, route, schedule } = structuredClone(bundle);
  const key = businessKey(
    train.number,
    serviceDate,
    schedule.scheduledDepartureTime,
    route.routeId,
    route.direction,
  );
  const departureMs = combineServiceDateAndScheduleTime(
    serviceDate,
    schedule.scheduledDepartureTime,
  );
  if (!isScheduleOperatingOnDate(schedule, serviceDate))
    throw new Error("Schedule does not operate on service date");
  const points = route.points.map((p, i) => ({
    ...p,
    scheduledArrivalAt: scheduledOffsetToTimestamp(
      serviceDate,
      schedule.scheduledDepartureTime,
      schedule.timings[i].scheduledArrivalOffsetSeconds,
    ),
    scheduledDepartureAt: scheduledOffsetToTimestamp(
      serviceDate,
      schedule.scheduledDepartureTime,
      schedule.timings[i].scheduledDepartureOffsetSeconds,
    ),
  }));
  return {
    id,
    journeyId: id,
    businessKey: key,
    schemaVersion: 2,
    trainNumber: train.number,
    serviceDate,
    scheduledTime: schedule.scheduledDepartureTime,
    routeId: route.routeId,
    direction: route.direction,
    departureMs,
    expiresAt: points.at(-1)!.scheduledArrivalAt + 4 * 3600000,
    createdAt,
    status: "SCHEDULED",
    simulated: route.distanceQuality === "demo",
    trainSnapshot: train,
    routeSnapshot: route,
    scheduleSnapshot: schedule,
    routePointSnapshots: points,
    route: routeView(route),
  };
}
