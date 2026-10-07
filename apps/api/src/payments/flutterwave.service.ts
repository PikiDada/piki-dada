import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class FlutterwaveService {
  constructor(private config: ConfigService) {}

  // `kind` distinguishes a trip from a delivery in the webhook -- see the matching comment on
  // StripeService.createCheckoutSession.
  async initializePayment(params: {
    referenceId: string;
    kind: 'trip' | 'delivery';
    amount: number;
    currency: string;
    customerEmail: string;
    redirectUrl: string;
  }) {
    const res = await axios.post<{ data: { link: string } }>(
      'https://api.flutterwave.com/v3/payments',
      {
        tx_ref: `${params.kind}-${params.referenceId}-${Date.now()}`,
        amount: params.amount,
        currency: params.currency,
        redirect_url: params.redirectUrl,
        customer: { email: params.customerEmail },
        meta: { referenceId: params.referenceId, kind: params.kind },
      },
      {
        headers: {
          Authorization: `Bearer ${this.config.getOrThrow<string>('FLUTTERWAVE_SECRET_KEY')}`,
        },
      },
    );
    return res.data.data.link;
  }

  verifyWebhookSignature(signatureHeader: string | undefined) {
    const expected = this.config.getOrThrow<string>('FLUTTERWAVE_SECRET_HASH');
    return signatureHeader === expected;
  }

  async verifyTransaction(transactionId: string) {
    const res = await axios.get<{ data: unknown }>(
      `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
      {
        headers: {
          Authorization: `Bearer ${this.config.getOrThrow<string>('FLUTTERWAVE_SECRET_KEY')}`,
        },
      },
    );
    return res.data.data;
  }
}
