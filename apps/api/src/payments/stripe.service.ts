import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private stripe: InstanceType<typeof Stripe> | null;

  constructor(private config: ConfigService) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = key ? new Stripe(key) : null;
    if (!key) {
      console.warn(
        '[StripeService] STRIPE_SECRET_KEY not configured — payments are disabled',
      );
    }
  }

  // `kind` distinguishes a trip from a delivery in the webhook, since Stripe hands back only
  // this metadata to identify what was paid for -- without it, a webhook receiving a paid
  // referenceId would have no way to know which table to look it up in.
  async createCheckoutSession(params: {
    referenceId: string;
    kind: 'trip' | 'delivery';
    amount: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
  }) {
    if (!this.stripe) {
      throw new Error(
        'Stripe is not configured. Please set STRIPE_SECRET_KEY.',
      );
    }
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: params.currency.toLowerCase(),
            product_data: {
              name: `Piki Dada ${params.kind} ${params.referenceId}`,
            },
            unit_amount: Math.round(params.amount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: { referenceId: params.referenceId, kind: params.kind },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    return session.url;
  }

  constructWebhookEvent(rawBody: Buffer, signature: string) {
    if (!this.stripe) {
      throw new Error('Stripe is not configured.');
    }
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'),
    );
  }
}
