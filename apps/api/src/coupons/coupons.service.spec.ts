import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { applyCoupon, CouponsService } from './coupons.service';

const percent = (p: number) => ({ discountPercent: p, discountAmount: null });
const amount = (a: number) => ({ discountPercent: null, discountAmount: a });

describe('applyCoupon', () => {
  it('takes a percentage off, rounded down to the fare unit', () => {
    // 4,500 - 10% = 4,050 -> 4,000: the passenger gets at least the 10%.
    expect(applyCoupon(percent(10), 4500, 500)).toEqual({
      fare: 4000,
      discount: 500,
    });
  });

  it('takes a fixed amount off', () => {
    expect(applyCoupon(amount(1000), 4500, 500)).toEqual({
      fare: 3500,
      discount: 1000,
    });
  });

  it('never goes below zero', () => {
    expect(applyCoupon(amount(9000), 4500, 500)).toEqual({
      fare: 0,
      discount: 4500,
    });
  });
});

type Coupon = {
  id: string;
  code: string;
  isActive: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  discountAmount: number | null;
  discountPercent: number | null;
};

const base: Coupon = {
  id: 'c1',
  code: 'WELCOME10',
  isActive: true,
  expiresAt: null,
  maxUses: null,
  usedCount: 0,
  discountAmount: null,
  discountPercent: 10,
};

function setup(
  coupon: Coupon | null,
  opts: { claimed?: number; alreadyUsed?: boolean } = {},
) {
  const tx = {
    coupon: {
      findFirst: jest
        .fn<Promise<Coupon | null>, []>()
        .mockResolvedValue(coupon),
    },
    $executeRaw: jest
      .fn<Promise<number>, []>()
      .mockResolvedValue(opts.claimed ?? 1),
    couponRedemption: {
      create: jest.fn<Promise<unknown>, []>().mockImplementation(() =>
        opts.alreadyUsed
          ? Promise.reject(
              new Prisma.PrismaClientKnownRequestError('unique', {
                code: 'P2002',
                clientVersion: 'test',
              }),
            )
          : Promise.resolve({}),
      ),
      findUnique: jest
        .fn<Promise<unknown>, []>()
        .mockResolvedValue(opts.alreadyUsed ? {} : null),
    },
  };
  const service = new CouponsService(tx as never);
  return { service, tx };
}

describe('CouponsService', () => {
  const ref = { tripId: 't1' };

  it('claims a valid coupon', async () => {
    const { service, tx } = setup(base);
    await expect(
      service.redeem(tx as never, 'u1', 'welcome10', ref),
    ).resolves.toBe(base);
    expect(tx.couponRedemption.create.mock.calls).toHaveLength(1);
  });

  it.each([
    ['unknown', null, "That coupon code isn't valid"],
    [
      'switched off',
      { ...base, isActive: false },
      "That coupon code isn't valid",
    ],
    [
      'expired',
      { ...base, expiresAt: new Date(Date.now() - 1000) },
      'This coupon has expired',
    ],
    [
      'used up',
      { ...base, maxUses: 5, usedCount: 5 },
      'This coupon is no longer available',
    ],
  ])('refuses a coupon that is %s', async (_label, coupon, message) => {
    const { service, tx } = setup(coupon);
    await expect(service.redeem(tx as never, 'u1', 'X', ref)).rejects.toThrow(
      message,
    );
  });

  it('refuses when another booking took the last use first', async () => {
    const { service, tx } = setup(
      { ...base, maxUses: 5, usedCount: 4 },
      { claimed: 0 },
    );
    await expect(service.redeem(tx as never, 'u1', 'X', ref)).rejects.toThrow(
      'This coupon is no longer available',
    );
  });

  it('allows one use per passenger', async () => {
    const { service, tx } = setup(base, { alreadyUsed: true });
    await expect(service.redeem(tx as never, 'u1', 'X', ref)).rejects.toThrow(
      'You have already used this coupon',
    );
    await expect(service.check('u1', 'X')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
