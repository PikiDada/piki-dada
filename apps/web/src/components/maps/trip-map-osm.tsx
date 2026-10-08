"use client";

import { useEffect, useRef } from "react";
import { Map, Marker, NavigationControl, addProtocol, setWorkerUrl, type MapOptions } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { layers, namedFlavor } from "@protomaps/basemaps";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LatLng } from "@/lib/types";

// Our own map display: OpenStreetMap data as a single .pmtiles file (served from our own
// server, read with byte-range requests), drawn by MapLibre. Only loaded when
// NEXT_PUBLIC_MAP_PROVIDER=osm; see trip-map.tsx and deploy/README.md.

interface OsmTripMapProps {
  pickup?: LatLng;
  destination?: LatLng;
  stops?: LatLng[];
  driverLocation?: LatLng;
  height?: string;
  center: LatLng;
}

const TILES_URL = process.env.NEXT_PUBLIC_MAP_TILES_URL || "/tiles/uganda.pmtiles";
// Fonts and icons the Protomaps style needs. Their public copies work out of the box; point
// these at our own server to stop depending on GitHub Pages.
const GLYPHS_URL =
  process.env.NEXT_PUBLIC_MAP_GLYPHS_URL ||
  "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
const SPRITE_URL =
  process.env.NEXT_PUBLIC_MAP_SPRITE_URL || "https://protomaps.github.io/basemaps-assets/sprites/v4/light";

// The ODbL licence requires the OpenStreetMap credit to be visible on the map. Set on the
// attribution control itself (kept expanded) so it shows even while tiles are still loading.
const ATTRIBUTION =
  '<a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';

let setUp = false;

// Once per page: teach MapLibre the pmtiles:// scheme, and tell it where its worker script
// is. MapLibre looks for the worker next to its own file, which doesn't exist once bundled;
// this URL makes the bundler copy the worker into the build.
function setUpMapLibre() {
  if (setUp) return;
  addProtocol("pmtiles", new Protocol().tile);
  setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
  setUp = true;
}

function buildStyle(): MapOptions["style"] {
  // pmtiles needs an absolute URL; a path like /tiles/uganda.pmtiles means this same site.
  const tilesUrl = new URL(TILES_URL, window.location.href).href;
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sprite: SPRITE_URL,
    sources: {
      protomaps: { type: "vector", url: `pmtiles://${tilesUrl}` },
    },
    layers: layers("protomaps", namedFlavor("light"), { lang: "en" }),
  };
}

// Same look as the Google map's pins: a 28px circle with a white letter.
function pinElement(label: string, background: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = label;
  Object.assign(el.style, {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    background,
    color: "#fff",
    fontSize: "14px",
    fontFamily: "sans-serif",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: "1",
  });
  return el;
}

interface Pin {
  key: string;
  position: LatLng;
  label: string;
  color: string;
}

export function OsmTripMap({ pickup, destination, stops = [], driverLocation, height = "300px", center }: OsmTripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef(new globalThis.Map<string, Marker>());

  useEffect(() => {
    if (!containerRef.current) return;
    setUpMapLibre();
    const map = new Map({
      container: containerRef.current,
      style: buildStyle(),
      zoom: 14,
      scrollZoom: false,
      attributionControl: { compact: false, customAttribution: ATTRIBUTION },
    });
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;
    const markers = markersRef.current;
    return () => {
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Follows pickup ?? driverLocation, like the Google map's center prop.
  useEffect(() => {
    mapRef.current?.setCenter([center.lng, center.lat]);
  }, [center.lat, center.lng]);

  // Runs after every render: adds/moves/removes markers to match the props. Existing markers
  // are moved rather than recreated, so the rider's marker glides as their location updates.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pins: Pin[] = [];
    if (pickup) pins.push({ key: "pickup", position: pickup, label: "P", color: "#16a34a" });
    stops.forEach((stop, i) =>
      pins.push({ key: `stop-${i}`, position: stop, label: String(i + 1), color: "#d97706" }),
    );
    if (destination) pins.push({ key: "destination", position: destination, label: "D", color: "#dc2626" });
    if (driverLocation) pins.push({ key: "driver", position: driverLocation, label: "🏍️", color: "#111827" });

    const markers = markersRef.current;
    const wanted = new Set(pins.map((pin) => pin.key));
    for (const [key, marker] of markers) {
      if (!wanted.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    }
    for (const pin of pins) {
      const lngLat: [number, number] = [pin.position.lng, pin.position.lat];
      const existing = markers.get(pin.key);
      if (existing) {
        existing.setLngLat(lngLat);
      } else {
        markers.set(pin.key, new Marker({ element: pinElement(pin.label, pin.color) }).setLngLat(lngLat).addTo(map));
      }
    }
  });

  return <div ref={containerRef} style={{ height }} className="overflow-hidden rounded-2xl bg-neutral-100" />;
}
