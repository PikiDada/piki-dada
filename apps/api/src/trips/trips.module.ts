import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TripsService } from './trips.service';
import { TripsController } from './trips.controller';
import { TripsGateway } from './trips.gateway';
import { PricingService } from './pricing.service';
import { JourneyTrackingService } from './journey-tracking.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [JwtModule.register({}), NotificationsModule],
  controllers: [TripsController],
  providers: [
    TripsService,
    TripsGateway,
    PricingService,
    JourneyTrackingService,
  ],
  exports: [TripsService, PricingService, TripsGateway],
})
export class TripsModule {}
