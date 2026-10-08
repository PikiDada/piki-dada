import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private pushService: PushService,
  ) {}

  // Callers fire and forget (a notification must never hold up or fail a trip), so this never
  // rejects: an unhandled rejection would shut the whole Node process down.
  async notifyUser(userId: string, title: string, body: string) {
    try {
      const [, user] = await Promise.all([
        this.prisma.notification.create({ data: { userId, title, body } }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { fcmToken: true },
        }),
      ]);
      await this.pushService.sendToToken(user?.fcmToken, title, body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Notification to user ${userId} failed: ${message}`);
    }
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
