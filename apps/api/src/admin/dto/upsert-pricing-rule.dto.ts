import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpsertPricingRuleDto {
  @IsNumber()
  @Min(0)
  baseFare: number;

  @IsNumber()
  @Min(0)
  perKm: number;

  @IsNumber()
  @Min(0)
  perMinute: number;

  @IsString()
  currency: string;

  // Waiting at stops. Optional so older admin screens that don't send them keep working.
  @IsOptional()
  @IsNumber()
  @Min(0)
  waitingPerMinute?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  freeWaitMinutes?: number;
}
