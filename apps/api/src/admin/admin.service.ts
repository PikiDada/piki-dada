import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentMethod, PaymentStatus, TripStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertPricingRuleDto } from './dto/upsert-pricing-rule.dto';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { decryptUserPhone } from '../common/field-encryption';
import { PLATFORM_COMMISSION_RATE } from '../trips/trips.service';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const [totalTrips, completedTrips, activeDrivers, totalPassengers, revenue] =
      await Promise.all([
        this.prisma.trip.count(),
        this.prisma.trip.count({ where: { status: TripStatus.COMPLETED } }),
        this.prisma.driver.count({ where: { isOnline: true } }),
        this.prisma.user.count({ where: { role: UserRole.PASSENGER } }),
        this.prisma.payment.aggregate({
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
    };
  }

  async getFinanceSummary() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
    ] = await Promise.all([
      this.prisma.payment.aggregate({ where: paidWhere, _sum: { amount: true }, _count: true }),
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
    ]);

    const grossRevenue = allTimePaid._sum.amount ?? 0;
    const platformCommission = Math.round(grossRevenue * PLATFORM_COMMISSION_RATE);
    const nonCashRevenue = nonCashPaid._sum.amount ?? 0;
    const riderPayouts = Math.round(nonCashRevenue * (1 - PLATFORM_COMMISSION_RATE));

    return {
      grossRevenue,
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

  async listUsers(role?: UserRole) {
    const users = await this.prisma.user.findMany({
      where: role ? { role } : undefined,
      omit: { passwordHash: true },
      orderBy: { createdAt: 'desc' },
    });
    return users.map(decryptUserPhone);
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
    if (user.role === UserRole.ADMIN) throw new BadRequestException('User is already an admin');
    if (!user.emailVerifiedAt) {
      throw new BadRequestException('User must have a verified email before being promoted to admin');
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
      include: { passenger: { select: { name: true } }, driver: { include: { user: { select: { name: true } } } } },
    });
  }

  listPricingRules() {
    return this.prisma.pricingRule.findMany();
  }

  upsertPricingRule(rideType: 'ECONOMY' | 'COMFORT' | 'BODA', dto: UpsertPricingRuleDto) {
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
      data: { ...dto, expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined },
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
