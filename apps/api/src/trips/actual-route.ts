import { haversineKm, type LatLng } from './pricing.service';

// Turns a journey's GPS trace into the distance and driving time it actually took, to compare
// against what Google and the maps platform estimated. The raw pings are kept, so a better
// measure (e.g. map-matched distance from the maps platform) can be recomputed later.

// A phone standing still still wanders 5-20 m between fixes; counting that would add
// distance on every stop and traffic jam. Moves shorter than this from the last counted point
// are treated as noise.
const MIN_MOVE_KM = 0.025;
// Faster than any boda or car in Kampala: a jump like this is a bad GPS fix, not travel.
const MAX_PLAUSIBLE_KMH = 130;

export interface TracePoint extends LatLng {
  recordedAt: Date;
}

export interface StopWait {
  arrivedAt: Date | null;
  departedAt: Date | null;
}

export function measureActualRoute(
  pings: TracePoint[],
  startedAt: Date | null,
  endedAt: Date,
  stops: StopWait[],
): { actualDistanceKm: number | null; actualDurationMin: number | null } {
  let actualDistanceKm: number | null = null;
  if (pings.length >= 2) {
    actualDistanceKm = 0;
    let anchor = pings[0];
    for (const ping of pings.slice(1)) {
      const km = haversineKm(anchor, ping);
      if (km < MIN_MOVE_KM) continue;
      const hours =
        (ping.recordedAt.getTime() - anchor.recordedAt.getTime()) / 3_600_000;
      if (hours > 0 && km / hours > MAX_PLAUSIBLE_KMH) continue;
      actualDistanceKm += km;
      anchor = ping;
    }
  }

  // Estimates cover driving only, never waiting at stops, so the waits come off here too.
  // Otherwise every journey with stops would look slower than predicted.
  let actualDurationMin: number | null = null;
  if (startedAt) {
    let waitedMs = 0;
    for (const stop of stops) {
      if (stop.arrivedAt && stop.departedAt) {
        waitedMs += Math.max(
          0,
          stop.departedAt.getTime() - stop.arrivedAt.getTime(),
        );
      }
    }
    actualDurationMin = Math.max(
      0,
      (endedAt.getTime() - startedAt.getTime() - waitedMs) / 60000,
    );
  }

  return { actualDistanceKm, actualDurationMin };
}
