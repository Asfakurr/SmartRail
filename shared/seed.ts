import {
  journeyId,
  type Journey,
  type Route,
  type Train,
  type Subscription,
  type Ticket,
  type Passenger,
} from "./domain";
export const route: Route = {
  id: "dhaka-bhairab-demo",
  name: "Dhaka → Bhairab Bazar",
  direction: "outbound",
  version: 1,
  distanceQuality: "demo",
  points: [
    {
      id: "dhaka",
      name: "Dhaka",
      kind: "origin",
      lat: 23.7319,
      lng: 90.4262,
      cumulativeM: 0,
      segmentM: 0,
      segmentMinutes: 0,
      dwellMinutes: 0,
    },
    {
      id: "tejgaon",
      name: "Tejgaon",
      kind: "pass_through",
      lat: 23.7603,
      lng: 90.3949,
      cumulativeM: 6000,
      segmentM: 6000,
      segmentMinutes: 10,
      dwellMinutes: 0,
    },
    {
      id: "airport",
      name: "Biman Bandar",
      kind: "passenger_halt",
      lat: 23.8516,
      lng: 90.4085,
      cumulativeM: 18000,
      segmentM: 12000,
      segmentMinutes: 16,
      dwellMinutes: 3,
    },
    {
      id: "tongi",
      name: "Tongi crossing",
      kind: "operational_stop",
      lat: 23.8917,
      lng: 90.4056,
      cumulativeM: 23000,
      segmentM: 5000,
      segmentMinutes: 8,
      dwellMinutes: 2,
    },
    {
      id: "narsingdi",
      name: "Narsingdi",
      kind: "passenger_halt",
      lat: 23.9234,
      lng: 90.7153,
      cumulativeM: 57000,
      segmentM: 34000,
      segmentMinutes: 40,
      dwellMinutes: 3,
    },
    {
      id: "bhairab",
      name: "Bhairab Bazar",
      kind: "destination",
      lat: 24.0521,
      lng: 90.9764,
      cumulativeM: 91000,
      segmentM: 34000,
      segmentMinutes: 38,
      dwellMinutes: 0,
    },
  ],
  geometry: [],
};
route.geometry = route.points.map((p) => ({
  lat: p.lat,
  lng: p.lng,
  chainageM: p.cumulativeM,
}));
export const train: Train = {
  number: "701",
  name: "SmartRail Demo Express",
  routeIds: [route.id],
};
export function makeJourney(date = "2026-09-10", time = "08:00"): Journey {
  const departureMs = Date.parse(`${date}T${time}:00+06:00`);
  if (
    !Number.isFinite(departureMs) ||
    new Date(departureMs + 21600000).toISOString().slice(0, 10) !== date
  )
    throw new Error("Invalid service date");
  return {
    id: journeyId(train.number, date, time, route.id, route.direction),
    trainNumber: train.number,
    serviceDate: date,
    scheduledTime: time,
    routeId: route.id,
    direction: route.direction,
    departureMs,
    expiresAt: departureMs + 6 * 3600000,
    route: structuredClone(route),
    status: "active",
  };
}
export const passengers: Passenger[] = [
  { id: "fake-1", name: "Demo passenger A", phone: "+8801000000001" },
  { id: "fake-2", name: "Demo passenger B", phone: "+8801000000002" },
];
export function makeTickets(journey: Journey): Ticket[] {
  return passengers.map((p, i) => ({
    id: `${journey.id}_ticket-${i}`,
    journeyId: journey.id,
    passengerId: p.id,
    boardingPointId: i ? "narsingdi" : "airport",
    status: "confirmed",
  }));
}
export function ticketSubscriptions(
  journey: Journey,
  tickets = makeTickets(journey),
): Subscription[] {
  return tickets
    .filter((t) => t.status === "confirmed")
    .map((t) => ({
      id: t.id,
      journeyId: journey.id,
      boardingPointId: t.boardingPointId,
      passengerId: t.passengerId,
      phone: passengers.find((p) => p.id === t.passengerId)!.phone,
      source: "ticket",
      expiresAt: journey.expiresAt,
      active: true,
    }));
}
