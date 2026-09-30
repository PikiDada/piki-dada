import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryStatus,
  PaymentMethod,
  PaymentStatus,
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
import { PLATFORM_COMMISSION_RATE } from '../trips/trips.service';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

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

  async getFinanceSummary() {
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
      grossRevenue * PLATFORM_COMMISSION_RATE,
    );
    const nonCashRevenue = nonCashPaid._sum.amount ?? 0;
    const riderPayouts = Math.round(
      nonCashRevenue * (1 - PLATFORM_COMMISSION_RATE),
    );
    const deliveryGrossRevenue = deliveryPaid._sum.amount ?? 0;
    const deliveryCommission = Math.round(
      deliveryGrossRevenue * PLATFORM_COMMISSION_RATE,
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
      grossRevenue * PLATFORM_COMMISSION_RATE,
    );
    const riderPayouts = Math.round(
      (nonCash._sum.amount ?? 0) * (1 - PLATFORM_COMMISSION_RATE),
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
    return users.map(decryptUserPhone);
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

    const [passengerTrips, driverTrips, ratingsReceived] = await Promise.all([
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
    ]);

    return {
      ...decryptUserPhone(user),
      passengerTrips,
      driverTrips,
      ratingsReceived,
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
  upsertDeliveryPricingRule(categoryId: string, dto: UpsertPricingRuleDto) {
    return this.prisma.deliveryPricingRule.upsert({
      where: { categoryId },
      update: dto,
      create: { categoryId, ...dto },
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
    return this.prisma.coupon.create({
      data: {
        ...dto,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
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
