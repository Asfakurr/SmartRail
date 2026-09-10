export type PointKind =
  | "origin"
  | "destination"
  | "passenger_halt"
  | "operational_stop"
  | "pass_through";
export interface Coordinate {
  lat: number;
  lng: number;
}
export interface RoutePoint extends Coordinate {
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
  number: string;
  name: string;
  routeIds: string[];
}
export interface Schedule {
  id: string;
  trainNumber: string;
  routeId: string;
  direction: string;
  scheduledTime: string;
}
export interface Journey {
  id: string;
  trainNumber: string;
  serviceDate: string;
  scheduledTime: string;
  routeId: string;
  direction: string;
  departureMs: number;
  expiresAt: number;
  route: Route;
  status: "scheduled" | "active" | "completed";
}
export interface GpsPing extends Coordinate {
  journeyId: string;
  deviceId: string;
  source: "primary" | "phone";
  timestamp: number;
  sequence: number;
  accuracyM: number;
}
export interface StationPrediction {
  pointId: string;
  scheduledMs: number;
  etaMs: number;
  delayMinutes: number;
  passed: boolean;
}
export interface LiveState extends Coordinate {
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
  id: string;
  journeyId: string;
  passengerId: string;
  boardingPointId: string;
  status: "confirmed" | "cancelled";
}
export interface Subscription {
  id: string;
  journeyId: string;
  boardingPointId: string;
  passengerId: string;
  phone: string;
  source: "ticket" | "manual";
  expiresAt: number;
  active: boolean;
}
export interface Notification {
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
  delayMinutes: number;
  primaryStaleMs: number;
  maxAccuracyM: number;
  maxOffRouteM: number;
  maxSpeedKmh: number;
}
export interface Device {
  id: string;
  journeyId: string;
  source: "primary" | "phone";
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
  ): StationPrediction[];
}
export const defaults: Thresholds = {
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
  return [train, date, time.replace(":", ""), route, direction].join("_");
}
