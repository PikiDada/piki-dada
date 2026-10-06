import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { RideType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MapsPlatformService } from '../maps-platform/maps-platform.service';

const EARTH_RADIUS_KM = 6371;
const AVERAGE_SPEED_KMH = 28;
// When the Routes API is unavailable, scale the straight-line distance up to
// approximate real road distance rather than pricing the trip as if roads
// were straight lines. 1.3x is a reasonable general correction for Kampala's
// road network -- not exact for any given trip, but far closer than 1x.
const ROAD_DISTANCE_FALLBACK_FACTOR = 1.3;
const ROUTES_API_TIMEOUT_MS = 4000;
// Cash is how most trips/deliveries get paid, and nobody wants to carry exact change for a
// fare like 7,432 UGX -- round every fare (rides and deliveries) to the nearest note
// denomination instead.
const FARE_ROUNDING_UNIT = 500;

export interface LatLng {
  lat: number;
  lng: number;
}

function roundToNearest(amount: number, unit: number): number {
  return Math.round(amount / unit) * unit;
}

export const MAX_STOPS = 3;
export const FREE_WAIT_MINUTES_PER_STOP = 3;

export interface StopVisit {
  arrivedAt: Date | null;
  departedAt: Date | null;
}

// Whole minutes past the free allowance, per stop. A stop the driver never marked as departed
// is not charged: the alternative (billing until trip completion) can produce a large charge
// from a forgotten tap.
function billableWaitMinutes(stops: StopVisit[]): number {
  let total = 0;
  for (const stop of stops) {
    if (!stop.arrivedAt || !stop.departedAt) continue;
    const waited =
      (stop.departedAt.getTime() - stop.arrivedAt.getTime()) / 60000;
    total += Math.max(0, Math.floor(waited - FREE_WAIT_MINUTES_PER_STOP));
  }
  return total;
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
    private maps: MapsPlatformService,
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

  // Sum of straight lines between consecutive points, so stops count toward the estimate too.
  private straightLineKm(points: LatLng[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += this.haversineDistanceKm(points[i - 1], points[i]);
    }
    return total;
  }

  // Three-layer fallback, cheapest/free first: the maps platform (self-hosted OSRM, tuned by
  // speeds learned from real trips; if MAPS_PLATFORM_URL is configured) -> Google Routes API
  // (if GOOGLE_ROUTES_API_KEY is configured) -> straight-line estimate in the caller. Each
  // layer never throws -- a routing outage never blocks a passenger from booking a trip, it
  // just prices a bit less precisely. `points` is the whole route in visiting order: pickup,
  // any stops, destination.
  private async computeRoadRoute(points: LatLng[]): Promise<RoadRoute | null> {
    if (this.maps.enabled) {
      const route = await this.maps.route(points);
      if (route) return route;
      this.logger.warn(
        'Maps platform route failed, falling back to Google Routes API',
      );
    }
    return this.computeGoogleRoute(points);
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
  //
  // avoidTolls: true -- without it, DRIVE mode happily routes over toll
  // expressways (e.g. Kampala-Entebbe) that bodas are legally barred from and
  // that most riders/drivers here wouldn't pay to use anyway, so the "closer
  // to reality than a straight line" premise above only holds with this set.
  private async computeGoogleRoute(
    points: LatLng[],
  ): Promise<RoadRoute | null> {
    const apiKey = this.config.get<string>('GOOGLE_ROUTES_API_KEY');
    if (!apiKey) return null;

    const waypoint = (p: LatLng) => ({
      location: { latLng: { latitude: p.lat, longitude: p.lng } },
    });
    const intermediates = points.slice(1, -1);

    try {
      const res = await axios.post(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          origin: waypoint(points[0]),
          destination: waypoint(points[points.length - 1]),
          ...(intermediates.length
            ? { intermediates: intermediates.map(waypoint) }
            : {}),
          travelMode: 'DRIVE',
          units: 'METRIC',
          routeModifiers: { avoidTolls: true },
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
      const durationSec = Number(
        String(route?.duration ?? '').replace('s', ''),
      );

      if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSec)) {
        this.logger.warn(
          'Routes API returned an unparseable response, falling back to estimated distance',
        );
        return null;
      }

      return {
        distanceKm: distanceMeters / 1000,
        durationMin: durationSec / 60,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Routes API call failed, falling back to estimated distance: ${message}`,
      );
      return null;
    }
  }

  private async rideRule(rideType: RideType) {
    const existing = await this.prisma.pricingRule.findUnique({
      where: { rideType },
    });
    return (
      existing ??
      (await this.prisma.pricingRule.create({
        data: { rideType, ...this.defaultRuleFor(rideType) },
      }))
    );
  }

  private async deliveryRule(sizeTierId: string) {
    const existing = await this.prisma.deliverySizeTierPricingRule.findUnique({
      where: { sizeTierId },
    });
    return (
      existing ??
      (await this.prisma.deliverySizeTierPricingRule.create({
        data: {
          sizeTierId,
          baseFare: 1500,
          perKm: 500,
          perMinute: 50,
          currency: 'UGX',
        },
      }))
    );
  }

  async estimateFare(
    rideType: RideType,
    pickup: LatLng,
    destination: LatLng,
    stops: LatLng[] = [],
  ) {
    const points = [pickup, ...stops, destination];
    const straightLineKm = this.straightLineKm(points);

    const [road, rule] = await Promise.all([
      this.computeRoadRoute(points),
      this.rideRule(rideType),
    ]);

    const distanceKm =
      road?.distanceKm ?? straightLineKm * ROAD_DISTANCE_FALLBACK_FACTOR;
    const durationMin =
      road?.durationMin ?? (distanceKm / AVERAGE_SPEED_KMH) * 60;

    const fare =
      rule.baseFare + rule.perKm * distanceKm + rule.perMinute * durationMin;

    return {
      rideType,
      distanceKm: Number(distanceKm.toFixed(2)),
      durationMin: Number(durationMin.toFixed(1)),
      fare: roundToNearest(fare, FARE_ROUNDING_UNIT),
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

  // Same fare math as estimateFare, keyed by size/weight tier rather than category -- tier is
  // what actually drives delivery price (how hard the item is to carry), not what it is. Falls
  // back to BODA-like rates for a tier that has no pricing rule configured yet, rather than
  // failing a booking outright — matches estimateFare's auto-provisioning behavior above.
  // `surcharges` adds flat handling fees (fragile, liquid, ...) on top of the tier fare.
  async estimateDeliveryFare(
    sizeTierId: string,
    surcharges: { isFragile: boolean; isLiquid: boolean },
    pickup: LatLng,
    destination: LatLng,
    stops: LatLng[] = [],
  ) {
    const points = [pickup, ...stops, destination];
    const straightLineKm = this.straightLineKm(points);

    const [road, rule, surchargeRules] = await Promise.all([
      this.computeRoadRoute(points),
      this.deliveryRule(sizeTierId),
      this.prisma.deliverySurchargeRule.findMany({ where: { isActive: true } }),
    ]);

    const distanceKm =
      road?.distanceKm ?? straightLineKm * ROAD_DISTANCE_FALLBACK_FACTOR;
    const durationMin =
      road?.durationMin ?? (distanceKm / AVERAGE_SPEED_KMH) * 60;

    const baseFare =
      rule.baseFare + rule.perKm * distanceKm + rule.perMinute * durationMin;

    const activeFlags: Record<string, boolean> = {
      FRAGILE: surcharges.isFragile,
      LIQUID: surcharges.isLiquid,
    };
    const surchargeTotal = surchargeRules
      .filter((s) => activeFlags[s.key])
      .reduce((sum, s) => sum + s.amount, 0);

    return {
      sizeTierId,
      distanceKm: Number(distanceKm.toFixed(2)),
      durationMin: Number(durationMin.toFixed(1)),
      fare: roundToNearest(baseFare + surchargeTotal, FARE_ROUNDING_UNIT),
      currency: rule.currency,
    };
  }

  async tripWaitingFee(rideType: RideType, stops: StopVisit[]) {
    const minutes = billableWaitMinutes(stops);
    if (minutes === 0) return 0;
    const rule = await this.rideRule(rideType);
    return roundToNearest(minutes * rule.perMinute, FARE_ROUNDING_UNIT);
  }

  async deliveryWaitingFee(sizeTierId: string | null, stops: StopVisit[]) {
    const minutes = billableWaitMinutes(stops);
    if (minutes === 0 || !sizeTierId) return 0;
    const rule = await this.deliveryRule(sizeTierId);
    return roundToNearest(minutes * rule.perMinute, FARE_ROUNDING_UNIT);
  }

  // Shared by TripsService and DeliveriesService — pure geo-matching, no money involved, so
  // safe to share rather than duplicate. Deliveries always call this with rideType = 'BODA'.
  async findNearbyDrivers(
    rideType: RideType,
    pickup: LatLng,
    radiusKm: number,
  ) {
    const onlineDrivers = await this.prisma.driver.findMany({
      where: {
        isOnline: true,
        approvalStatus: 'APPROVED',
        currentLat: { not: null },
        currentLng: { not: null },
        vehicle: { rideType },
      },
    });

    return onlineDrivers
      .map((driver) => ({
        ...driver,
        distanceKm: this.haversineDistanceKm(pickup, {
          lat: driver.currentLat!,
          lng: driver.currentLng!,
        }),
      }))
      .filter((driver) => driver.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }
}
