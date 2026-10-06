import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, Prisma, RideType, TripStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_STOPS, PricingService } from './pricing.service';
import { TripsGateway } from './trips.gateway';
import { SOCKET_EVENTS } from './socket-events';
import { RequestTripDto } from './dto/request-trip.dto';
import { UpdateTripStatusDto } from './dto/update-trip-status.dto';
import { RateTripDto } from './dto/rate-trip.dto';
import { ReplaceStopsDto } from './dto/stop-input.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../notifications/email.service';
import { decryptUserPhone } from '../common/field-encryption';
import { MapsPlatformService } from '../maps-platform/maps-platform.service';

const SEARCH_RADIUS_KM = 6;
export const PLATFORM_COMMISSION_RATE = 0.15;

const STOP_EDITABLE_STATUSES: TripStatus[] = [
  TripStatus.SEARCHING,
  TripStatus.ACCEPTED,
  TripStatus.ARRIVED,
  TripStatus.IN_PROGRESS,
];

// createdAt breaks ties: if the driver reaches a stop while the passenger's edit is saving, the
// reached stop and the first new one can share a sequence number, and the reached one is older.
const ORDERED_STOPS = {
  orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
} satisfies Prisma.Trip$stopsArgs;

const TRIP_DETAIL_INCLUDE = {
  driver: {
    include: { vehicle: true, user: { omit: { passwordHash: true } } },
  },
  passenger: { omit: { passwordHash: true } },
  payment: true,
  stops: ORDERED_STOPS,
} satisfies Prisma.TripInclude;

@Injectable()
export class TripsService {
  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private gateway: TripsGateway,
    private notifications: NotificationsService,
    private emailService: EmailService,
    private maps: MapsPlatformService,
  ) {}

  async requestTrip(passengerId: string, dto: RequestTripDto) {
    const pickup = { lat: dto.pickupLat, lng: dto.pickupLng };
    const destination = { lat: dto.destinationLat, lng: dto.destinationLng };
    const stops = dto.stops ?? [];
    const estimate = await this.pricing.estimateFare(
      dto.rideType,
      pickup,
      destination,
      stops,
    );

    const trip = await this.prisma.trip.create({
      include: { stops: ORDERED_STOPS },
      data: {
        passengerId,
        status: TripStatus.SEARCHING,
        rideType: dto.rideType,
        pickupAddress: dto.pickupAddress,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        destinationAddress: dto.destinationAddress,
        destinationLat: dto.destinationLat,
        destinationLng: dto.destinationLng,
        distanceKm: estimate.distanceKm,
        durationMin: estimate.durationMin,
        fare: estimate.fare,
        currency: estimate.currency,
        couponCode: dto.couponCode,
        paymentMethod: dto.paymentMethod,
        stops: {
          create: stops.map((s, i) => ({
            sequence: i,
            address: s.address,
            lat: s.lat,
            lng: s.lng,
          })),
        },
      },
    });

    this.maps.recordPlaces([
      { label: dto.pickupAddress, ...pickup },
      ...stops.map((s) => ({ label: s.address, lat: s.lat, lng: s.lng })),
      { label: dto.destinationAddress, ...destination },
    ]);

    const nearbyDrivers = await this.pricing.findNearbyDrivers(
      dto.rideType,
      pickup,
      SEARCH_RADIUS_KM,
    );
    for (const driver of nearbyDrivers) {
      this.gateway.emitToUser(driver.userId, SOCKET_EVENTS.TRIP_REQUESTED, {
        tripId: trip.id,
        pickupAddress: trip.pickupAddress,
        destinationAddress: trip.destinationAddress,
        fare: trip.fare,
        rideType: trip.rideType,
        stopCount: trip.stops.length,
        distanceToPickupKm: Number(driver.distanceKm.toFixed(2)),
        etaToPickupMin: this.pricing.etaMinutesForDistance(driver.distanceKm),
      });
    }

    return { trip, candidateDriverCount: nearbyDrivers.length };
  }

  async acceptTrip(driverUserId: string, tripId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId: driverUserId },
    });
    if (!driver) throw new NotFoundException('Rider not found');

    // The where clause's status check makes this update atomic at the DB level:
    // if two drivers race, only the first UPDATE...WHERE status='SEARCHING' matches a row.
    const result = await this.prisma.trip.updateMany({
      where: { id: tripId, status: TripStatus.SEARCHING },
      data: {
        status: TripStatus.ACCEPTED,
        driverId: driver.id,
        acceptedAt: new Date(),
      },
    });
    if (result.count === 0) {
      throw new BadRequestException('Trip is no longer available');
    }

    const updated = await this.loadTrip(tripId);

    this.gateway.emitToUser(
      updated.passengerId,
      SOCKET_EVENTS.TRIP_ACCEPTED,
      updated,
    );
    this.notifications.notifyUser(
      updated.passengerId,
      'Rider on the way',
      `${updated.driver?.user?.name ?? 'Your rider'} accepted your ride request.`,
    );
    return updated;
  }

  async rejectTrip(driverUserId: string, tripId: string) {
    this.gateway.emitToUser(driverUserId, SOCKET_EVENTS.TRIP_REJECTED, {
      tripId,
    });
    return { success: true };
  }

  async updateStatus(userId: string, tripId: string, dto: UpdateTripStatusDto) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { driver: true, passenger: true },
    });
    if (!trip) throw new NotFoundException('Trip not found');

    const isPassenger = trip.passengerId === userId;
    const isDriver = trip.driver?.userId === userId;
    if (!isPassenger && !isDriver) {
      throw new ForbiddenException('Not part of this trip');
    }

    const timestampField = this.timestampFieldFor(dto.status);
    const now = new Date();
    await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        status: dto.status,
        cancellationReason: dto.cancellationReason,
        ...(timestampField ? { [timestampField]: now } : {}),
        // Who actually cancelled -- a passenger cancelling their own request is what racks up
        // billable Google Routes API calls for nothing; a driver backing out after accepting
        // doesn't trigger a new one. See the admin over-cancellation flag, which only counts
        // the former.
        ...(dto.status === TripStatus.CANCELLED
          ? { cancelledByUserId: userId }
          : {}),
      },
    });

    if (dto.status === TripStatus.COMPLETED) {
      await this.recordActualRoute(tripId, trip.startedAt, now);

      const finalFare =
        trip.status === TripStatus.COMPLETED
          ? (trip.fare ?? 0)
          : await this.applyWaitingFee(
              tripId,
              trip.rideType,
              trip.fare ?? 0,
              now,
            );

      // Payment always starts PENDING, even for CASH: the driver wallet is only credited once
      // the payment is actually confirmed (passenger cash confirmation, or a payment webhook),
      // not just because the ride finished.
      await this.prisma.payment.create({
        data: {
          tripId,
          amount: finalFare,
          currency: trip.currency,
          method: trip.paymentMethod,
          status: PaymentStatus.PENDING,
        },
      });
      if (trip.driverId) {
        await this.prisma.driver.update({
          where: { id: trip.driverId },
          data: { totalTrips: { increment: 1 } },
        });
      }
      this.notifications.notifyUser(
        trip.passengerId,
        'Trip completed',
        `Your trip is complete. Fare: ${finalFare} ${trip.currency}.`,
      );
      this.emailService.sendTripReceipt(
        trip.passenger.email,
        finalFare,
        trip.currency,
        tripId,
      );
    }

    const updated = await this.loadTrip(tripId);
    this.broadcast(
      updated,
      dto.status === TripStatus.CANCELLED
        ? SOCKET_EVENTS.TRIP_CANCELLED
        : SOCKET_EVENTS.TRIP_STATUS_UPDATED,
    );
    return updated;
  }

  // Closes a stop the driver is still waiting at (completing the trip there is an explicit
  // tap, so the wait is real), then adds the waiting charge to the fare. `fare` must hold the
  // final amount because payments and driver earnings read it.
  private async applyWaitingFee(
    tripId: string,
    rideType: RideType,
    quotedFare: number,
    completedAt: Date,
  ): Promise<number> {
    await this.prisma.tripStop.updateMany({
      where: { tripId, arrivedAt: { not: null }, departedAt: null },
      data: { departedAt: completedAt },
    });
    const stops = await this.prisma.tripStop.findMany({ where: { tripId } });
    const waitingFee = await this.pricing.tripWaitingFee(rideType, stops);
    if (waitingFee === 0) return quotedFare;

    const finalFare = quotedFare + waitingFee;
    await this.prisma.trip.update({
      where: { id: tripId },
      data: { waitingFee, fare: finalFare },
    });
    return finalFare;
  }

  async previewStops(
    passengerId: string,
    tripId: string,
    dto: ReplaceStopsDto,
  ) {
    const { trip, lockedStops } = await this.editableTrip(
      passengerId,
      tripId,
      dto,
    );
    const estimate = await this.pricing.estimateFare(
      trip.rideType,
      { lat: trip.pickupLat, lng: trip.pickupLng },
      { lat: trip.destinationLat, lng: trip.destinationLng },
      [...lockedStops, ...dto.stops],
    );
    return { ...estimate, previousFare: trip.fare };
  }

  // Re-prices the whole route from pickup, so the new fare is exactly what booking this
  // route up front would have cost.
  async replaceStops(
    passengerId: string,
    tripId: string,
    dto: ReplaceStopsDto,
  ) {
    const { trip, lockedStops } = await this.editableTrip(
      passengerId,
      tripId,
      dto,
    );
    const estimate = await this.pricing.estimateFare(
      trip.rideType,
      { lat: trip.pickupLat, lng: trip.pickupLng },
      { lat: trip.destinationLat, lng: trip.destinationLng },
      [...lockedStops, ...dto.stops],
    );

    await this.prisma.$transaction([
      this.prisma.tripStop.deleteMany({ where: { tripId, arrivedAt: null } }),
      this.prisma.tripStop.createMany({
        data: dto.stops.map((s, i) => ({
          tripId,
          sequence: lockedStops.length + i,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
        })),
      }),
      this.prisma.trip.update({
        where: { id: tripId },
        data: {
          fare: estimate.fare,
          distanceKm: estimate.distanceKm,
          durationMin: estimate.durationMin,
        },
      }),
    ]);

    this.maps.recordPlaces(
      dto.stops.map((s) => ({ label: s.address, lat: s.lat, lng: s.lng })),
    );

    const updated = await this.loadTrip(tripId);
    this.broadcast(updated, SOCKET_EVENTS.TRIP_STATUS_UPDATED);
    if (updated.driver) {
      this.notifications.notifyUser(
        updated.driver.userId,
        'Stops changed',
        `Your passenger updated their stops. New fare: ${estimate.fare} ${estimate.currency}.`,
      );
    }
    return updated;
  }

  private async editableTrip(
    passengerId: string,
    tripId: string,
    dto: ReplaceStopsDto,
  ) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { stops: ORDERED_STOPS },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.passengerId !== passengerId) {
      throw new ForbiddenException('Not your trip');
    }
    if (!STOP_EDITABLE_STATUSES.includes(trip.status)) {
      throw new BadRequestException(
        'Stops can no longer be changed on this trip',
      );
    }
    const lockedStops = trip.stops.filter((s) => s.arrivedAt);
    if (lockedStops.length + dto.stops.length > MAX_STOPS) {
      throw new BadRequestException(
        `A trip can have at most ${MAX_STOPS} stops`,
      );
    }
    return { trip, lockedStops };
  }

  // Stops are visited strictly in order: the driver can only arrive at the first stop not yet
  // reached, and only after leaving the one before it.
  async arriveAtStop(driverUserId: string, tripId: string, stopId: string) {
    const trip = await this.inProgressTripForDriver(driverUserId, tripId);
    const next = trip.stops.find((s) => !s.arrivedAt);
    if (!next || next.id !== stopId) {
      throw new BadRequestException('That is not the next stop');
    }
    if (trip.stops.some((s) => s.arrivedAt && !s.departedAt)) {
      throw new BadRequestException('Leave the current stop first');
    }
    await this.prisma.tripStop.update({
      where: { id: stopId },
      data: { arrivedAt: new Date() },
    });
    const updated = await this.loadTrip(tripId);
    this.broadcast(updated, SOCKET_EVENTS.TRIP_STATUS_UPDATED);
    return updated;
  }

  async departStop(driverUserId: string, tripId: string, stopId: string) {
    const trip = await this.inProgressTripForDriver(driverUserId, tripId);
    const stop = trip.stops.find((s) => s.id === stopId);
    if (!stop?.arrivedAt || stop.departedAt) {
      throw new BadRequestException('You are not waiting at that stop');
    }
    await this.prisma.tripStop.update({
      where: { id: stopId },
      data: { departedAt: new Date() },
    });
    const updated = await this.loadTrip(tripId);
    this.broadcast(updated, SOCKET_EVENTS.TRIP_STATUS_UPDATED);
    return updated;
  }

  private async inProgressTripForDriver(driverUserId: string, tripId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { driver: true, stops: ORDERED_STOPS },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.driver?.userId !== driverUserId) {
      throw new ForbiddenException('Not your trip');
    }
    if (trip.status !== TripStatus.IN_PROGRESS) {
      throw new BadRequestException('Start the trip before visiting stops');
    }
    return trip;
  }

  private async loadTrip(tripId: string) {
    return this.decryptTripPhones(
      await this.prisma.trip.findUniqueOrThrow({
        where: { id: tripId },
        include: TRIP_DETAIL_INCLUDE,
      }),
    );
  }

  private broadcast(
    trip: Awaited<ReturnType<TripsService['loadTrip']>>,
    event: string,
  ) {
    this.gateway.emitToTrip(trip.id, event, trip);
    this.gateway.emitToUser(trip.passengerId, event, trip);
  }

  private decryptTripPhones<
    T extends {
      driver?: { user?: { phone?: string | null } | null } | null;
      passenger?: { phone?: string | null } | null;
    },
  >(trip: T): T {
    return {
      ...trip,
      driver: trip.driver
        ? {
            ...trip.driver,
            user: trip.driver.user
              ? decryptUserPhone(trip.driver.user)
              : trip.driver.user,
          }
        : trip.driver,
      passenger: trip.passenger
        ? decryptUserPhone(trip.passenger)
        : trip.passenger,
    };
  }

  // Turns the raw GPS trace (see TripLocationPing's schema comment) into the actual
  // distance/duration the trip took, so it can be compared against the pre-trip estimate
  // already stored on the trip. Summing consecutive-ping distances is a cruder measure of
  // distance than snapping the trace to actual roads (map-matching), but it needs no extra
  // infrastructure and is still a real signal -- good enough to start measuring the gap with.
  // Left null if too few pings came in to say anything (e.g. the driver app was backgrounded).
  private async recordActualRoute(
    tripId: string,
    startedAt: Date | null,
    completedAt: Date,
  ) {
    const pings = await this.prisma.tripLocationPing.findMany({
      where: { tripId },
      orderBy: { recordedAt: 'asc' },
    });

    let actualDistanceKm: number | null = null;
    if (pings.length >= 2) {
      actualDistanceKm = 0;
      for (let i = 1; i < pings.length; i++) {
        actualDistanceKm += this.pricing.haversineDistanceKm(
          { lat: pings[i - 1].lat, lng: pings[i - 1].lng },
          { lat: pings[i].lat, lng: pings[i].lng },
        );
      }
    }
    const actualDurationMin = startedAt
      ? (completedAt.getTime() - startedAt.getTime()) / 60000
      : null;

    if (actualDistanceKm === null && actualDurationMin === null) return;
    await this.prisma.trip.update({
      where: { id: tripId },
      data: { actualDistanceKm, actualDurationMin },
    });
  }

  private timestampFieldFor(status: TripStatus): string | null {
    switch (status) {
      case TripStatus.ARRIVED:
        return 'arrivedAt';
      case TripStatus.IN_PROGRESS:
        return 'startedAt';
      case TripStatus.COMPLETED:
        return 'completedAt';
      case TripStatus.CANCELLED:
        return 'cancelledAt';
      default:
        return null;
    }
  }

  async rateTrip(raterId: string, tripId: string, dto: RateTripDto) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { driver: { include: { user: true } } },
    });
    if (!trip || trip.status !== TripStatus.COMPLETED) {
      throw new BadRequestException('Trip must be completed before rating');
    }

    const isPassenger = trip.passengerId === raterId;
    const toUserId = isPassenger ? trip.driver?.user?.id : trip.passengerId;
    if (!toUserId) {
      throw new BadRequestException('Unable to determine rating recipient');
    }

    const rating = await this.prisma.rating.create({
      data: {
        tripId,
        fromUserId: raterId,
        toUserId,
        stars: dto.stars,
        comment: dto.comment,
      },
    });

    if (isPassenger && trip.driverId) {
      const avg = await this.prisma.rating.aggregate({
        where: { toUserId },
        _avg: { stars: true },
      });
      await this.prisma.driver.update({
        where: { id: trip.driverId },
        data: { rating: avg._avg.stars ?? 5 },
      });
    }

    return rating;
  }

  myTrips(userId: string, role: 'PASSENGER' | 'DRIVER') {
    if (role === 'DRIVER') {
      return this.prisma.trip.findMany({
        where: { driver: { userId } },
        orderBy: { createdAt: 'desc' },
      });
    }
    return this.prisma.trip.findMany({
      where: { passengerId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTrip(userId: string, tripId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: TRIP_DETAIL_INCLUDE,
    });
    if (!trip) throw new NotFoundException('Trip not found');
    const isPassenger = trip.passengerId === userId;
    const isDriver = trip.driver?.userId === userId;
    if (!isPassenger && !isDriver) {
      throw new ForbiddenException('Not part of this trip');
    }
    return this.decryptTripPhones(trip);
  }
}
