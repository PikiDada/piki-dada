import { Global, Module } from '@nestjs/common';
import { PricingSettingsService } from './pricing-settings.service';

@Global()
@Module({
  providers: [PricingSettingsService],
  exports: [PricingSettingsService],
})
export class PricingSettingsModule {}
