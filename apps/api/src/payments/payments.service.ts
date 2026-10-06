import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingSettingsService } from '../pricing-settings/pricing-settings.service';
import { StripeService } from './stripe.service';
import { FlutterwaveService } from './flutterwave.service';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private stripeService: StripeService,
    private flutterwaveService: FlutterwaveService,
    private config: ConfigService,
    private pricingSettings: PricingSettingsService,
  ) {}

  private async getPayableTrip(tripId: string, passengerId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { payment: true, passenger: true },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.passengerId !== passengerId)
      throw new BadRequestException('Not your trip');
    if (!trip.payment || trip.payment.status === PaymentStatus.PAID) {
      throw new BadRequestException('Trip has no pending payment');
    }
    return trip;
  }

  async createStripeCheckout(tripId: string, passengerId: string) {
    const trip = await this.getPayableTrip(tripId, passengerId);
    const webUrl = this.config.getOrThrow<string>('CORS_ORIGIN');
    const url = await this.stripeService.createCheckoutSession({
      referenceId: tripId,
      kind: 'trip',
      amount: trip.payment!.amount,
      currency: trip.payment!.currency,
      successUrl: `${webUrl}/passenger/trip?id=${tripId}&paid=1`,
      cancelUrl: `${webUrl}/passenger/trip?id=${tripId}`,
    });
    return { url };
  }

  async createFlutterwaveCheckout(tripId: string, passengerId: string) {
    const trip = await this.getPayableTrip(tripId, passengerId);
    const webUrl = this.config.getOrThrow<string>('CORS_ORIGIN');
    const url = await this.flutterwaveService.initializePayment({
      referenceId: tripId,
      kind: 'trip',
      amount: trip.payment!.amount,
      currency: trip.payment!.currency,
      customerEmail: trip.passenger.email,
      redirectUrl: `${webUrl}/passenger/trip?id=${tripId}&paid=1`,
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
    if (trip.passengerId !== passengerId)
      throw new BadRequestException('Not your trip');
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
    await this.creditDriverEarnings(
      trip.driver.userId,
      trip.fare ?? 0,
      trip.paymentMethod,
      `Trip ${tripId}`,
    );
  }

  // Shared by trip and delivery payment flows (same commission rate either way) — pure math
  // plus a wallet-ledger write, safe to share unlike the payment call sites around it, which
  // stay deliberately duplicated per delivery/trip to avoid touching this real-money code path
  // for the sake of reuse. `referenceLabel` becomes the ledger entry's human-readable reason,
  // e.g. "Trip abc123" or "Delivery xyz789".
  async creditDriverEarnings(
    userId: string,
    fare: number,
    paymentMethod: PaymentMethod,
    referenceLabel: string,
  ) {
    // The rate in force when the payment is confirmed (admin-set in /admin/pricing).
    const { platformCommissionRate } = await this.pricingSettings.get();
    const commission = Math.round(fare * platformCommissionRate);

    if (paymentMethod === PaymentMethod.CASH) {
      // Cash trips/deliveries: the rider already collected the full fare directly from the
      // customer, so the platform never held any of this money -- crediting 85% on top would
      // pay the rider twice. What's actually owed runs the other way: the rider owes the
      // platform its commission. Record that as a debit rather than paying out money that was
      // never collected.
      await this.prisma.wallet.update({
        where: { userId },
        data: {
          balance: { decrement: commission },
          ledgerEntries: {
            create: {
              amount: -commission,
              reason: `${referenceLabel} commission owed (cash)`,
            },
          },
        },
      });
      return;
    }

    const driverEarnings = fare - commission;
    await this.prisma.wallet.update({
      where: { userId },
      data: {
        balance: { increment: driverEarnings },
        ledgerEntries: {
          create: {
            amount: driverEarnings,
            reason: `${referenceLabel} earnings`,
          },
        },
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
    if (wallet.balance < amount)
      throw new BadRequestException('Insufficient balance');

    return this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: amount },
        ledgerEntries: { create: { amount: -amount, reason: 'Withdrawal' } },
      },
    });
  }
}
