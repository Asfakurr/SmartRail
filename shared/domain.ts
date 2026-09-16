import type {
  RouteConfiguration,
  ScheduleConfiguration,
  JourneyRoutePoint,
} from "./master";
export type PointKind =
  | "origin"
  | "destination"
  | "passenger_halt"
  | "operational_stop"
  | "crossing_stop"
  | "pass_through";
export interface Coordinate {
  lat: number;
  lng: number;
}
export interface RoutePoint extends Coordinate {
  passengerBoardingAllowed?: boolean;
  passengerDropoffAllowed?: boolean;
  id: string;
  name: string;
  kind: PointKind;
  cumulativeM: number;
  segmentM: number;
  segmentMinutes: number;
  dwellMinutes: number;
}
export interface Route {
  id: string;
  name: string;
  direction: string;
  version: number;
  distanceQuality: "surveyed" | "demo";
  points: RoutePoint[];
  geometry: (Coordinate & { chainageM: number })[];
}
export interface Train {
  active?: boolean;
  version?: number;
  number: string;
  name: string;
  routeIds: string[];
}
export type Schedule = ScheduleConfiguration;
export interface Journey {
  /** Absent on legacy/manual MVP journeys. */
  generationSource?: "SCHEDULE";
  statusUpdatedAt?: number; // epoch milliseconds; written only on a status change
  transitionSource?: "SYSTEM_TIME" | "GPS_AUTO" | "ADMIN_MANUAL";
  actualArrivalAt?: number;
  cancelledAt?: number;
  cancellationReason?: string;
  cancelledBy?: string;
  actualDepartureAt?: number;
  departureDeviationMinutes?: number;
  generatedAt?: number;
  journeyId: string;
  businessKey: string;
  schemaVersion: 2;
  createdAt: number;
  simulated: boolean;
  trainSnapshot: Train;
  routeSnapshot: RouteConfiguration;
  scheduleSnapshot: ScheduleConfiguration;
  routePointSnapshots: JourneyRoutePoint[];
  id: string;
  trainNumber: string;
  serviceDate: string;
  scheduledTime: string;
  routeId: string;
  direction: string;
  departureMs: number;
  expiresAt: number;
  route: Route;
  status: "SCHEDULED" | "READY" | "RUNNING" | "COMPLETED" | "CANCELLED";
}
export interface GpsPing extends Coordinate {
  journeyId: string;
  deviceId: string;
  source: "DEDICATED_GNSS_CELLULAR" | "OPERATOR_PHONE" | "SIMULATOR";
  timestamp: number;
  sequence: number;
  accuracyM: number;
}
export interface StationPrediction {
  delaySeconds: number;
  confidence: number;
  pointId: string;
  scheduledMs: number;
  etaMs: number;
  delayMinutes: number;
  passed: boolean;
}
export interface LiveState extends Coordinate {
  speedKph: number;
  smoothedSpeedKph: number;
  speedSamples: { timestamp: number; speedKph: number }[];
  heading: number;
  accuracyMeters: number;
  confidence: number;
  routeDeviationMeters: number;
  gpsStatus: "VALID" | "LOW_CONFIDENCE" | "STALE";
  journeyId: string;
  timestamp: number;
  sequence: number;
  deviceId: string;
  source: GpsPing["source"];
  primaryLastSeen: number;
  chainageM: number;
  progress: number;
  nextPointId: string | null;
  predictions: StationPrediction[];
  completed: boolean;
}
export interface Passenger {
  id: string;
  name: string;
  phone: string;
}
export interface Ticket {
  ticketId: string;
  PNR: string;
  trainNumber: string;
  passengerName: string;
  phone: string;
  destinationPointId: string;
  id: string;
  journeyId: string;
  passengerId: string;
  boardingPointId: string;
  status: "CONFIRMED" | "CANCELLED";
}
export interface Subscription {
  subscriptionId?: string;
  id: string;
  journeyId: string;
  boardingPointId: string;
  passengerId: string;
  phone: string;
  source: "TICKET" | "MANUAL" | "ADMIN";
  expiresAt: number;
  active: boolean;
}
export interface Notification {
  notificationType: "DELAY_ALERT";
  id: string;
  journeyId: string;
  subscriptionId: string;
  boardingPointId: string;
  delayMinutes: number;
  phone: string;
  message: string;
  createdAt: number;
  status: "mock_sent";
}
export interface Thresholds {
  completionMinProgress: number;
  completionRadiusM: number;
  completionMaxObservationGapMs: number;
  autoStartLateMs: number;
  startMinProgressM: number;
  startMaxObservationGapMs: number;
  startMaxOriginProgressM: number;
  timestampToleranceMs: number;
  recentSpeedWindowMs: number;
  etaMinFactor: number;
  etaMaxFactor: number;
  notificationsEnabled: boolean;
  mockSmsEnabled: boolean;
  gpsMinIntervalMs: number;
  backwardToleranceMeters: number;
  delayMinutes: number;
  primaryStaleMs: number;
  maxAccuracyM: number;
  maxOffRouteM: number;
  maxSpeedKmh: number;
}
export interface Device {
  trainNumber?: string;
  id: string;
  journeyId: string;
  source: "DEDICATED_GNSS_CELLULAR" | "OPERATOR_PHONE" | "SIMULATOR";
  active: boolean;
  operatorUid?: string;
  keyHash?: string;
}
export interface Operator {
  uid: string;
  displayName: string;
  journeyIds: string[];
  active: boolean;
}
export interface HistoricalObservation {
  journeyId: string;
  routeVersion: number;
  pointId: string;
  scheduledMs: number;
  observedMs: number;
}
export interface EtaProvider {
  version: string;
  predict(
    journey: Journey,
    chainageM: number,
    timestamp: number,
    speedKph?: number,
    config?: Thresholds,
  ): StationPrediction[];
}
export const defaults: Thresholds = {
  completionMinProgress: 0.98,
  completionRadiusM: 750,
  completionMaxObservationGapMs: 5 * 60000,
  autoStartLateMs: 6 * 3600000,
  startMinProgressM: 100,
  startMaxObservationGapMs: 5 * 60000,
  startMaxOriginProgressM: 2000,
  timestampToleranceMs: 60000,
  recentSpeedWindowMs: 300000,
  etaMinFactor: 0.75,
  etaMaxFactor: 1.5,
  notificationsEnabled: true,
  mockSmsEnabled: true,
  gpsMinIntervalMs: 1000,
  backwardToleranceMeters: 100,
  delayMinutes: 10,
  primaryStaleMs: 120000,
  maxAccuracyM: 100,
  maxOffRouteM: 500,
  maxSpeedKmh: 160,
};
export function journeyId(
  train: string,
  date: string,
  time: string,
  route: string,
  direction: string,
) {
  if (
    !/^\d{1,8}$/.test(train) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
    !/^[a-zA-Z0-9-]+$/.test(route + direction)
  )
    throw new Error("Invalid journey identity");
  return [train, date, time.replace(":", ""), route, direction].join("__");
}

export type GpsValidationStatus =
  "VALID" | "LOW_CONFIDENCE" | "REJECTED" | "STALE";
export type JourneyEventType =
  | "JOURNEY_STARTED"
  | "JOURNEY_COMPLETED"
  | "GPS_LOST"
  | "GPS_RECOVERED"
  | "GPS_SOURCE_SWITCHED"
  | "STATION_REACHED"
  | "STATION_DEPARTED"
  | "DELAY_THRESHOLD_CROSSED";
export interface JourneyEvent {
  type: JourneyEventType;
  recordedAt: number;
  pointId?: string | null;
  inferred?: boolean;
}
