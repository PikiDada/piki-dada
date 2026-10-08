import { Injectable } from '@nestjs/common';
import { DeliveryStatus, TripStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MapsPlatformService,
  type LatLng,
} from '../maps-platform/maps-platform.service';

// During a job the driver app streams GPS over the socket (see TripsGateway's location relay),
// not the REST location endpoint, so this is where traces are captured.

// Map-matching works well at a few seconds between points; denser than that only adds rows.
const MIN_PING_INTERVAL_MS = 3000;

// The drive to pickup is real road travel too, so the maps platform gets it. Our own database
// always keeps the billed part (a ride IN_PROGRESS, a delivery PICKED_UP) for actual-vs-estimate
// comparisons. The rest is kept only while the maps platform isn't running to receive it, so
// scripts/replay-pings.ts can hand it over later instead of that learning being lost.
const TRIP_TRACKED_STATUSES: TripStatus[] = [
  TripStatus.ACCEPTED,
  TripStatus.ARRIVED,
  TripStatus.IN_PROGRESS,
];
const DELIVERY_TRACKED_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.ACCEPTED,
  DeliveryStatus.ARRIVED_PICKUP,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.ARRIVED_DROPOFF,
];

@Injectable()
export class JourneyTrackingService {
  private lastPingAt = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private maps: MapsPlatformService,
  ) {}

  // Returns false when the sender is not the driver assigned to the job. The gateway then
  // doesn't relay the location either: without this check any connected client could push a
  // fake position to a passenger, or poison the speeds the maps platform learns.
  async recordDriverLocation(
    driverUserId: string,
    ref: { tripId?: string; deliveryId?: string },
    location: LatLng,
  ): Promise<boolean> {
    if (!Number.isFinite(location?.lat) || !Number.isFinite(location?.lng)) {
      return false;
    }
    const now = new Date();

    if (ref.tripId) {
      const trip = await this.prisma.trip.findUnique({
        where: { id: ref.tripId },
        select: { status: true, driver: { select: { userId: true } } },
      });
      if (!trip || trip.driver?.userId !== driverUserId) return false;
      const journeyId = `trip:${ref.tripId}`;
      if (
        TRIP_TRACKED_STATUSES.includes(trip.status) &&
        this.due(journeyId, now)
      ) {
        const billed = trip.status === TripStatus.IN_PROGRESS;
        if (billed || !this.maps.enabled) {
          await this.prisma.tripLocationPing.create({
            data: {
              tripId: ref.tripId,
              lat: location.lat,
              lng: location.lng,
              billed,
              recordedAt: now,
            },
          });
        }
        this.maps.recordPing(journeyId, location, now);
      }
      return true;
    }

    if (ref.deliveryId) {
      const delivery = await this.prisma.delivery.findUnique({
        where: { id: ref.deliveryId },
        select: { status: true, rider: { select: { userId: true } } },
      });
      if (!delivery || delivery.rider?.userId !== driverUserId) return false;
      const journeyId = `delivery:${ref.deliveryId}`;
      if (
        DELIVERY_TRACKED_STATUSES.includes(delivery.status) &&
        this.due(journeyId, now)
      ) {
        const billed = delivery.status === DeliveryStatus.PICKED_UP;
        if (billed || !this.maps.enabled) {
          await this.prisma.deliveryLocationPing.create({
            data: {
              deliveryId: ref.deliveryId,
              lat: location.lat,
              lng: location.lng,
              billed,
              recordedAt: now,
            },
          });
        }
        this.maps.recordPing(journeyId, location, now);
      }
      return true;
    }

    return false;
  }

  private due(journeyId: string, now: Date): boolean {
    const last = this.lastPingAt.get(journeyId);
    if (last !== undefined && now.getTime() - last < MIN_PING_INTERVAL_MS) {
      return false;
    }
    this.lastPingAt.set(journeyId, now.getTime());
    if (this.lastPingAt.size > 5000) this.forgetStale(now);
    return true;
  }

  // Keeps the throttle map from growing forever: a journey silent for 10 minutes is over.
  private forgetStale(now: Date) {
    for (const [journeyId, at] of this.lastPingAt) {
      if (now.getTime() - at > 10 * 60 * 1000)
        this.lastPingAt.delete(journeyId);
    }
  }
}
