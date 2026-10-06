// Ad-hoc investigation (not part of the app): prints the turn-by-turn road names OSRM and
// Google Routes each picked for the two routes where compare-routing.ts showed a large (20%+)
// distance gap, so we can see WHY they diverge -- missing/misclassified road in OSM, vs.
// Google routing more conservatively -- rather than just how much.
//
// Usage:
//   OSRM_URL=https://router.project-osrm.org GOOGLE_ROUTES_API_KEY=... npx tsx scripts/inspect-routing-diff.ts

interface LatLng {
  lat: number;
  lng: number;
}

const ROUTES: { label: string; pickup: LatLng; destination: LatLng }[] = [
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

async function inspectOsrm(osrmUrl: string, pickup: LatLng, destination: LatLng) {
  const url =
    `${osrmUrl.replace(/\/+$/, '')}/route/v1/driving/` +
    `${pickup.lng},${pickup.lat};${destination.lng},${destination.lat}` +
    '?overview=false&steps=true&annotations=false';
  const res = await fetch(url);
  const data = (await res.json()) as any;
  const legs = data?.routes?.[0]?.legs ?? [];
  console.log('  OSRM roads used:');
  for (const leg of legs) {
    for (const step of leg.steps ?? []) {
      const name = step.name || '(unnamed road)';
      const km = (step.distance / 1000).toFixed(2);
      console.log(`    - ${name} (${km} km)`);
    }
  }
}

async function inspectGoogle(apiKey: string, pickup: LatLng, destination: LatLng) {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters',
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
  });
  const data = (await res.json()) as any;
  const legs = data?.routes?.[0]?.legs ?? [];
  console.log('  Google roads used:');
  for (const leg of legs) {
    for (const step of leg.steps ?? []) {
      const instruction = step.navigationInstruction?.instructions || '(no instruction)';
      const km = (step.distanceMeters / 1000).toFixed(2);
      console.log(`    - ${instruction} (${km} km)`);
    }
  }
}

async function main() {
  const osrmUrl = process.env.OSRM_URL;
  const googleKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!osrmUrl || !googleKey) {
    throw new Error('Set both OSRM_URL and GOOGLE_ROUTES_API_KEY to inspect the diff');
  }

  for (const { label, pickup, destination } of ROUTES) {
    console.log(`\n${label}`);
    await inspectOsrm(osrmUrl, pickup, destination);
    await inspectGoogle(googleKey, pickup, destination);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
