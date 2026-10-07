import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private ready = false;

  constructor(private config: ConfigService) {
    if (getApps().length) {
      this.ready = true;
      return;
    }
    try {
      initializeApp({
        credential: cert({
          projectId: this.config.getOrThrow<string>('FIREBASE_PROJECT_ID'),
          clientEmail: this.config.getOrThrow<string>('FIREBASE_CLIENT_EMAIL'),
          privateKey: this.config
            .getOrThrow<string>('FIREBASE_PRIVATE_KEY')
            .replace(/\\n/g, '\n'),
        }),
      });
      this.ready = true;
    } catch {
      this.logger.warn(
        'Firebase Admin not initialized — push notifications are disabled until real credentials are configured.',
      );
    }
  }

  async sendToToken(
    token: string | null | undefined,
    title: string,
    body: string,
  ) {
    if (!token || !this.ready) return;
    try {
      await getMessaging().send({ token, notification: { title, body } });
    } catch {
      // Push delivery failures shouldn't break the request flow
    }
  }
}
