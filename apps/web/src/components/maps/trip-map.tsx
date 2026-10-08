"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { LatLng } from "@/lib/types";
import { useMapsReady } from "./map-provider";

const GoogleMap = dynamic(() => import("@react-google-maps/api").then((m) => m.GoogleMap), { ssr: false });
const Marker = dynamic(() => import("@react-google-maps/api").then((m) => m.Marker), { ssr: false });
// Our own OpenStreetMap-based map (MapLibre). A separate chunk, only fetched when it's switched
// on, so the default Google build doesn't carry it.
const OsmTripMap = dynamic(() => import("./trip-map-osm").then((m) => m.OsmTripMap), {
  ssr: false,
  loading: () => <MapLoading height="100%" />,
});

// "google" (default) or "osm", fixed at build time. Read deploy/README.md before switching.
const MAP_PROVIDER = process.env.NEXT_PUBLIC_MAP_PROVIDER === "osm" ? "osm" : "google";

interface TripMapProps {
  pickup?: LatLng;
  destination?: LatLng;
  stops?: LatLng[];
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

function MapLoading({ height }: { height: string }) {
  return (
    <div
      style={{ height }}
      className="flex items-center justify-center rounded-2xl bg-neutral-100 text-sm text-neutral-600"
    >
      Loading map...
    </div>
  );
}

export function TripMap(props: TripMapProps) {
  if (MAP_PROVIDER === "osm") {
    const { height = "300px", pickup, driverLocation } = props;
    return (
      <div style={{ height }}>
        <OsmTripMap {...props} height="100%" center={pickup ?? driverLocation ?? defaultCenter} />
      </div>
    );
  }
  return <GoogleTripMap {...props} />;
}

function GoogleTripMap({
  pickup,
  destination,
  stops = [],
  driverLocation,
  height = "300px",
}: TripMapProps) {
  const isLoaded = useMapsReady();

  const pickupIcon = useMemo(() => (isLoaded ? pinIcon("P", "#16a34a") : undefined), [isLoaded]);
  const destinationIcon = useMemo(() => (isLoaded ? pinIcon("D", "#dc2626") : undefined), [isLoaded]);
  const driverIcon = useMemo(() => (isLoaded ? pinIcon("🏍️", "#111827") : undefined), [isLoaded]);
  const stopIcons = useMemo(
    () => (isLoaded ? stops.map((_, i) => pinIcon(String(i + 1), "#d97706")) : []),
    [isLoaded, stops],
  );

  if (!isLoaded) {
    return <MapLoading height={height} />;
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
        {stops.map((stop, i) => (
          <Marker key={`${stop.lat},${stop.lng},${i}`} position={stop} icon={stopIcons[i]} />
        ))}
        {destination && destinationIcon && <Marker position={destination} icon={destinationIcon} />}
        {driverLocation && driverIcon && <Marker position={driverLocation} icon={driverIcon} />}
      </GoogleMap>
    </div>
  );
}
