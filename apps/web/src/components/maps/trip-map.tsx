"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { LatLng } from "@/lib/types";
import { useMapsReady } from "./map-provider";

const GoogleMap = dynamic(() => import("@react-google-maps/api").then((m) => m.GoogleMap), { ssr: false });
const Marker = dynamic(() => import("@react-google-maps/api").then((m) => m.Marker), { ssr: false });

interface TripMapProps {
  pickup?: LatLng;
  destination?: LatLng;
  driverLocation?: LatLng;
  height?: string;
}

const defaultCenter: LatLng = { lat: 0.3476, lng: 32.5825 };

function pinIcon(label: string, background: string): google.maps.Icon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><circle cx="14" cy="14" r="14" fill="${background}"/><text x="14" y="19" font-size="14" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(28, 28),
    anchor: new window.google.maps.Point(14, 14),
  };
}

export function TripMap({ pickup, destination, driverLocation, height = "300px" }: TripMapProps) {
  const isLoaded = useMapsReady();

  const pickupIcon = useMemo(() => (isLoaded ? pinIcon("P", "#16a34a") : undefined), [isLoaded]);
  const destinationIcon = useMemo(() => (isLoaded ? pinIcon("D", "#dc2626") : undefined), [isLoaded]);
  const driverIcon = useMemo(() => (isLoaded ? pinIcon("🚗", "#111827") : undefined), [isLoaded]);

  if (!isLoaded) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-2xl bg-neutral-100 text-sm text-neutral-600"
      >
        Loading map...
      </div>
    );
  }

  const center = pickup ?? driverLocation ?? defaultCenter;

  return (
    <div style={{ height }} className="overflow-hidden rounded-2xl">
      <GoogleMap
        center={center}
        zoom={14}
        mapContainerStyle={{ width: "100%", height: "100%" }}
        options={{
          scrollwheel: false,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        }}
      >
        {pickup && pickupIcon && <Marker position={pickup} icon={pickupIcon} />}
        {destination && destinationIcon && <Marker position={destination} icon={destinationIcon} />}
        {driverLocation && driverIcon && <Marker position={driverLocation} icon={driverIcon} />}
      </GoogleMap>
    </div>
  );
}
