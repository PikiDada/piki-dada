import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Exactly one of discountAmount / discountPercent; AdminService.createCoupon enforces that.
export class CreateCouponDto {
  @IsString()
  @MaxLength(40)
  code: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
