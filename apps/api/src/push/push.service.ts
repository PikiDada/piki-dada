import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { PushSubscriptionDto } from './dto/push-subscription.dto';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private publicKey: string | null;
  private enabled: boolean;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');

    if (publicKey && subject && privateKey) {
      this.publicKey = publicKey;
      this.enabled = true;
      webpush.setVapidDetails(subject, publicKey, privateKey);
    } else {
      this.publicKey = null;
      this.enabled = false;
      this.logger.warn('VAPID keys not configured — push notifications are disabled');
    }
  }

  getPublicKey() {
    if (!this.enabled || !this.publicKey) {
      return { publicKey: null };
    }
    return { publicKey: this.publicKey };
  }

  subscribe(dto: PushSubscriptionDto, userId?: string) {
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      update: { p256dh: dto.keys.p256dh, auth: dto.keys.auth, userId },
      create: {
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userId,
      },
    });
  }

  async unsubscribe(endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
    return { success: true };
  }

  async broadcast(title: string, body: string, url?: string) {
    if (!this.enabled) {
      this.logger.warn('[Push disabled] Broadcast would have been sent but VAPID not configured');
      return { sentCount: 0, failedCount: 0 };
    }

    const subscriptions = await this.prisma.pushSubscription.findMany();
    let sentCount = 0;
    let failedCount = 0;

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify({ title, body, url }),
          );
          sentCount += 1;
        } catch (err) {
          failedCount += 1;
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          } else {
            this.logger.warn(`Push send failed for subscription ${sub.id}: ${String(err)}`);
          }
        }
      }),
    );

    await this.prisma.pushBroadcastLog.create({
      data: { title, body, url, sentCount, failedCount },
    });

    return { sentCount, failedCount };
  }

  listBroadcastHistory() {
    return this.prisma.pushBroadcastLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  }
}
