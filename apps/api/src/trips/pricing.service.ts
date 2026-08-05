import { Injectable } from '@nestjs/common';
import { RideType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const EARTH_RADIUS_KM = 6371;
const AVERAGE_SPEED_KMH = 28;

export interface LatLng {
  lat: number;
  lng: number;
}

@Injectable()
export class PricingService {
  constructor(private prisma: PrismaService) {}

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

  async estimateFare(rideType: RideType, pickup: LatLng, destination: LatLng) {
    const distanceKm = this.haversineDistanceKm(pickup, destination);
    const durationMin = (distanceKm / AVERAGE_SPEED_KMH) * 60;

    let rule = await this.prisma.pricingRule.findUnique({ where: { rideType } });
    if (!rule) {
      rule = await this.prisma.pricingRule.create({
        data: { rideType, ...this.defaultRuleFor(rideType) },
      });
    }

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
