import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentType, DriverApprovalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { decryptUserPhone } from '../common/field-encryption';

@Injectable()
export class DriversService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  private async getDriverByUserId(userId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) {
      throw new NotFoundException('Rider profile not found');
    }
    return driver;
  }

  async getMyProfile(userId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      include: { vehicle: true, documents: true, user: { omit: { passwordHash: true } } },
    });
    if (!driver) return driver;
    return { ...driver, user: driver.user ? decryptUserPhone(driver.user) : driver.user };
  }

  async upsertVehicle(userId: string, dto: CreateVehicleDto) {
    const driver = await this.getDriverByUserId(userId);
    return this.prisma.vehicle.upsert({
      where: { driverId: driver.id },
      update: dto,
      create: { ...dto, driverId: driver.id },
    });
  }

  async addDocument(userId: string, type: DocumentType, fileUrl: string) {
    const driver = await this.getDriverByUserId(userId);
    return this.prisma.document.create({
      data: { driverId: driver.id, type, fileUrl },
    });
  }

  async setAvailability(userId: string, isOnline: boolean) {
    const driver = await this.getDriverByUserId(userId);
    if (isOnline && driver.approvalStatus !== DriverApprovalStatus.APPROVED) {
      throw new BadRequestException('Rider must be approved before going online');
    }
    return this.prisma.driver.update({ where: { id: driver.id }, data: { isOnline } });
  }

  async updateLocation(userId: string, lat: number, lng: number) {
    const driver = await this.getDriverByUserId(userId);
    return this.prisma.driver.update({
      where: { id: driver.id },
      data: { currentLat: lat, currentLng: lng },
    });
  }

  async listPendingApprovals() {
    const drivers = await this.prisma.driver.findMany({
      where: { approvalStatus: DriverApprovalStatus.PENDING },
      include: { user: { omit: { passwordHash: true } }, vehicle: true, documents: true },
    });
    return drivers.map((driver) => ({
      ...driver,
      user: driver.user ? decryptUserPhone(driver.user) : driver.user,
    }));
  }

  async setApprovalStatus(driverId: string, status: DriverApprovalStatus) {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      include: { vehicle: true },
    });
    if (!driver) {
      throw new NotFoundException('Rider not found');
    }
    if (status === DriverApprovalStatus.APPROVED && !driver.vehicle) {
      throw new BadRequestException('Rider must have a vehicle on file before approval');
    }
    const updated = await this.prisma.driver.update({
      where: { id: driverId },
      data: { approvalStatus: status },
    });
    this.notifications.notifyUser(
      driver.userId,
      status === DriverApprovalStatus.APPROVED ? 'Application approved' : 'Application rejected',
      status === DriverApprovalStatus.APPROVED
        ? 'You can now go online and start accepting rides.'
        : 'Your rider application was rejected. Contact support for details.',
    );
    return updated;
  }
}
