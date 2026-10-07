import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { encryptField } from '../common/field-encryption';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByGoogleId(googleId: string) {
    return this.prisma.user.findUnique({ where: { googleId } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(data: {
    email: string;
    passwordHash?: string;
    googleId?: string;
    name: string;
    phone?: string;
    photoUrl?: string;
    role: UserRole;
  }) {
    return this.prisma.user.create({
      data: {
        ...data,
        phone: encryptField(data.phone),
        wallet: { create: { balance: 0 } },
        ...(data.role === UserRole.DRIVER
          ? { driverProfile: { create: {} } }
          : {}),
      },
    });
  }

  updateProfile(
    id: string,
    data: Partial<{ name: string; phone: string; photoUrl: string }>,
  ) {
    return this.prisma.user.update({
      where: { id },
      data: {
        ...data,
        phone: data.phone !== undefined ? encryptField(data.phone) : undefined,
      },
    });
  }

  setFcmToken(id: string, fcmToken: string) {
    return this.prisma.user.update({ where: { id }, data: { fcmToken } });
  }
}
