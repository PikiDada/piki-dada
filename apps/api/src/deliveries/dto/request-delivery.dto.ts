import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class RequestDeliveryDto {
  @IsString()
  categoryId: string;

  @IsString()
  pickupContactName: string;

  @IsString()
  pickupContactPhone: string;

  @IsNumber()
  pickupLat: number;

  @IsNumber()
  pickupLng: number;

  @IsString()
  pickupAddress: string;

  @IsString()
  dropoffContactName: string;

  @IsString()
  dropoffContactPhone: string;

  @IsNumber()
  destinationLat: number;

  @IsNumber()
  destinationLng: number;

  @IsString()
  destinationAddress: string;

  @IsString()
  itemDescription: string;

  @IsOptional()
  @IsString()
  itemPhotoUrl?: string;

  @IsOptional()
  @IsBoolean()
  isFragile?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cashOnDeliveryAmount?: number;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
}
