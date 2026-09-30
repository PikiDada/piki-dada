import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DriversModule } from './drivers/drivers.module';
import { UploadsModule } from './uploads/uploads.module';
import { TripsModule } from './trips/trips.module';
import { DeliveriesModule } from './deliveries/deliveries.module';
import { AdminModule } from './admin/admin.module';
import { PaymentsModule } from './payments/payments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PushModule } from './push/push.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // skipIf disables rate limiting under Jest (NODE_ENV=test is set automatically by Jest) —
    // e2e tests deliberately exercise high-volume flows (e.g. account lockout after repeated
    // logins) that would otherwise collide with these limits. Real traffic is never affected.
    ThrottlerModule.forRoot([
      { ttl: 60000, limit: 100, skipIf: () => process.env.NODE_ENV === 'test' },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    DriversModule,
    UploadsModule,
    TripsModule,
    DeliveriesModule,
    AdminModule,
    PaymentsModule,
    NotificationsModule,
    PushModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
