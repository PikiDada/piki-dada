import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryStatus, PaymentStatus, RideType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../trips/pricing.service';
import { TripsGateway } from '../trips/trips.gateway';
import { SOCKET_EVENTS } from '../trips/socket-events';
import { RequestDeliveryDto } from './dto/request-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { decryptUserPhone } from '../common/field-encryption';

// Deliveries always match BODA-vehicle riders -- there's no rideType choice in the delivery
// request itself, unlike ride booking.
const SEARCH_RADIUS_KM = 6;

@Injectable()
export class DeliveriesService {
  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private gateway: TripsGateway,
    private notifications: NotificationsService,
  ) {}

  async requestDelivery(senderId: string, dto: RequestDeliveryDto) {
    const pickup = { lat: dto.pickupLat, lng: dto.pickupLng };
    const destination = { lat: dto.destinationLat, lng: dto.destinationLng };
    const estimate = await this.pricing.estimateDeliveryFare(
      dto.sizeTierId,
      { isFragile: dto.isFragile ?? false, isLiquid: dto.isLiquid ?? false },
      pickup,
      destination,
    );

    const delivery = await this.prisma.delivery.create({
      data: {
        senderId,
        categoryId: dto.categoryId,
        sizeTierId: dto.sizeTierId,
        status: DeliveryStatus.SEARCHING,
        pickupContactName: dto.pickupContactName,
        pickupContactPhone: dto.pickupContactPhone,
        pickupAddress: dto.pickupAddress,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        dropoffContactName: dto.dropoffContactName,
        dropoffContactPhone: dto.dropoffContactPhone,
        destinationAddress: dto.destinationAddress,
        destinationLat: dto.destinationLat,
        destinationLng: dto.destinationLng,
        itemDescription: dto.itemDescription,
        itemPhotoUrl: dto.itemPhotoUrl,
        isFragile: dto.isFragile ?? false,
        isLiquid: dto.isLiquid ?? false,
        cashOnDeliveryAmount: dto.cashOnDeliveryAmount,
        distanceKm: estimate.distanceKm,
        durationMin: estimate.durationMin,
        fare: estimate.fare,
        currency: estimate.currency,
        paymentMethod: dto.paymentMethod,
      },
    });

    const nearbyRiders = await this.pricing.findNearbyDrivers(
      RideType.BODA,
      pickup,
      SEARCH_RADIUS_KM,
    );
    for (const rider of nearbyRiders) {
      this.gateway.emitToUser(rider.userId, SOCKET_EVENTS.DELIVERY_REQUESTED, {
        deliveryId: delivery.id,
        pickupAddress: delivery.pickupAddress,
        destinationAddress: delivery.destinationAddress,
        itemDescription: delivery.itemDescription,
        fare: delivery.fare,
        distanceToPickupKm: Number(rider.distanceKm.toFixed(2)),
        etaToPickupMin: this.pricing.etaMinutesForDistance(rider.distanceKm),
      });
    }

    return { delivery, candidateRiderCount: nearbyRiders.length };
  }

  async acceptDelivery(riderUserId: string, deliveryId: string) {
    const rider = await this.prisma.driver.findUnique({
      where: { userId: riderUserId },
    });
    if (!rider) throw new NotFoundException('Rider not found');

    // Same atomic race-guard as TripsService.acceptTrip — see its comment.
    const result = await this.prisma.delivery.updateMany({
      where: { id: deliveryId, status: DeliveryStatus.SEARCHING },
      data: {
        status: DeliveryStatus.ACCEPTED,
        riderId: rider.id,
        acceptedAt: new Date(),
      },
    });
    if (result.count === 0) {
      throw new BadRequestException('Delivery is no longer available');
    }

    const updated = this.decryptDeliveryPhones(
      await this.prisma.delivery.findUniqueOrThrow({
        where: { id: deliveryId },
        include: {
          rider: {
            include: { vehicle: true, user: { omit: { passwordHash: true } } },
          },
        },
      }),
    );

    this.gateway.emitToUser(
      updated.senderId,
      SOCKET_EVENTS.DELIVERY_ACCEPTED,
      updated,
    );
    this.notifications.notifyUser(
      updated.senderId,
      'Rider on the way',
      `${updated.rider?.user?.name ?? 'Your rider'} accepted your delivery request.`,
    );
    return updated;
  }

  rejectDelivery(riderUserId: string, deliveryId: string) {
    this.gateway.emitToUser(riderUserId, SOCKET_EVENTS.DELIVERY_REJECTED, {
      deliveryId,
    });
    return { success: true };
  }

  async updateStatus(
    userId: string,
    deliveryId: string,
    dto: UpdateDeliveryStatusDto,
  ) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { rider: true, sender: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');

    const isSender = delivery.senderId === userId;
    const isRider = delivery.rider?.userId === userId;
    if (!isSender && !isRider) {
      throw new ForbiddenException('Not part of this delivery');
    }

    const timestampField = this.timestampFieldFor(dto.status);
    await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: dto.status,
        cancellationReason: dto.cancellationReason,
        ...(timestampField ? { [timestampField]: new Date() } : {}),
        // See TripsService.updateStatus's matching comment -- only a sender cancelling their
        // own request counts toward the admin over-cancellation flag.
        ...(dto.status === DeliveryStatus.CANCELLED
          ? { cancelledByUserId: userId }
          : {}),
      },
    });

    if (dto.status === DeliveryStatus.DELIVERED) {
      // Payment always starts PENDING, even for CASH — see TripsService.updateStatus's
      // matching comment for why.
      await this.prisma.deliveryPayment.create({
        data: {
          deliveryId,
          amount: delivery.fare ?? 0,
          currency: delivery.currency,
          method: delivery.paymentMethod,
          status: PaymentStatus.PENDING,
        },
      });
      if (delivery.riderId) {
        await this.prisma.driver.update({
          where: { id: delivery.riderId },
          data: { totalTrips: { increment: 1 } },
        });
      }
      this.notifications.notifyUser(
        delivery.senderId,
        'Delivery completed',
        `Your delivery is complete. Fare: ${delivery.fare} ${delivery.currency}.`,
      );
    }

    const updated = this.decryptDeliveryPhones(
      await this.prisma.delivery.findUniqueOrThrow({
        where: { id: deliveryId },
        include: {
          rider: {
            include: { vehicle: true, user: { omit: { passwordHash: true } } },
          },
          sender: { omit: { passwordHash: true } },
          payment: true,
        },
      }),
    );

    const event =
      dto.status === DeliveryStatus.CANCELLED
        ? SOCKET_EVENTS.DELIVERY_CANCELLED
        : SOCKET_EVENTS.DELIVERY_STATUS_UPDATED;
    this.gateway.emitToDelivery(deliveryId, event, updated);
    this.gateway.emitToUser(delivery.senderId, event, updated);

    return updated;
  }

  myDeliveries(userId: string, role: 'PASSENGER' | 'DRIVER') {
    if (role === 'DRIVER') {
      return this.prisma.delivery.findMany({
        where: { rider: { userId } },
        orderBy: { createdAt: 'desc' },
      });
    }
    return this.prisma.delivery.findMany({
      where: { senderId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDelivery(userId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: {
        rider: {
          include: { vehicle: true, user: { omit: { passwordHash: true } } },
        },
        sender: { omit: { passwordHash: true } },
        payment: true,
        category: true,
      },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    const isSender = delivery.senderId === userId;
    const isRider = delivery.rider?.userId === userId;
    if (!isSender && !isRider) {
      throw new ForbiddenException('Not part of this delivery');
    }
    return this.decryptDeliveryPhones(delivery);
  }

  listCategories() {
    return this.prisma.deliveryCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  listSizeTiers() {
    return this.prisma.deliverySizeTier.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  private decryptDeliveryPhones<
    T extends {
      rider?: { user?: { phone?: string | null } | null } | null;
      sender?: { phone?: string | null } | null;
    },
  >(delivery: T): T {
    return {
      ...delivery,
      rider: delivery.rider
        ? {
            ...delivery.rider,
            user: delivery.rider.user
              ? decryptUserPhone(delivery.rider.user)
              : delivery.rider.user,
          }
        : delivery.rider,
      sender: delivery.sender
        ? decryptUserPhone(delivery.sender)
        : delivery.sender,
    };
  }

  private timestampFieldFor(status: DeliveryStatus): string | null {
    switch (status) {
      case DeliveryStatus.ARRIVED_PICKUP:
        return 'arrivedPickupAt';
      case DeliveryStatus.PICKED_UP:
        return 'pickedUpAt';
      case DeliveryStatus.ARRIVED_DROPOFF:
        return 'arrivedDropoffAt';
      case DeliveryStatus.DELIVERED:
        return 'deliveredAt';
      case DeliveryStatus.CANCELLED:
        return 'cancelledAt';
      default:
        return null;
    }
  }
}
