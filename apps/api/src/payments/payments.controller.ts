import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { DeliveryPaymentsService } from './delivery-payments.service';
import { StripeService } from './stripe.service';
import { FlutterwaveService } from './flutterwave.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private paymentsService: PaymentsService,
    private deliveryPaymentsService: DeliveryPaymentsService,
    private stripeService: StripeService,
    private flutterwaveService: FlutterwaveService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PASSENGER)
  @Post(':tripId/stripe/checkout')
  createStripeCheckout(
    @CurrentUser() user: { id: string },
    @Param('tripId') tripId: string,
  ) {
    return this.paymentsService.createStripeCheckout(tripId, user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PASSENGER)
  @Post(':tripId/flutterwave/checkout')
  createFlutterwaveCheckout(
    @CurrentUser() user: { id: string },
    @Param('tripId') tripId: string,
  ) {
    return this.paymentsService.createFlutterwaveCheckout(tripId, user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PASSENGER)
  @Post(':tripId/cash/confirm')
  confirmCashPayment(
    @CurrentUser() user: { id: string },
    @Param('tripId') tripId: string,
  ) {
    return this.paymentsService.confirmCashPayment(tripId, user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PASSENGER)
  @Post('delivery/:deliveryId/stripe/checkout')
  createDeliveryStripeCheckout(
    @CurrentUser() user: { id: string },
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.deliveryPaymentsService.createStripeCheckout(
      deliveryId,
      user.id,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PASSENGER)
  @Post('delivery/:deliveryId/flutterwave/checkout')
  createDeliveryFlutterwaveCheckout(
    @CurrentUser() user: { id: string },
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.deliveryPaymentsService.createFlutterwaveCheckout(
      deliveryId,
      user.id,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PASSENGER)
  @Post('delivery/:deliveryId/cash/confirm')
  confirmDeliveryCashPayment(
    @CurrentUser() user: { id: string },
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.deliveryPaymentsService.confirmCashPayment(deliveryId, user.id);
  }

  @SkipThrottle()
  @Post('webhooks/stripe')
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    const event = this.stripeService.constructWebhookEvent(
      req.rawBody!,
      signature,
    );
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as {
        metadata?: { referenceId?: string; kind?: 'trip' | 'delivery' };
        id: string;
      };
      const { referenceId, kind } = session.metadata ?? {};
      if (referenceId && kind === 'delivery') {
        await this.deliveryPaymentsService.markPaid(referenceId, session.id);
      } else if (referenceId) {
        await this.paymentsService.markTripPaid(referenceId, session.id);
      }
    }
    return { received: true };
  }

  @SkipThrottle()
  @Post('webhooks/flutterwave')
  async flutterwaveWebhook(
    @Body()
    body: {
      data?: {
        id: string;
        meta?: { referenceId?: string; kind?: 'trip' | 'delivery' };
        status?: string;
      };
    },
    @Headers('verif-hash') signature: string,
  ) {
    if (!this.flutterwaveService.verifyWebhookSignature(signature)) {
      throw new BadRequestException('Invalid signature');
    }
    const { referenceId, kind } = body.data?.meta ?? {};
    if (referenceId && body.data?.status === 'successful') {
      if (kind === 'delivery') {
        await this.deliveryPaymentsService.markPaid(
          referenceId,
          String(body.data.id),
        );
      } else {
        await this.paymentsService.markTripPaid(
          referenceId,
          String(body.data.id),
        );
      }
    }
    return { received: true };
  }
}
