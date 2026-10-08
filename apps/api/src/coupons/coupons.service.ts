import { BadRequestException, Injectable } from '@nestjs/common';
import { Coupon, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;
export type CouponRef = { tripId: string } | { deliveryId: string };

export function normalizeCouponCode(code: string) {
  return code.trim().toUpperCase();
}

// The fare after the coupon. Rounded DOWN to the fare unit, so a coupon always takes off at
// least what it says; never below zero.
export function applyCoupon(
  coupon: Pick<Coupon, 'discountAmount' | 'discountPercent'>,
  baseFare: number,
  roundingUnit: number,
): { fare: number; discount: number } {
  const off = coupon.discountPercent
    ? (baseFare * coupon.discountPercent) / 100
    : (coupon.discountAmount ?? 0);
  const unit = roundingUnit > 0 ? roundingUnit : 1;
  const fare = Math.max(
    0,
    Math.floor((baseFare - Math.min(off, baseFare)) / unit) * unit,
  );
  return { fare, discount: baseFare - fare };
}

@Injectable()
export class CouponsService {
  constructor(private prisma: PrismaService) {}

  // Read-only check for the booking page's "Apply" button. Booking re-checks atomically.
  async check(userId: string, code: string) {
    const coupon = await this.findUsable(this.prisma, code);
    const used = await this.prisma.couponRedemption.findUnique({
      where: { couponId_userId: { couponId: coupon.id, userId } },
    });
    if (used)
      throw new BadRequestException('You have already used this coupon');
    return {
      code: coupon.code,
      discountAmount: coupon.discountAmount,
      discountPercent: coupon.discountPercent,
    };
  }

  // Claims one use of the coupon for this booking, inside the booking's own transaction so
  // the booking and the claim succeed or fail together. The usage limit is enforced by a
  // single conditional UPDATE and "once per passenger" by a unique index, so two bookings in
  // flight at the same moment can't both slip through.
  async redeem(tx: Tx, userId: string, code: string, ref: CouponRef) {
    const coupon = await this.findUsable(tx, code);
    const claimed = await tx.$executeRaw`
      UPDATE "Coupon" SET "usedCount" = "usedCount" + 1
      WHERE id = ${coupon.id} AND "isActive"
        AND ("maxUses" IS NULL OR "usedCount" < "maxUses")
        AND ("expiresAt" IS NULL OR "expiresAt" > now())`;
    if (claimed === 0) {
      throw new BadRequestException('This coupon is no longer available');
    }
    try {
      await tx.couponRedemption.create({
        data: { couponId: coupon.id, userId, ...ref },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException('You have already used this coupon');
      }
      throw err;
    }
    return coupon;
  }

  // A cancelled booking gives its coupon back, both the passenger's one use and a place
  // under the coupon's limit.
  async release(ref: CouponRef) {
    const redemption = await this.prisma.couponRedemption.findFirst({
      where: ref,
    });
    if (!redemption) return;
    await this.prisma.$transaction([
      this.prisma.couponRedemption.delete({ where: { id: redemption.id } }),
      this.prisma.coupon.update({
        where: { id: redemption.couponId },
        data: { usedCount: { decrement: 1 } },
      }),
    ]);
  }

  // The coupon a booking was made with, for re-pricing (edited or skipped stops). Honoured
  // even if it has since expired or been switched off: the passenger booked with it.
  async couponFor(ref: CouponRef) {
    const redemption = await this.prisma.couponRedemption.findFirst({
      where: ref,
      include: { coupon: true },
    });
    return redemption?.coupon ?? null;
  }

  private async findUsable(db: Tx | PrismaService, code: string) {
    const coupon = await db.coupon.findFirst({
      where: {
        code: { equals: normalizeCouponCode(code), mode: 'insensitive' },
      },
    });
    if (!coupon || !coupon.isActive) {
      throw new BadRequestException("That coupon code isn't valid");
    }
    if (coupon.expiresAt && coupon.expiresAt <= new Date()) {
      throw new BadRequestException('This coupon has expired');
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      throw new BadRequestException('This coupon is no longer available');
    }
    return coupon;
  }
}
