import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';
import { FlutterwaveService } from './flutterwave.service';

// Mirrors PaymentsService's trip methods exactly, adapted to Delivery/DeliveryPayment. Kept as
// a separate service rather than generalizing PaymentsService itself, so the existing,
// real-money trip-payment code path is never touched by this addition. The one genuinely
// shared piece -- commission math and wallet-ledger writes -- is reused via
// PaymentsService.creditDriverEarnings rather than duplicated.
@Injectable()
export class DeliveryPaymentsService {
  constructor(
    private prisma: PrismaService,
    private paymentsService: PaymentsService,
    private stripeService: StripeService,
    private flutterwaveService: FlutterwaveService,
    private config: ConfigService,
  ) {}

  private async getPayableDelivery(deliveryId: string, senderId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { payment: true, sender: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.senderId !== senderId)
      throw new BadRequestException('Not your delivery');
    if (!delivery.payment || delivery.payment.status === PaymentStatus.PAID) {
      throw new BadRequestException('Delivery has no pending payment');
    }
    return delivery;
  }

  async createStripeCheckout(deliveryId: string, senderId: string) {
    const delivery = await this.getPayableDelivery(deliveryId, senderId);
    const webUrl = this.config.getOrThrow<string>('CORS_ORIGIN');
    const url = await this.stripeService.createCheckoutSession({
      referenceId: deliveryId,
      kind: 'delivery',
      amount: delivery.payment!.amount,
      currency: delivery.payment!.currency,
      successUrl: `${webUrl}/passenger/delivery/${deliveryId}?paid=1`,
      cancelUrl: `${webUrl}/passenger/delivery/${deliveryId}`,
    });
    return { url };
  }

  async createFlutterwaveCheckout(deliveryId: string, senderId: string) {
    const delivery = await this.getPayableDelivery(deliveryId, senderId);
    const webUrl = this.config.getOrThrow<string>('CORS_ORIGIN');
    const url = await this.flutterwaveService.initializePayment({
      referenceId: deliveryId,
      kind: 'delivery',
      amount: delivery.payment!.amount,
      currency: delivery.payment!.currency,
      customerEmail: delivery.sender.email,
      redirectUrl: `${webUrl}/passenger/delivery/${deliveryId}?paid=1`,
    });
    return { url };
  }

  async markPaid(deliveryId: string, providerRef: string) {
    // Same atomic idempotency guard as PaymentsService.markTripPaid — see its comment.
    const result = await this.prisma.deliveryPayment.updateMany({
      where: { deliveryId, status: { not: PaymentStatus.PAID } },
      data: { status: PaymentStatus.PAID, providerRef },
    });
    if (result.count === 0) return;
    await this.creditRiderForDelivery(deliveryId);
  }

  async confirmCashPayment(deliveryId: string, senderId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { payment: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.senderId !== senderId)
      throw new BadRequestException('Not your delivery');
    if (delivery.paymentMethod !== PaymentMethod.CASH) {
      throw new BadRequestException('Delivery is not a cash payment');
    }
    if (!delivery.payment) {
      throw new BadRequestException('Delivery has no pending cash payment');
    }

    const result = await this.prisma.deliveryPayment.updateMany({
      where: { deliveryId, status: { not: PaymentStatus.PAID } },
      data: { status: PaymentStatus.PAID },
    });
    if (result.count === 0) {
      throw new BadRequestException('Delivery has no pending cash payment');
    }
    await this.creditRiderForDelivery(deliveryId);
    return { success: true };
  }

  private async creditRiderForDelivery(deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { rider: true },
    });
    if (!delivery?.riderId || !delivery.rider) return;
    await this.paymentsService.creditDriverEarnings(
      delivery.rider.userId,
      delivery.fare ?? 0,
      delivery.paymentMethod,
      `Delivery ${deliveryId}`,
    );
  }
}
