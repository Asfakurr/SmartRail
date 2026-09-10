"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Journey, LiveState } from "@/shared/domain";
export default function RailMap({
  journey,
  live,
}: {
  journey: Journey;
  live: LiveState | null;
}) {
  const element = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    marker = useRef<L.CircleMarker | null>(null);
  useEffect(() => {
    if (!element.current) return;
    const m = L.map(element.current, { scrollWheelZoom: false }).setView(
      [23.89, 90.64],
      10,
    );
    map.current = m;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(m);
    const line = L.polyline(
      journey.route.geometry.map((p) => [p.lat, p.lng] as [number, number]),
      { color: "#0b8a70", weight: 5, dashArray: "8 7" },
    ).addTo(m);
    m.fitBounds(line.getBounds(), { padding: [35, 35] });
    journey.route.points.forEach((p) =>
      L.circleMarker([p.lat, p.lng], {
        radius: p.kind === "passenger_halt" ? 7 : 5,
        color: "#153b3b",
        fillColor: "white",
        fillOpacity: 1,
        weight: 2,
      })
        .addTo(m)
        .bindTooltip(p.name),
    );
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
  }, [journey]);
  useEffect(() => {
    if (!map.current || !live) return;
    if (!marker.current)
      marker.current = L.circleMarker([live.lat, live.lng], {
        radius: 10,
        color: "white",
        weight: 3,
        fillColor: "#eb6634",
        fillOpacity: 1,
      })
        .addTo(map.current)
        .bindTooltip("Simulated train");
    else marker.current.setLatLng([live.lat, live.lng]);
  }, [live]);
  return (
    <div
      className="map"
      ref={element}
      role="img"
      aria-label="Journey route map with train position"
    />
  );
}
