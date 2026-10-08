// One-off, run during the Hetzner cutover: hands the maps platform every GPS ping recorded
// before it was running, so it learns from those trips and deliveries too instead of
// starting from zero on the day of the move. It also teaches the gazetteer every place a rider
// arrived at in that time, the same way the API does live (MapsPlatformService.learnPlace):
// the place's name at the rider's own GPS position, only if that position was reported within
// 2 minutes before arriving and lies within 300 m of the customer's pin.
//
// Until then the API keeps those pings in its own database (TripLocationPing and
// DeliveryLocationPing, see journey-tracking.service.ts). From the moment MAPS_PLATFORM_URL is
// set, the API sends pings live, so only pings recorded BEFORE that moment are replayed:
// replaying later ones would count those journeys twice. Run it once.
//
// The platform learns a journey once it has been quiet for JOURNEY_IDLE_MINUTES, so these old
// journeys are picked up by its next worker pass.
//
// Needs `pg` (run with `pnpm dlx tsx` from apps/api, or install it temporarily).
//
// Usage:
//   DATABASE_URL=<the API's Postgres> \
//   MAPS_PLATFORM_URL=http://maps:8080 MAPS_PLATFORM_TOKEN=... \
//   REPLAY_BEFORE=2026-11-01T10:00:00Z \
//   npx tsx scripts/replay-pings.ts

import { Client } from 'pg';

const SOURCE = 'pikidada'; // must match MapsPlatformService's SOURCE
const BATCH = 1000; // the platform's per-request limit
const PLACES_BATCH = 100; // the same for places
const MAX_PLACE_OFFSET_KM = 0.3; // must match MapsPlatformService

interface PlaceRow {
  label: string;
  lat: number;
  lng: number;
  booked_lat: number;
  booked_lng: number;
}

// Every arrival (pickup, stop, drop-off) with the rider's last position in the 2 minutes before.
const ARRIVALS_SQL = `
  WITH arrivals AS (
    SELECT 'trip' AS kind, id AS ref, "pickupAddress" AS label, "pickupLat" AS lat,
           "pickupLng" AS lng, "arrivedAt" AS at FROM "Trip" WHERE "arrivedAt" IS NOT NULL
    UNION ALL
    SELECT 'trip', id, "destinationAddress", "destinationLat", "destinationLng", "completedAt"
      FROM "Trip" WHERE status = 'COMPLETED' AND "completedAt" IS NOT NULL
    UNION ALL
    SELECT 'trip', "tripId", address, lat, lng, "arrivedAt"
      FROM "TripStop" WHERE "arrivedAt" IS NOT NULL
    UNION ALL
    SELECT 'delivery', id, "pickupAddress", "pickupLat", "pickupLng", "arrivedPickupAt"
      FROM "Delivery" WHERE "arrivedPickupAt" IS NOT NULL
    UNION ALL
    SELECT 'delivery', id, "destinationAddress", "destinationLat", "destinationLng",
           "arrivedDropoffAt" FROM "Delivery" WHERE "arrivedDropoffAt" IS NOT NULL
    UNION ALL
    SELECT 'delivery', "deliveryId", address, lat, lng, "arrivedAt"
      FROM "DeliveryStop" WHERE "arrivedAt" IS NOT NULL
  )
  SELECT a.label, p.lat, p.lng, a.lat AS booked_lat, a.lng AS booked_lng
  FROM arrivals a
  CROSS JOIN LATERAL (
    SELECT lat, lng, "recordedAt" FROM "TripLocationPing"
      WHERE a.kind = 'trip' AND "tripId" = a.ref
        AND "recordedAt" <= a.at AND "recordedAt" > a.at - interval '2 minutes'
    UNION ALL
    SELECT lat, lng, "recordedAt" FROM "DeliveryLocationPing"
      WHERE a.kind = 'delivery' AND "deliveryId" = a.ref
        AND "recordedAt" <= a.at AND "recordedAt" > a.at - interval '2 minutes'
    ORDER BY "recordedAt" DESC
    LIMIT 1
  ) p
  WHERE a.at < $1`;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const sinLat = Math.sin(toRad(b.lat - a.lat) / 2);
  const sinLng = Math.sin(toRad(b.lng - a.lng) / 2);
  const c =
    sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 6371 * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

interface Row {
  journey_id: string;
  lat: number;
  lng: number;
  recorded_at: Date;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const mapsUrl = required('MAPS_PLATFORM_URL').replace(/\/+$/, '');
  const token = process.env.MAPS_PLATFORM_TOKEN;
  const before = new Date(required('REPLAY_BEFORE'));
  if (Number.isNaN(before.getTime())) throw new Error('REPLAY_BEFORE is not a date');

  const db = new Client({ connectionString: required('DATABASE_URL') });
  await db.connect();

  // Same journey ids the API uses live (JourneyTrackingService).
  const { rows } = await db.query<Row>(
    `SELECT 'trip:' || "tripId" AS journey_id, lat, lng, "recordedAt" AS recorded_at
       FROM "TripLocationPing" WHERE "recordedAt" < $1
     UNION ALL
     SELECT 'delivery:' || "deliveryId", lat, lng, "recordedAt"
       FROM "DeliveryLocationPing" WHERE "recordedAt" < $1
     ORDER BY journey_id, recorded_at`,
    [before],
  );
  const { rows: arrivals } = await db.query<PlaceRow>(ARRIVALS_SQL, [before]);
  await db.end();
  console.log(`${rows.length} pings recorded before ${before.toISOString()}`);

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  for (let i = 0; i < rows.length; i += BATCH) {
    const pings = rows.slice(i, i + BATCH).map((r) => ({
      journeyId: r.journey_id,
      lat: r.lat,
      lng: r.lng,
      recordedAt: r.recorded_at.toISOString(),
    }));
    const res = await fetch(`${mapsUrl}/v1/pings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: SOURCE, pings }),
    });
    if (!res.ok) {
      throw new Error(
        `Batch starting at ${i} failed: ${res.status} ${await res.text()}. ` +
          `Pings before it were sent; don't re-run from the start.`,
      );
    }
    console.log(`sent ${Math.min(i + BATCH, rows.length)} / ${rows.length}`);
  }

  // "Current location" is the booking page's label for a GPS fix, not a place name.
  const places = arrivals
    .filter((a) => {
      const label = a.label.trim();
      return (
        label.length >= 3 &&
        label.toLowerCase() !== 'current location' &&
        haversineKm(a, { lat: a.booked_lat, lng: a.booked_lng }) <= MAX_PLACE_OFFSET_KM
      );
    })
    .map((a) => ({ label: a.label.trim().slice(0, 200), lat: a.lat, lng: a.lng }));
  console.log(`${places.length} of ${arrivals.length} arrivals become places`);
  for (let i = 0; i < places.length; i += PLACES_BATCH) {
    const res = await fetch(`${mapsUrl}/v1/places`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: SOURCE, places: places.slice(i, i + PLACES_BATCH) }),
    });
    if (!res.ok) {
      throw new Error(`Places batch starting at ${i} failed: ${res.status} ${await res.text()}`);
    }
  }
  console.log('Done. The maps platform learns these journeys on its next pass.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
