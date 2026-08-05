import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, TripStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from './pricing.service';
import { TripsGateway } from './trips.gateway';
import { SOCKET_EVENTS } from './socket-events';
import { RequestTripDto } from './dto/request-trip.dto';
import { UpdateTripStatusDto } from './dto/update-trip-status.dto';
import { RateTripDto } from './dto/rate-trip.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../notifications/email.service';
import { decryptUserPhone } from '../common/field-encryption';

const SEARCH_RADIUS_KM = 6;
export const PLATFORM_COMMISSION_RATE = 0.15;

@Injectable()
export class TripsService {
  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private gateway: TripsGateway,
    private notifications: NotificationsService,
    private emailService: EmailService,
  ) {}

  async requestTrip(passengerId: string, dto: RequestTripDto) {
    const pickup = { lat: dto.pickupLat, lng: dto.pickupLng };
    const destination = { lat: dto.destinationLat, lng: dto.destinationLng };
    const estimate = await this.pricing.estimateFare(dto.rideType, pickup, destination);

    const trip = await this.prisma.trip.create({
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
      },
    });

    const nearbyDrivers = await this.findNearbyDrivers(dto.rideType, pickup);
    for (const driver of nearbyDrivers) {
      this.gateway.emitToUser(driver.userId, SOCKET_EVENTS.TRIP_REQUESTED, {
        tripId: trip.id,
        pickupAddress: trip.pickupAddress,
        destinationAddress: trip.destinationAddress,
        fare: trip.fare,
        rideType: trip.rideType,
        distanceToPickupKm: Number(driver.distanceKm.toFixed(2)),
        etaToPickupMin: this.pricing.etaMinutesForDistance(driver.distanceKm),
      });
    }

    return { trip, candidateDriverCount: nearbyDrivers.length };
  }

  private async findNearbyDrivers(rideType: string, pickup: { lat: number; lng: number }) {
    const onlineDrivers = await this.prisma.driver.findMany({
      where: {
        isOnline: true,
        approvalStatus: 'APPROVED',
        currentLat: { not: null },
        currentLng: { not: null },
        vehicle: { rideType: rideType as never },
      },
    });

    return onlineDrivers
      .map((driver) => ({
        ...driver,
        distanceKm: this.pricing.haversineDistanceKm(pickup, {
          lat: driver.currentLat!,
          lng: driver.currentLng!,
        }),
      }))
      .filter((driver) => driver.distanceKm <= SEARCH_RADIUS_KM)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  async acceptTrip(driverUserId: string, tripId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { userId: driverUserId } });
    if (!driver) throw new NotFoundException('Driver not found');

    // The where clause's status check makes this update atomic at the DB level:
    // if two drivers race, only the first UPDATE...WHERE status='SEARCHING' matches a row.
    const result = await this.prisma.trip.updateMany({
      where: { id: tripId, status: TripStatus.SEARCHING },
      data: { status: TripStatus.ACCEPTED, driverId: driver.id, acceptedAt: new Date() },
    });
    if (result.count === 0) {
      throw new BadRequestException('Trip is no longer available');
    }

    const updated = this.decryptTripPhones(
      await this.prisma.trip.findUniqueOrThrow({
        where: { id: tripId },
        include: { driver: { include: { vehicle: true, user: { omit: { passwordHash: true } } } } },
      }),
    );

    this.gateway.emitToUser(updated.passengerId, SOCKET_EVENTS.TRIP_ACCEPTED, updated);
    this.notifications.notifyUser(
      updated.passengerId,
      'Driver on the way',
      `${updated.driver?.user?.name ?? 'Your driver'} accepted your ride request.`,
    );
    return updated;
  }

  async rejectTrip(driverUserId: string, tripId: string) {
    this.gateway.emitToUser(driverUserId, SOCKET_EVENTS.TRIP_REJECTED, { tripId });
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
    await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        status: dto.status,
        cancellationReason: dto.cancellationReason,
        ...(timestampField ? { [timestampField]: new Date() } : {}),
      },
    });

    if (dto.status === TripStatus.COMPLETED) {
      // Payment always starts PENDING, even for CASH: the driver wallet is only credited once
      // the payment is actually confirmed (passenger cash confirmation, or a payment webhook),
      // not just because the ride finished.
      await this.prisma.payment.create({
        data: {
          tripId,
          amount: trip.fare ?? 0,
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
        `Your trip is complete. Fare: ${trip.fare} ${trip.currency}.`,
      );
      this.emailService.sendTripReceipt(
        trip.passenger.email,
        trip.fare ?? 0,
        trip.currency,
        tripId,
      );
    }

    const updated = this.decryptTripPhones(
      await this.prisma.trip.findUniqueOrThrow({
        where: { id: tripId },
        include: {
          driver: { include: { vehicle: true, user: { omit: { passwordHash: true } } } },
          passenger: { omit: { passwordHash: true } },
          payment: true,
        },
      }),
    );

    const event =
      dto.status === TripStatus.CANCELLED
        ? SOCKET_EVENTS.TRIP_CANCELLED
        : SOCKET_EVENTS.TRIP_STATUS_UPDATED;
    this.gateway.emitToTrip(tripId, event, updated);
    this.gateway.emitToUser(trip.passengerId, event, updated);

    return updated;
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
        ? { ...trip.driver, user: trip.driver.user ? decryptUserPhone(trip.driver.user) : trip.driver.user }
        : trip.driver,
      passenger: trip.passenger ? decryptUserPhone(trip.passenger) : trip.passenger,
    };
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
      data: { tripId, fromUserId: raterId, toUserId, stars: dto.stars, comment: dto.comment },
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
      include: {
        driver: { include: { vehicle: true, user: { omit: { passwordHash: true } } } },
        passenger: { omit: { passwordHash: true } },
        payment: true,
      },
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
