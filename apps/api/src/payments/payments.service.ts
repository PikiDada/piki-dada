import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PLATFORM_COMMISSION_RATE } from '../trips/trips.service';
import { StripeService } from './stripe.service';
import { FlutterwaveService } from './flutterwave.service';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private stripeService: StripeService,
    private flutterwaveService: FlutterwaveService,
    private config: ConfigService,
  ) {}

  private async getPayableTrip(tripId: string, passengerId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { payment: true, passenger: true },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.passengerId !== passengerId) throw new BadRequestException('Not your trip');
    if (!trip.payment || trip.payment.status === PaymentStatus.PAID) {
      throw new BadRequestException('Trip has no pending payment');
    }
    return trip;
  }

  async createStripeCheckout(tripId: string, passengerId: string) {
    const trip = await this.getPayableTrip(tripId, passengerId);
    const webUrl = this.config.getOrThrow<string>('CORS_ORIGIN');
    const url = await this.stripeService.createCheckoutSession({
      tripId,
      amount: trip.payment!.amount,
      currency: trip.payment!.currency,
      successUrl: `${webUrl}/passenger/trip/${tripId}?paid=1`,
      cancelUrl: `${webUrl}/passenger/trip/${tripId}`,
    });
    return { url };
  }

  async createFlutterwaveCheckout(tripId: string, passengerId: string) {
    const trip = await this.getPayableTrip(tripId, passengerId);
    const webUrl = this.config.getOrThrow<string>('CORS_ORIGIN');
    const url = await this.flutterwaveService.initializePayment({
      tripId,
      amount: trip.payment!.amount,
      currency: trip.payment!.currency,
      customerEmail: trip.passenger.email,
      redirectUrl: `${webUrl}/passenger/trip/${tripId}?paid=1`,
    });
    return { url };
  }

  async markTripPaid(tripId: string, providerRef: string) {
    // Atomic idempotency guard: webhook retries are common in production, and can arrive
    // concurrently, so a read-then-write check has a race window that double-credits the
    // driver. The status filter in the WHERE clause makes only the first concurrent call win,
    // the same pattern used for the trip-acceptance race fix.
    const result = await this.prisma.payment.updateMany({
      where: { tripId, status: { not: PaymentStatus.PAID } },
      data: { status: PaymentStatus.PAID, providerRef },
    });
    if (result.count === 0) return;
    await this.creditDriverForTrip(tripId);
  }

  async confirmCashPayment(tripId: string, passengerId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { payment: true },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.passengerId !== passengerId) throw new BadRequestException('Not your trip');
    if (trip.paymentMethod !== PaymentMethod.CASH) {
      throw new BadRequestException('Trip is not a cash payment');
    }
    if (!trip.payment) {
      throw new BadRequestException('Trip has no pending cash payment');
    }

    // Same atomic guard as markTripPaid — a double-tap or duplicate request must not be able
    // to both pass the pending check and double-credit the driver wallet.
    const result = await this.prisma.payment.updateMany({
      where: { tripId, status: { not: PaymentStatus.PAID } },
      data: { status: PaymentStatus.PAID },
    });
    if (result.count === 0) {
      throw new BadRequestException('Trip has no pending cash payment');
    }
    await this.creditDriverForTrip(tripId);
    return { success: true };
  }

  private async creditDriverForTrip(tripId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { driver: true },
    });
    if (!trip?.driverId || !trip.driver) return;

    const fare = trip.fare ?? 0;
    const commission = Math.round(fare * PLATFORM_COMMISSION_RATE);

    if (trip.paymentMethod === PaymentMethod.CASH) {
      // Cash trips: the rider already collected the full fare directly from the
      // passenger, so the platform never held any of this money -- crediting 85%
      // on top would pay the rider twice. What's actually owed runs the other
      // way: the rider owes the platform its commission. Record that as a debit
      // rather than paying out money that was never collected.
      await this.prisma.wallet.update({
        where: { userId: trip.driver.userId },
        data: {
          balance: { decrement: commission },
          ledgerEntries: {
            create: { amount: -commission, reason: `Trip ${tripId} commission owed (cash)` },
          },
        },
      });
      return;
    }

    const driverEarnings = fare - commission;
    await this.prisma.wallet.update({
      where: { userId: trip.driver.userId },
      data: {
        balance: { increment: driverEarnings },
        ledgerEntries: { create: { amount: driverEarnings, reason: `Trip ${tripId} earnings` } },
      },
    });
  }

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      include: { ledgerEntries: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async withdraw(userId: string, amount: number) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.balance < amount) throw new BadRequestException('Insufficient balance');

    return this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: amount },
        ledgerEntries: { create: { amount: -amount, reason: 'Withdrawal' } },
      },
    });
  }
}
