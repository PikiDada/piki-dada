import { UnvisitedStopsPolicy } from '@prisma/client';
import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

// Bounds stop a typo (an extra zero, a percent typed as a fraction) from mispricing every trip.
export class UpdatePricingSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  fareRoundingUnit?: number;

  // A fraction: 0.15 = 15%.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(0.9)
  platformCommissionRate?: number;

  @IsOptional()
  @IsEnum(UnvisitedStopsPolicy)
  unvisitedStopsPolicy?: UnvisitedStopsPolicy;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(3)
  roadDistanceFallbackFactor?: number;

  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(120)
  averageSpeedKmh?: number;
}
