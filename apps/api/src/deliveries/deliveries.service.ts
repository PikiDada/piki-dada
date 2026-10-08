import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryStatus,
  PaymentStatus,
  Prisma,
  RideType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_STOPS, PricingService } from '../trips/pricing.service';
import { TripsGateway } from '../trips/trips.gateway';
import { SOCKET_EVENTS } from '../trips/socket-events';
import { RequestDeliveryDto } from './dto/request-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { ReplaceDeliveryStopsDto } from './dto/delivery-stop-input.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { decryptUserPhone } from '../common/field-encryption';
import { MapsPlatformService } from '../maps-platform/maps-platform.service';
import { applyCoupon, CouponsService } from '../coupons/coupons.service';
import { measureActualRoute } from '../trips/actual-route';

// Deliveries always match BODA-vehicle riders -- there's no rideType choice in the delivery
// request itself, unlike ride booking.
const SEARCH_RADIUS_KM = 6;

const STOP_EDITABLE_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.SEARCHING,
  DeliveryStatus.ACCEPTED,
  DeliveryStatus.ARRIVED_PICKUP,
  DeliveryStatus.PICKED_UP,
];

// Same tie-break as trips.service.ts's ORDERED_STOPS -- see its comment.
const ORDERED_STOPS = {
  orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
} satisfies Prisma.Delivery$stopsArgs;

const DELIVERY_DETAIL_INCLUDE = {
  rider: {
    include: { vehicle: true, user: { omit: { passwordHash: true } } },
  },
  sender: { omit: { passwordHash: true } },
  payment: true,
  category: true,
  stops: ORDERED_STOPS,
} satisfies Prisma.DeliveryInclude;

@Injectable()
export class DeliveriesService {
  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private gateway: TripsGateway,
    private notifications: NotificationsService,
    private maps: MapsPlatformService,
    private coupons: CouponsService,
  ) {}

  async requestDelivery(senderId: string, dto: RequestDeliveryDto) {
    const pickup = { lat: dto.pickupLat, lng: dto.pickupLng };
    const destination = { lat: dto.destinationLat, lng: dto.destinationLng };
    const stops = dto.stops ?? [];
    const estimate = await this.pricing.estimateDeliveryFare(
      dto.sizeTierId,
      { isFragile: dto.isFragile ?? false, isLiquid: dto.isLiquid ?? false },
      pickup,
      destination,
      stops,
    );

    // The delivery and the coupon claim succeed or fail together; see TripsService.requestTrip.
    const { fareRoundingUnit } = await this.pricing.settings();
    const delivery = await this.prisma.$transaction(async (tx) => {
      const created = await tx.delivery.create({
        include: { stops: ORDERED_STOPS },
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
          routeSource: estimate.routeSource,
          mapsDistanceKm: estimate.mapsDistanceKm,
          mapsDurationMin: estimate.mapsDurationMin,
          fare: estimate.fare,
          currency: estimate.currency,
          paymentMethod: dto.paymentMethod,
          waitingPerMinute: estimate.waitingPerMinute,
          freeWaitMinutes: estimate.freeWaitMinutes,
          stops: {
            create: stops.map((s, i) => ({
              sequence: i,
              address: s.address,
              lat: s.lat,
              lng: s.lng,
              contactName: s.contactName,
              contactPhone: s.contactPhone,
            })),
          },
        },
      });
      if (!dto.couponCode) return created;
      const coupon = await this.coupons.redeem(tx, senderId, dto.couponCode, {
        deliveryId: created.id,
      });
      const { fare, discount } = applyCoupon(
        coupon,
        estimate.fare,
        fareRoundingUnit,
      );
      return tx.delivery.update({
        where: { id: created.id },
        data: { fare, discount, couponCode: coupon.code },
        include: { stops: ORDERED_STOPS },
      });
    });

    this.maps.recordPlaces([
      { label: dto.pickupAddress, ...pickup },
      ...stops.map((s) => ({ label: s.address, lat: s.lat, lng: s.lng })),
      { label: dto.destinationAddress, ...destination },
    ]);

    const [nearbyRiders, { averageSpeedKmh }] = await Promise.all([
      this.pricing.findNearbyDrivers(RideType.BODA, pickup, SEARCH_RADIUS_KM),
      this.pricing.settings(),
    ]);
    for (const rider of nearbyRiders) {
      this.gateway.emitToUser(rider.userId, SOCKET_EVENTS.DELIVERY_REQUESTED, {
        deliveryId: delivery.id,
        pickupAddress: delivery.pickupAddress,
        destinationAddress: delivery.destinationAddress,
        itemDescription: delivery.itemDescription,
        fare: delivery.fare,
        stopCount: delivery.stops.length,
        distanceToPickupKm: Number(rider.distanceKm.toFixed(2)),
        etaToPickupMin: this.pricing.etaMinutesForDistance(
          rider.distanceKm,
          averageSpeedKmh,
        ),
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

    const updated = await this.loadDelivery(deliveryId);

    this.gateway.emitToUser(
      updated.senderId,
      SOCKET_EVENTS.DELIVERY_ACCEPTED,
      updated,
    );
    void this.notifications.notifyUser(
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
      include: { rider: true, sender: true, stops: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');

    const isSender = delivery.senderId === userId;
    const isRider = delivery.rider?.userId === userId;
    if (!isSender && !isRider) {
      throw new ForbiddenException('Not part of this delivery');
    }
    // Unlike a ride, skipping a drop-off leaves someone's item undelivered.
    if (
      dto.status === DeliveryStatus.ARRIVED_DROPOFF &&
      delivery.stops.some((s) => !s.departedAt)
    ) {
      throw new BadRequestException(
        'Complete every drop-off before the final one',
      );
    }

    const timestampField = this.timestampFieldFor(dto.status);
    const now = new Date();
    await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: dto.status,
        cancellationReason: dto.cancellationReason,
        ...(timestampField ? { [timestampField]: now } : {}),
        // See TripsService.updateStatus's matching comment -- only a sender cancelling their
        // own request counts toward the admin over-cancellation flag.
        ...(dto.status === DeliveryStatus.CANCELLED
          ? { cancelledByUserId: userId }
          : {}),
      },
    });

    if (dto.status === DeliveryStatus.CANCELLED) {
      await this.coupons.release({ deliveryId });
    }

    if (dto.status === DeliveryStatus.DELIVERED) {
      const finalFare =
        delivery.status === DeliveryStatus.DELIVERED
          ? (delivery.fare ?? 0)
          : await this.finalizeFare(delivery, now);
      await this.recordActualRoute(delivery, now);

      // Payment always starts PENDING, even for CASH — see TripsService.updateStatus's
      // matching comment for why.
      await this.prisma.deliveryPayment.create({
        data: {
          deliveryId,
          amount: finalFare,
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
      void this.notifications.notifyUser(
        delivery.senderId,
        'Delivery completed',
        `Your delivery is complete. Fare: ${finalFare} ${delivery.currency}.`,
      );
    }

    const updated = await this.loadDelivery(deliveryId);
    this.broadcast(
      updated,
      dto.status === DeliveryStatus.CANCELLED
        ? SOCKET_EVENTS.DELIVERY_CANCELLED
        : SOCKET_EVENTS.DELIVERY_STATUS_UPDATED,
    );
    return updated;
  }

  // Same as TripsService.recordActualRoute, over the part the sender pays for: from pickup to
  // arriving at the final drop-off (not the handover there). Every drop-off stop has been
  // departed by then, so the loaded stops are final.
  private async recordActualRoute(
    delivery: Prisma.DeliveryGetPayload<{ include: { stops: true } }>,
    deliveredAt: Date,
  ) {
    const pings = await this.prisma.deliveryLocationPing.findMany({
      where: { deliveryId: delivery.id, billed: true },
      orderBy: { recordedAt: 'asc' },
    });
    const actual = measureActualRoute(
      pings,
      delivery.pickedUpAt,
      delivery.arrivedDropoffAt ?? deliveredAt,
      delivery.stops,
    );
    if (actual.actualDistanceKm === null && actual.actualDurationMin === null) {
      return;
    }
    await this.prisma.delivery.update({
      where: { id: delivery.id },
      data: actual,
    });
  }

  // Same as TripsService.finalizeFare, minus the skipped-stops step: a delivery can't reach
  // its final drop-off with any drop-off left (see updateStatus), so none are ever skipped.
  private async finalizeFare(
    delivery: Prisma.DeliveryGetPayload<object>,
    deliveredAt: Date,
  ): Promise<number> {
    await this.prisma.deliveryStop.updateMany({
      where: {
        deliveryId: delivery.id,
        arrivedAt: { not: null },
        departedAt: null,
      },
      data: { departedAt: deliveredAt },
    });
    const stops = await this.prisma.deliveryStop.findMany({
      where: { deliveryId: delivery.id },
    });
    const waitingFee = await this.pricing.waitingFee(delivery, stops);
    const quotedFare = delivery.fare ?? 0;
    if (waitingFee === 0) return quotedFare;

    const finalFare = quotedFare + waitingFee;
    await this.prisma.delivery.update({
      where: { id: delivery.id },
      data: { waitingFee, fare: finalFare },
    });
    return finalFare;
  }

  // What the booking page shows for the chosen size tier, before the delivery exists.
  waitingPolicy(sizeTierId: string) {
    return this.pricing.deliveryWaitingPolicy(sizeTierId);
  }

  async previewStops(
    senderId: string,
    deliveryId: string,
    dto: ReplaceDeliveryStopsDto,
  ) {
    const { delivery, lockedStops } = await this.editableDelivery(
      senderId,
      deliveryId,
      dto,
    );
    const estimate = await this.estimateWithStops(delivery, [
      ...lockedStops,
      ...dto.stops,
    ]);
    const { fare } = await this.withCoupon(deliveryId, estimate.fare);
    return { ...estimate, fare, previousFare: delivery.fare };
  }

  async replaceStops(
    senderId: string,
    deliveryId: string,
    dto: ReplaceDeliveryStopsDto,
  ) {
    const { delivery, lockedStops } = await this.editableDelivery(
      senderId,
      deliveryId,
      dto,
    );
    const estimate = await this.estimateWithStops(delivery, [
      ...lockedStops,
      ...dto.stops,
    ]);
    const priced = await this.withCoupon(deliveryId, estimate.fare);

    await this.prisma.$transaction([
      this.prisma.deliveryStop.deleteMany({
        where: { deliveryId, arrivedAt: null },
      }),
      this.prisma.deliveryStop.createMany({
        data: dto.stops.map((s, i) => ({
          deliveryId,
          sequence: lockedStops.length + i,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          contactName: s.contactName,
          contactPhone: s.contactPhone,
        })),
      }),
      this.prisma.delivery.update({
        where: { id: deliveryId },
        data: {
          fare: priced.fare,
          discount: priced.discount,
          distanceKm: estimate.distanceKm,
          durationMin: estimate.durationMin,
          routeSource: estimate.routeSource,
          mapsDistanceKm: estimate.mapsDistanceKm,
          mapsDurationMin: estimate.mapsDurationMin,
        },
      }),
    ]);

    this.maps.recordPlaces(
      dto.stops.map((s) => ({ label: s.address, lat: s.lat, lng: s.lng })),
    );

    const updated = await this.loadDelivery(deliveryId);
    this.broadcast(updated, SOCKET_EVENTS.DELIVERY_STATUS_UPDATED);
    if (updated.rider) {
      void this.notifications.notifyUser(
        updated.rider.userId,
        'Drop-offs changed',
        `The sender updated their drop-offs. New fare: ${priced.fare} ${estimate.currency}.`,
      );
    }
    return updated;
  }

  // Same as TripsService.withCoupon.
  private async withCoupon(deliveryId: string, baseFare: number) {
    const coupon = await this.coupons.couponFor({ deliveryId });
    if (!coupon) return { fare: baseFare, discount: 0 };
    const { fareRoundingUnit } = await this.pricing.settings();
    return applyCoupon(coupon, baseFare, fareRoundingUnit);
  }

  private estimateWithStops(
    delivery: Prisma.DeliveryGetPayload<object>,
    stops: { lat: number; lng: number }[],
  ) {
    if (!delivery.sizeTierId) {
      throw new BadRequestException(
        'This delivery has no size tier to price it with',
      );
    }
    return this.pricing.estimateDeliveryFare(
      delivery.sizeTierId,
      { isFragile: delivery.isFragile, isLiquid: delivery.isLiquid },
      { lat: delivery.pickupLat, lng: delivery.pickupLng },
      { lat: delivery.destinationLat, lng: delivery.destinationLng },
      stops,
    );
  }

  private async editableDelivery(
    senderId: string,
    deliveryId: string,
    dto: ReplaceDeliveryStopsDto,
  ) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { stops: ORDERED_STOPS },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.senderId !== senderId) {
      throw new ForbiddenException('Not your delivery');
    }
    if (!STOP_EDITABLE_STATUSES.includes(delivery.status)) {
      throw new BadRequestException(
        'Drop-offs can no longer be changed on this delivery',
      );
    }
    const lockedStops = delivery.stops.filter((s) => s.arrivedAt);
    if (lockedStops.length + dto.stops.length > MAX_STOPS) {
      throw new BadRequestException(
        `A delivery can have at most ${MAX_STOPS} extra drop-offs`,
      );
    }
    return { delivery, lockedStops };
  }

  // Extra drop-offs are visited in order, after pickup (PICKED_UP) and before the final one.
  async arriveAtStop(riderUserId: string, deliveryId: string, stopId: string) {
    const delivery = await this.pickedUpDeliveryForRider(
      riderUserId,
      deliveryId,
    );
    const next = delivery.stops.find((s) => !s.arrivedAt);
    if (!next || next.id !== stopId) {
      throw new BadRequestException('That is not the next drop-off');
    }
    if (delivery.stops.some((s) => s.arrivedAt && !s.departedAt)) {
      throw new BadRequestException('Finish the current drop-off first');
    }
    await this.prisma.deliveryStop.update({
      where: { id: stopId },
      data: { arrivedAt: new Date() },
    });
    const updated = await this.loadDelivery(deliveryId);
    this.broadcast(updated, SOCKET_EVENTS.DELIVERY_STATUS_UPDATED);
    return updated;
  }

  async departStop(riderUserId: string, deliveryId: string, stopId: string) {
    const delivery = await this.pickedUpDeliveryForRider(
      riderUserId,
      deliveryId,
    );
    const stop = delivery.stops.find((s) => s.id === stopId);
    if (!stop?.arrivedAt || stop.departedAt) {
      throw new BadRequestException('You are not at that drop-off');
    }
    await this.prisma.deliveryStop.update({
      where: { id: stopId },
      data: { departedAt: new Date() },
    });
    const updated = await this.loadDelivery(deliveryId);
    this.broadcast(updated, SOCKET_EVENTS.DELIVERY_STATUS_UPDATED);
    return updated;
  }

  private async pickedUpDeliveryForRider(
    riderUserId: string,
    deliveryId: string,
  ) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { rider: true, stops: ORDERED_STOPS },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.rider?.userId !== riderUserId) {
      throw new ForbiddenException('Not your delivery');
    }
    if (delivery.status !== DeliveryStatus.PICKED_UP) {
      throw new BadRequestException(
        'Pick up the item before visiting drop-offs',
      );
    }
    return delivery;
  }

  private async loadDelivery(deliveryId: string) {
    return this.decryptDeliveryPhones(
      await this.prisma.delivery.findUniqueOrThrow({
        where: { id: deliveryId },
        include: DELIVERY_DETAIL_INCLUDE,
      }),
    );
  }

  private broadcast(
    delivery: Awaited<ReturnType<DeliveriesService['loadDelivery']>>,
    event: string,
  ) {
    this.gateway.emitToDelivery(delivery.id, event, delivery);
    this.gateway.emitToUser(delivery.senderId, event, delivery);
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
      include: DELIVERY_DETAIL_INCLUDE,
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
