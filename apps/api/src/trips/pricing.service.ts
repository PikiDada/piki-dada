import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { RideType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const EARTH_RADIUS_KM = 6371;
const AVERAGE_SPEED_KMH = 28;
// When the Routes API is unavailable, scale the straight-line distance up to
// approximate real road distance rather than pricing the trip as if roads
// were straight lines. 1.3x is a reasonable general correction for Kampala's
// road network -- not exact for any given trip, but far closer than 1x.
const ROAD_DISTANCE_FALLBACK_FACTOR = 1.3;
const ROUTES_API_TIMEOUT_MS = 4000;

export interface LatLng {
  lat: number;
  lng: number;
}

interface RoadRoute {
  distanceKm: number;
  durationMin: number;
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  haversineDistanceKm(a: LatLng, b: LatLng): number {
    const dLat = this.toRad(b.lat - a.lat);
    const dLng = this.toRad(b.lng - a.lng);
    const lat1 = this.toRad(a.lat);
    const lat2 = this.toRad(b.lat);
    const sin1 = Math.sin(dLat / 2);
    const sin2 = Math.sin(dLng / 2);
    const c = sin1 * sin1 + Math.cos(lat1) * Math.cos(lat2) * sin2 * sin2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
  }

  private toRad(deg: number) {
    return (deg * Math.PI) / 180;
  }

  etaMinutesForDistance(distanceKm: number): number {
    return Math.round((distanceKm / AVERAGE_SPEED_KMH) * 60);
  }

  // Real road distance/duration via Google's Routes API. Returns null (never
  // throws) if the key isn't configured, the call fails, or the response
  // doesn't parse -- callers fall back to an estimate so a routing outage
  // never blocks a passenger from booking a trip.
  //
  // Uses DRIVE mode rather than TWO_WHEELER: Google's two-wheeler routing is
  // only available in a handful of countries (India chief among them) and
  // silently misbehaves outside them, whereas DRIVE is supported everywhere
  // Routes API is and is still far closer to reality than a straight line --
  // a boda can thread some routes a car can't, so this may run slightly long
  // rather than short, which errs in the passenger's favor, not the platform's.
  private async computeRoadRoute(pickup: LatLng, destination: LatLng): Promise<RoadRoute | null> {
    const apiKey = this.config.get<string>('GOOGLE_ROUTES_API_KEY');
    if (!apiKey) return null;

    try {
      const res = await axios.post(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          origin: { location: { latLng: { latitude: pickup.lat, longitude: pickup.lng } } },
          destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
          travelMode: 'DRIVE',
          units: 'METRIC',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
          },
          timeout: ROUTES_API_TIMEOUT_MS,
        },
      );

      const route = res.data?.routes?.[0];
      const distanceMeters = route?.distanceMeters;
      const durationSec = Number(String(route?.duration ?? '').replace('s', ''));

      if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSec)) {
        this.logger.warn('Routes API returned an unparseable response, falling back to estimated distance');
        return null;
      }

      return { distanceKm: distanceMeters / 1000, durationMin: durationSec / 60 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Routes API call failed, falling back to estimated distance: ${message}`);
      return null;
    }
  }

  async estimateFare(rideType: RideType, pickup: LatLng, destination: LatLng) {
    const straightLineKm = this.haversineDistanceKm(pickup, destination);

    const [road, existingRule] = await Promise.all([
      this.computeRoadRoute(pickup, destination),
      this.prisma.pricingRule.findUnique({ where: { rideType } }),
    ]);
    const rule =
      existingRule ??
      (await this.prisma.pricingRule.create({
        data: { rideType, ...this.defaultRuleFor(rideType) },
      }));

    const distanceKm = road?.distanceKm ?? straightLineKm * ROAD_DISTANCE_FALLBACK_FACTOR;
    const durationMin = road?.durationMin ?? (distanceKm / AVERAGE_SPEED_KMH) * 60;

    const fare = rule.baseFare + rule.perKm * distanceKm + rule.perMinute * durationMin;

    return {
      rideType,
      distanceKm: Number(distanceKm.toFixed(2)),
      durationMin: Number(durationMin.toFixed(1)),
      fare: Math.round(fare),
      currency: rule.currency,
    };
  }

  private defaultRuleFor(rideType: RideType) {
    switch (rideType) {
      case RideType.BODA:
        return { baseFare: 1500, perKm: 500, perMinute: 50, currency: 'UGX' };
      case RideType.COMFORT:
        return { baseFare: 4000, perKm: 1200, perMinute: 150, currency: 'UGX' };
      default:
        return { baseFare: 3000, perKm: 900, perMinute: 100, currency: 'UGX' };
    }
  }
}
