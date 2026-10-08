import { Global, Module } from '@nestjs/common';
import { PricingSettingsService } from './pricing-settings.service';
import { EstimateAccuracyService } from './estimate-accuracy.service';

@Global()
@Module({
  providers: [PricingSettingsService, EstimateAccuracyService],
  exports: [PricingSettingsService, EstimateAccuracyService],
})
export class PricingSettingsModule {}
