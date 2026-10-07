import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private pushService: PushService,
  ) {}

  async notifyUser(userId: string, title: string, body: string) {
    const [, user] = await Promise.all([
      this.prisma.notification.create({ data: { userId, title, body } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { fcmToken: true },
      }),
    ]);
    await this.pushService.sendToToken(user?.fcmToken, title, body);
  }

  listForUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  markRead(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }
}
