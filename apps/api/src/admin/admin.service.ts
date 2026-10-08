import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  TripStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertPricingRuleDto } from './dto/upsert-pricing-rule.dto';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { CreateDeliveryCategoryDto } from './dto/create-delivery-category.dto';
import { UpdateDeliveryCategoryDto } from './dto/update-delivery-category.dto';
import { CreateDeliverySizeTierDto } from './dto/create-delivery-size-tier.dto';
import { UpdateDeliverySizeTierDto } from './dto/update-delivery-size-tier.dto';
import { UpdateDeliverySurchargeDto } from './dto/update-delivery-surcharge.dto';
import { decryptUserPhone } from '../common/field-encryption';
import { PricingSettingsService } from '../pricing-settings/pricing-settings.service';
import { normalizeCouponCode } from '../coupons/coupons.service';

// A passenger/sender cancelling their own request is what racks up billable Google Routes API
// calls (charged at request time) for nothing -- a driver/rider backing out after accepting
// doesn't trigger a new one, so it isn't counted here. Visibility only: admin reviews and
// decides, nothing is auto-restricted.
export const OVER_CANCELLATION_WINDOW_DAYS = 7;
export const OVER_CANCELLATION_THRESHOLD = 5;

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private pricingSettings: PricingSettingsService,
  ) {}

  async getStats() {
    const [
      totalTrips,
      completedTrips,
      activeDrivers,
      totalPassengers,
      revenue,
      totalDeliveries,
      completedDeliveries,
      deliveryRevenue,
    ] = await Promise.all([
      this.prisma.trip.count(),
      this.prisma.trip.count({ where: { status: TripStatus.COMPLETED } }),
      this.prisma.driver.count({ where: { isOnline: true } }),
      this.prisma.user.count({ where: { role: UserRole.PASSENGER } }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.PAID },
        _sum: { amount: true },
      }),
      this.prisma.delivery.count(),
      this.prisma.delivery.count({
        where: { status: DeliveryStatus.DELIVERED },
      }),
      this.prisma.deliveryPayment.aggregate({
        where: { status: PaymentStatus.PAID },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalTrips,
      completedTrips,
      activeDrivers,
      totalPassengers,
      totalRevenue: revenue._sum.amount ?? 0,
      totalDeliveries,
      completedDeliveries,
      deliveryRevenue: deliveryRevenue._sum.amount ?? 0,
    };
  }

  // Commission and payout figures are estimates at the CURRENT commission rate; the exact
  // amounts charged per trip are in each rider's wallet ledger.
  async getFinanceSummary() {
    const { platformCommissionRate } = await this.pricingSettings.get();
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const paidWhere = { status: PaymentStatus.PAID } as const;

    const [
      allTimePaid,
      todayPaid,
      weekPaid,
      monthPaid,
      pending,
      byMethod,
      walletTotal,
      nonCashPaid,
      deliveryPaid,
    ] = await Promise.all([
      this.prisma.payment.aggregate({
        where: paidWhere,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: { ...paidWhere, createdAt: { gte: startOfToday } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { ...paidWhere, createdAt: { gte: startOfWeek } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { ...paidWhere, createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.PENDING },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where: paidWhere,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.wallet.aggregate({ _sum: { balance: true } }),
      // Cash trips never move money through the platform -- the rider collects the fare
      // directly and instead owes commission as a wallet debit (see creditDriverForTrip) --
      // so only non-cash trips actually get credited a payout. Commission itself is still
      // owed on every paid trip regardless of method, so it derives from the full total.
      this.prisma.payment.aggregate({
        where: { ...paidWhere, method: { not: PaymentMethod.CASH } },
        _sum: { amount: true },
      }),
      // Deliveries don't get the same today/week/month/byMethod breakdown as trips yet --
      // just an all-time total, kept separate here rather than folded into grossRevenue so
      // the existing trip-revenue figure this dashboard already reports doesn't shift meaning
      // for anyone already relying on it.
      this.prisma.deliveryPayment.aggregate({
        where: paidWhere,
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const grossRevenue = allTimePaid._sum.amount ?? 0;
    const platformCommission = Math.round(
      grossRevenue * platformCommissionRate,
    );
    const nonCashRevenue = nonCashPaid._sum.amount ?? 0;
    const riderPayouts = Math.round(
      nonCashRevenue * (1 - platformCommissionRate),
    );
    const deliveryGrossRevenue = deliveryPaid._sum.amount ?? 0;
    const deliveryCommission = Math.round(
      deliveryGrossRevenue * platformCommissionRate,
    );

    return {
      grossRevenue,
      deliveryGrossRevenue,
      deliveryCommission,
      paidDeliveryCount: deliveryPaid._count,
      platformCommission,
      riderPayouts,
      paidTripCount: allTimePaid._count,
      today: todayPaid._sum.amount ?? 0,
      thisWeek: weekPaid._sum.amount ?? 0,
      thisMonth: monthPaid._sum.amount ?? 0,
      pendingAmount: pending._sum.amount ?? 0,
      pendingCount: pending._count,
      walletBalanceHeld: walletTotal._sum.balance ?? 0,
      byMethod: byMethod.map((m) => ({
        method: m.method,
        amount: m._sum.amount ?? 0,
        count: m._count,
      })),
      currency: 'UGX',
    };
  }

  async getFinanceForRange(from: Date, to: Date) {
    const { platformCommissionRate } = await this.pricingSettings.get();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date range');
    }
    if (from > to) {
      throw new BadRequestException('"from" must be before "to"');
    }
    // "to" is a calendar date picked in a date input -- treat it as end-of-day so the
    // selected day itself is included, not cut off at midnight.
    const rangeEnd = new Date(to);
    rangeEnd.setHours(23, 59, 59, 999);

    const paidInRange = {
      status: PaymentStatus.PAID,
      createdAt: { gte: from, lte: rangeEnd },
    } as const;

    const [totals, byMethod, nonCash] = await Promise.all([
      this.prisma.payment.aggregate({
        where: paidInRange,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where: paidInRange,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: { ...paidInRange, method: { not: PaymentMethod.CASH } },
        _sum: { amount: true },
      }),
    ]);

    const grossRevenue = totals._sum.amount ?? 0;
    const platformCommission = Math.round(
      grossRevenue * platformCommissionRate,
    );
    const riderPayouts = Math.round(
      (nonCash._sum.amount ?? 0) * (1 - platformCommissionRate),
    );

    return {
      from: from.toISOString(),
      to: rangeEnd.toISOString(),
      grossRevenue,
      platformCommission,
      riderPayouts,
      paidTripCount: totals._count,
      byMethod: byMethod.map((m) => ({
        method: m.method,
        amount: m._sum.amount ?? 0,
        count: m._count,
      })),
      currency: 'UGX',
    };
  }

  async listActiveDrivers() {
    const drivers = await this.prisma.driver.findMany({
      where: { isOnline: true },
      include: {
        user: { omit: { passwordHash: true } },
        vehicle: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    return drivers.map((driver) => ({
      ...driver,
      user: decryptUserPhone(driver.user),
    }));
  }

  async listRiderWallets() {
    const drivers = await this.prisma.driver.findMany({
      include: {
        user: { include: { wallet: true }, omit: { passwordHash: true } },
      },
      // Most-owed first, so whoever needs collecting from soonest is at the top.
      orderBy: { user: { wallet: { balance: 'asc' } } },
    });
    return drivers
      .filter((driver) => driver.user.wallet)
      .map((driver) => ({
        driverId: driver.id,
        balance: driver.user.wallet!.balance,
        currency: driver.user.wallet!.currency,
        user: decryptUserPhone(driver.user),
      }));
  }

  async settleRiderDebt(
    driverId: string,
    amount: number,
    note: string | undefined,
  ) {
    if (amount <= 0) {
      throw new BadRequestException('Settlement amount must be positive');
    }
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
    });
    if (!driver) throw new NotFoundException('Rider not found');

    return this.prisma.wallet.update({
      where: { userId: driver.userId },
      data: {
        balance: { increment: amount },
        ledgerEntries: {
          create: {
            amount,
            reason: note
              ? `Cash settlement recorded by admin: ${note}`
              : 'Cash settlement recorded by admin',
          },
        },
      },
    });
  }

  async listUsers(role?: UserRole) {
    const users = await this.prisma.user.findMany({
      where: role ? { role } : undefined,
      omit: { passwordHash: true },
      orderBy: { createdAt: 'desc' },
    });
    const selfCancelCounts = await this.getSelfCancellationCounts();
    return users.map((u) => {
      const selfCancelledRecently = selfCancelCounts.get(u.id) ?? 0;
      return {
        ...decryptUserPhone(u),
        selfCancelledRecently,
        isFlaggedForCancellations:
          selfCancelledRecently >= OVER_CANCELLATION_THRESHOLD,
      };
    });
  }

  // Counts, per user, how many of their OWN requests they cancelled themselves in the last
  // OVER_CANCELLATION_WINDOW_DAYS -- fetched and grouped in JS rather than a DB-side groupBy,
  // since "cancelledByUserId equals passengerId/senderId" is a same-row column comparison
  // Prisma's query builder can't express directly, and this table scan is small (admin-page
  // scale, not a hot path).
  private async getSelfCancellationCounts(): Promise<Map<string, number>> {
    const since = new Date(
      Date.now() - OVER_CANCELLATION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const [cancelledTrips, cancelledDeliveries] = await Promise.all([
      this.prisma.trip.findMany({
        where: { status: TripStatus.CANCELLED, cancelledAt: { gte: since } },
        select: { passengerId: true, cancelledByUserId: true },
      }),
      this.prisma.delivery.findMany({
        where: {
          status: DeliveryStatus.CANCELLED,
          cancelledAt: { gte: since },
        },
        select: { senderId: true, cancelledByUserId: true },
      }),
    ]);

    const counts = new Map<string, number>();
    for (const t of cancelledTrips) {
      if (t.cancelledByUserId && t.cancelledByUserId === t.passengerId) {
        counts.set(t.passengerId, (counts.get(t.passengerId) ?? 0) + 1);
      }
    }
    for (const d of cancelledDeliveries) {
      if (d.cancelledByUserId && d.cancelledByUserId === d.senderId) {
        counts.set(d.senderId, (counts.get(d.senderId) ?? 0) + 1);
      }
    }
    return counts;
  }

  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      omit: { passwordHash: true },
      include: {
        wallet: true,
        savedPlaces: true,
        emergencyContact: true,
        driverProfile: { include: { vehicle: true, documents: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const since = new Date(
      Date.now() - OVER_CANCELLATION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const [
      passengerTrips,
      driverTrips,
      ratingsReceived,
      selfCancelledTrips,
      selfCancelledDeliveries,
    ] = await Promise.all([
      this.prisma.trip.findMany({
        where: { passengerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { driver: { include: { user: { select: { name: true } } } } },
      }),
      user.driverProfile
        ? this.prisma.trip.findMany({
            where: { driverId: user.driverProfile.id },
            orderBy: { createdAt: 'desc' },
            take: 20,
            include: { passenger: { select: { name: true } } },
          })
        : Promise.resolve([]),
      this.prisma.rating.findMany({
        where: { toUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { fromUser: { select: { name: true } } },
      }),
      this.prisma.trip.count({
        where: {
          passengerId: userId,
          cancelledByUserId: userId,
          status: TripStatus.CANCELLED,
          cancelledAt: { gte: since },
        },
      }),
      this.prisma.delivery.count({
        where: {
          senderId: userId,
          cancelledByUserId: userId,
          status: DeliveryStatus.CANCELLED,
          cancelledAt: { gte: since },
        },
      }),
    ]);
    const selfCancelledRecently = selfCancelledTrips + selfCancelledDeliveries;

    return {
      ...decryptUserPhone(user),
      passengerTrips,
      driverTrips,
      ratingsReceived,
      selfCancelledRecently,
      isFlaggedForCancellations:
        selfCancelledRecently >= OVER_CANCELLATION_THRESHOLD,
    };
  }

  setUserActive(userId: string, isActive: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
      omit: { passwordHash: true },
    });
  }

  async deleteUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { driverProfile: true },
    });
    if (!user) throw new BadRequestException('User not found');

    const tripCount = await this.prisma.trip.count({
      where: {
        OR: [
          { passengerId: userId },
          ...(user.driverProfile ? [{ driverId: user.driverProfile.id }] : []),
        ],
      },
    });
    if (tripCount > 0) {
      throw new BadRequestException(
        'User has trip history and cannot be deleted. Suspend the account instead.',
      );
    }

    await this.prisma.user.delete({ where: { id: userId } });
    return { id: userId };
  }

  async promoteToAdmin(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.role === UserRole.ADMIN)
      throw new BadRequestException('User is already an admin');
    if (!user.emailVerifiedAt) {
      throw new BadRequestException(
        'User must have a verified email before being promoted to admin',
      );
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { role: UserRole.ADMIN },
      omit: { passwordHash: true },
    });
  }

  listTrips() {
    return this.prisma.trip.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        passenger: { select: { name: true } },
        driver: { include: { user: { select: { name: true } } } },
      },
    });
  }

  listDeliveries() {
    return this.prisma.delivery.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        sender: { select: { name: true } },
        rider: { include: { user: { select: { name: true } } } },
        category: { select: { name: true } },
      },
    });
  }

  listDeliveryCategories() {
    return this.prisma.deliveryCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { pricingRule: true },
    });
  }

  createDeliveryCategory(dto: CreateDeliveryCategoryDto) {
    return this.prisma.deliveryCategory.create({ data: dto });
  }

  updateDeliveryCategory(id: string, dto: UpdateDeliveryCategoryDto) {
    return this.prisma.deliveryCategory.update({ where: { id }, data: dto });
  }

  // Superseded by delivery size tiers below -- kept callable (unused by the admin UI now) so
  // no functionality is destroyed, just no longer surfaced.
  // Legacy per-category rule (size tiers price deliveries now); it has no waiting fields.
  upsertDeliveryPricingRule(categoryId: string, dto: UpsertPricingRuleDto) {
    const { baseFare, perKm, perMinute, currency } = dto;
    const data = { baseFare, perKm, perMinute, currency };
    return this.prisma.deliveryPricingRule.upsert({
      where: { categoryId },
      update: data,
      create: { categoryId, ...data },
    });
  }

  listDeliverySizeTiers() {
    return this.prisma.deliverySizeTier.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { pricingRule: true },
    });
  }

  createDeliverySizeTier(dto: CreateDeliverySizeTierDto) {
    return this.prisma.deliverySizeTier.create({ data: dto });
  }

  updateDeliverySizeTier(id: string, dto: UpdateDeliverySizeTierDto) {
    return this.prisma.deliverySizeTier.update({ where: { id }, data: dto });
  }

  upsertDeliverySizeTierPricingRule(
    sizeTierId: string,
    dto: UpsertPricingRuleDto,
  ) {
    return this.prisma.deliverySizeTierPricingRule.upsert({
      where: { sizeTierId },
      update: dto,
      create: { sizeTierId, ...dto },
    });
  }

  listDeliverySurcharges() {
    return this.prisma.deliverySurchargeRule.findMany({
      orderBy: { key: 'asc' },
    });
  }

  updateDeliverySurcharge(key: string, dto: UpdateDeliverySurchargeDto) {
    return this.prisma.deliverySurchargeRule.update({
      where: { key },
      data: dto,
    });
  }

  listPricingRules() {
    return this.prisma.pricingRule.findMany();
  }

  upsertPricingRule(
    rideType: 'ECONOMY' | 'COMFORT' | 'BODA',
    dto: UpsertPricingRuleDto,
  ) {
    return this.prisma.pricingRule.upsert({
      where: { rideType },
      update: dto,
      create: { rideType, ...dto },
    });
  }

  listCoupons() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  createCoupon(dto: CreateCouponDto) {
    if (!!dto.discountAmount === !!dto.discountPercent) {
      throw new BadRequestException(
        'Set either an amount off or a percentage off, not both',
      );
    }
    // Stored upper-case; passengers can type it in any case.
    const code = normalizeCouponCode(dto.code);
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
      throw new BadRequestException(
        'Codes are 3-40 letters, numbers, dashes or underscores',
      );
    }
    return this.prisma.coupon
      .create({
        data: {
          ...dto,
          code,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        },
      })
      .catch((err: unknown) => {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ConflictException(
            `A coupon with the code ${code} already exists`,
          );
        }
        throw err;
      });
  }

  setCouponActive(id: string, isActive: boolean) {
    return this.prisma.coupon.update({ where: { id }, data: { isActive } });
  }

  async getDocumentFile(id: string) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }
}
