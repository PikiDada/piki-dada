// One-off, run during the Hetzner cutover: hands the maps platform every GPS ping recorded
// before it was running, so it learns from those trips and deliveries too instead of
// starting from zero on the day of the move.
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
  await db.end();
  console.log(`${rows.length} pings recorded before ${before.toISOString()}`);

  for (let i = 0; i < rows.length; i += BATCH) {
    const pings = rows.slice(i, i + BATCH).map((r) => ({
      journeyId: r.journey_id,
      lat: r.lat,
      lng: r.lng,
      recordedAt: r.recorded_at.toISOString(),
    }));
    const res = await fetch(`${mapsUrl}/v1/pings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
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
  console.log('Done. The maps platform learns these journeys on its next pass.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
