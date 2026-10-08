export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

// Straight-line distance over the earth's surface.
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const sinLat = Math.sin(toRad(b.lat - a.lat) / 2);
  const sinLng = Math.sin(toRad(b.lng - a.lng) / 2);
  const c =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}
