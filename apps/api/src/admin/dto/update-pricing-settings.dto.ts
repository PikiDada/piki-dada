import { UnvisitedStopsPolicy } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

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

  @IsOptional()
  @IsBoolean()
  durationCorrectionEnabled?: boolean;

  // Fewer trips than this per ride type and time of day is too few to trust.
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(1000)
  durationCorrectionMinTrips?: number;

  // 2 = Google's time can at most be doubled (or halved).
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(3)
  durationCorrectionMax?: number;
}
