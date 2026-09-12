import {
  createJourneySnapshot,
  type MasterBundle,
  type ScheduleConfiguration,
} from "./master";
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
      kind: "crossing_stop",
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
  active: true,
  version: 1,
  name: "SmartRail Demo Express",
  routeIds: [route.id],
};
export function demoMaster(time = "08:00"): MasterBundle {
  const types = {
    origin: "ORIGIN",
    destination: "DESTINATION",
    passenger_halt: "PASSENGER_HALT",
    operational_stop: "OPERATIONAL_STOP",
    crossing_stop: "CROSSING_STOP",
    pass_through: "PASS_THROUGH",
  } as const;
  let offset = 0;
  const timings = route.points.map((p, i) => {
    offset +=
      p.segmentMinutes * 60 + (i ? route.points[i - 1].dwellMinutes * 60 : 0);
    return {
      routePointId: p.id,
      sequence: i,
      scheduledArrivalOffsetSeconds: offset,
      scheduledDepartureOffsetSeconds: offset + (i ? p.dwellMinutes * 60 : 0),
    };
  });
  return {
    train: structuredClone(train),
    route: {
      routeId: route.id,
      name: route.name,
      direction: route.direction,
      version: route.version,
      active: true,
      distanceQuality: route.distanceQuality,
      points: route.points.map((p, i) => ({
        pointId: p.id,
        name: p.name,
        sequence: i,
        type: types[p.kind],
        latitude: p.lat,
        longitude: p.lng,
        distanceFromOriginMeters: p.cumulativeM,
        defaultDwellSeconds: p.dwellMinutes * 60,
        passengerBoardingAllowed: ["origin", "passenger_halt"].includes(p.kind),
        passengerDropoffAllowed: ["destination", "passenger_halt"].includes(
          p.kind,
        ),
        active: true,
      })),
      segments: route.points.slice(1).map((p, i) => ({
        segmentId: `segment-${i}`,
        sequence: i,
        fromPointId: route.points[i].id,
        toPointId: p.id,
        startDistanceMeters: route.points[i].cumulativeM,
        endDistanceMeters: p.cumulativeM,
        distanceMeters: p.segmentM,
        defaultTravelSeconds: p.segmentMinutes * 60,
      })),
      geometry: [
        {
          chunkId: "chunk-0",
          sequence: 0,
          vertices: route.geometry.map((p) => ({
            latitude: p.lat,
            longitude: p.lng,
            distanceFromOriginMeters: p.chainageM,
          })),
        },
      ],
    },
    schedule: {
      gpsDeviceIds: ["demo-gnss", "demo-primary", "demo-phone"],
      scheduleId: `701-${time.replace(":", "")}`,
      trainNumber: train.number,
      routeId: route.id,
      direction: route.direction,
      scheduledDepartureTime: time,
      operatingDays: [0, 1, 2, 3, 4, 5, 6],
      timezone: "Asia/Dhaka",
      active: true,
      version: 1,
      timings,
    },
  };
}
// Stable IDs are ONLY for the legacy browser sandbox; persisted journeys get generated IDs.
export function makeJourney(date = "2026-09-10", time = "08:00"): Journey {
  return createJourneySnapshot(
    demoMaster(time),
    date,
    `sandbox-${journeyId(train.number, date, time, route.id, route.direction)}`,
    0,
  );
}
export const passengers: Passenger[] = [
  { id: "fake-1", name: "Demo passenger A", phone: "+8801000000001" },
  { id: "fake-2", name: "Demo passenger B", phone: "+8801000000002" },
];
export function makeTickets(journey: Journey): Ticket[] {
  return passengers.map((p, i) => ({
    id: `${journey.id}_ticket-${i}`,
    ticketId: `${journey.id}_ticket-${i}`,
    PNR: `DEMO-${journey.id.slice(0, 8)}-${i}`,
    trainNumber: journey.trainNumber,
    passengerName: p.name,
    phone: p.phone,
    destinationPointId: journey.route.points.at(-1)!.id,
    journeyId: journey.id,
    passengerId: p.id,
    boardingPointId:
      journey.route.points.filter(
        (p) => p.passengerBoardingAllowed && p.kind !== "origin",
      )[i]?.id ||
      journey.route.points.find((p) => p.passengerBoardingAllowed)!.id,
    status: "CONFIRMED",
  }));
}
export function ticketSubscriptions(
  journey: Journey,
  tickets = makeTickets(journey),
): Subscription[] {
  return tickets
    .filter((t) => t.status === "CONFIRMED")
    .map((t) => ({
      id: t.id,
      journeyId: journey.id,
      boardingPointId: t.boardingPointId,
      passengerId: t.passengerId,
      phone: passengers.find((p) => p.id === t.passengerId)!.phone,
      source: "TICKET",
      expiresAt: journey.expiresAt,
      active: true,
    }));
}
