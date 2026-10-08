import { PaymentMethod } from '@prisma/client';
import { PaymentsService } from './payments.service';

// Rider earnings at a 15% commission. Piki Dada funds coupons, so a rider must earn exactly
// what they would have without one.

type WalletUpdate = {
  data: {
    balance: { increment?: number; decrement?: number };
    ledgerEntries: { create: unknown };
  };
};

function setup() {
  const prisma = {
    wallet: { update: jest.fn<Promise<unknown>, [WalletUpdate]>() },
  };
  const pricingSettings = {
    get: jest
      .fn<Promise<{ platformCommissionRate: number }>, []>()
      .mockResolvedValue({ platformCommissionRate: 0.15 }),
  };
  const service = new PaymentsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    pricingSettings as never,
  );
  const balanceChange = () => {
    const b = prisma.wallet.update.mock.calls[0][0].data.balance;
    return (b.increment ?? 0) - (b.decrement ?? 0);
  };
  return { service, balanceChange };
}

describe('rider earnings', () => {
  it('cash, no coupon: the rider owes the commission', async () => {
    const { service, balanceChange } = setup();
    await service.creditDriverEarnings(
      'r1',
      10000,
      PaymentMethod.CASH,
      'Trip t1',
    );
    expect(balanceChange()).toBe(-1500);
  });

  it('cash with a coupon: Piki Dada pays the rider the discount', async () => {
    const { service, balanceChange } = setup();
    // Full fare 10,000; the passenger paid 8,000 cash after a 2,000 coupon.
    await service.creditDriverEarnings(
      'r1',
      8000,
      PaymentMethod.CASH,
      'Trip t1',
      2000,
    );
    // Commission on the full 10,000 (1,500 owed), plus 2,000 owed to the rider.
    expect(balanceChange()).toBe(500);
  });

  it('card with a coupon: the rider earns on the full fare', async () => {
    const { service, balanceChange } = setup();
    await service.creditDriverEarnings(
      'r1',
      8000,
      PaymentMethod.STRIPE,
      'Trip t1',
      2000,
    );
    expect(balanceChange()).toBe(8500);
  });

  it('a coupon leaves the rider exactly as well off as no coupon', async () => {
    const without = setup();
    await without.service.creditDriverEarnings(
      'r1',
      10000,
      PaymentMethod.CASH,
      'T',
    );
    const withCoupon = setup();
    await withCoupon.service.creditDriverEarnings(
      'r1',
      8000,
      PaymentMethod.CASH,
      'T',
      2000,
    );
    // Cash in hand + wallet change is the same either way.
    expect(10000 + without.balanceChange()).toBe(
      8000 + withCoupon.balanceChange(),
    );
  });
});
