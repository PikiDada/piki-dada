// One-off comparison: calls self-hosted OSRM and the Google Routes API directly for the
// same set of pickup/destination pairs, so you can see how far apart their distance/duration
// (and the resulting fare) actually land before committing to OSRM as the default. Doesn't
// touch pricing.service.ts's fallback chain -- this hits both backends unconditionally,
// regardless of which one the app would actually pick.
//
// Edit the ROUTES array below with real Kampala pickup/destination pairs you care about,
// then run:
//
//   OSRM_URL=http://localhost:5000 GOOGLE_ROUTES_API_KEY=... npx tsx scripts/compare-routing.ts
//
// Fare math mirrors PricingService.estimateFare's default pricing rules (BODA shown below --
// change RIDE_RATE to compare a different tier). If your DB has overridden rates via the
// admin pricing rules, edit RIDE_RATE to match so the fares printed here are meaningful.
//
// Uses the global `fetch` (Node 18+) rather than axios so this standalone script has no
// dependency on apps/api's node_modules.

interface LatLng {
  lat: number;
  lng: number;
}

interface RoadRoute {
  distanceKm: number;
  durationMin: number;
}

const ROUTES: { label: string; pickup: LatLng; destination: LatLng }[] = [
  {
    label: 'Kampala Rd -> Garden City',
    pickup: { lat: 0.3163, lng: 32.5822 },
    destination: { lat: 0.3331, lng: 32.6041 },
  },
  {
    label: 'Makerere -> Ntinda',
    pickup: { lat: 0.3354, lng: 32.5695 },
    destination: { lat: 0.3621, lng: 32.6193 },
  },
  {
    label: 'Entebbe Rd (Airport) -> Kampala CBD',
    pickup: { lat: 0.0425, lng: 32.4435 },
    destination: { lat: 0.3136, lng: 32.5811 },
  },
];

// Matches PricingService's BODA default rule -- see pricing.service.ts's defaultRuleFor.
const RIDE_RATE = { baseFare: 1500, perKm: 500, perMinute: 50 };

function fareFor(route: RoadRoute): number {
  const raw =
    RIDE_RATE.baseFare +
    RIDE_RATE.perKm * route.distanceKm +
    RIDE_RATE.perMinute * route.durationMin;
  return Math.round(raw / 500) * 500;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
  }
}

async function computeOsrmRoute(
  osrmUrl: string,
  pickup: LatLng,
  destination: LatLng,
): Promise<RoadRoute | null> {
  try {
    const url =
      `${osrmUrl.replace(/\/+$/, '')}/route/v1/driving/` +
      `${pickup.lng},${pickup.lat};${destination.lng},${destination.lat}` +
      '?overview=false';
    const res = await withTimeout(fetch(url), 10000);
    const data = (await res.json()) as any;
    const route = data?.routes?.[0];
    if (!Number.isFinite(route?.distance) || !Number.isFinite(route?.duration)) {
      console.warn(`  OSRM returned an unparseable response: ${JSON.stringify(data).slice(0, 200)}`);
      return null;
    }
    return { distanceKm: route.distance / 1000, durationMin: route.duration / 60 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  OSRM call failed: ${message}`);
    return null;
  }
}

async function computeGoogleRoute(
  apiKey: string,
  pickup: LatLng,
  destination: LatLng,
): Promise<RoadRoute | null> {
  try {
    const res = await withTimeout(
      fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: pickup.lat, longitude: pickup.lng } } },
          destination: {
            location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
          },
          travelMode: 'DRIVE',
          units: 'METRIC',
          routeModifiers: { avoidTolls: true },
        }),
      }),
      10000,
    );
    const data = (await res.json()) as any;
    const route = data?.routes?.[0];
    const durationSec = Number(String(route?.duration ?? '').replace('s', ''));
    if (!Number.isFinite(route?.distanceMeters) || !Number.isFinite(durationSec)) {
      console.warn(`  Google Routes returned an unparseable response: ${JSON.stringify(data).slice(0, 200)}`);
      return null;
    }
    return { distanceKm: route.distanceMeters / 1000, durationMin: durationSec / 60 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  Google Routes call failed: ${message}`);
    return null;
  }
}

function fmtRoute(route: RoadRoute | null): string {
  if (!route) return 'n/a';
  return `${route.distanceKm.toFixed(2)} km, ${route.durationMin.toFixed(1)} min, fare ${fareFor(route)} UGX`;
}

async function main() {
  const osrmUrl = process.env.OSRM_URL;
  const googleKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!osrmUrl && !googleKey) {
    throw new Error('Set OSRM_URL and/or GOOGLE_ROUTES_API_KEY to compare against');
  }

  for (const { label, pickup, destination } of ROUTES) {
    console.log(`\n${label}`);
    const [osrm, google] = await Promise.all([
      osrmUrl ? computeOsrmRoute(osrmUrl, pickup, destination) : Promise.resolve(null),
      googleKey ? computeGoogleRoute(googleKey, pickup, destination) : Promise.resolve(null),
    ]);
    console.log(`  OSRM:   ${fmtRoute(osrm)}`);
    console.log(`  Google: ${fmtRoute(google)}`);
    if (osrm && google) {
      const distDeltaPct = ((osrm.distanceKm - google.distanceKm) / google.distanceKm) * 100;
      const fareDelta = fareFor(osrm) - fareFor(google);
      console.log(
        `  Delta:  distance ${distDeltaPct >= 0 ? '+' : ''}${distDeltaPct.toFixed(1)}%, fare ${fareDelta >= 0 ? '+' : ''}${fareDelta} UGX`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
