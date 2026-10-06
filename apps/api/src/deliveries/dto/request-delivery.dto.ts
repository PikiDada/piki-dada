import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';
import { MAX_STOPS } from '../../trips/pricing.service';
import { DeliveryStopInputDto } from './delivery-stop-input.dto';

export class RequestDeliveryDto {
  @IsString()
  categoryId: string;

  // Drives the fare (how hard the item is to carry) -- categoryId above is descriptive only.
  @IsString()
  sizeTierId: string;

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

  // Extra drop-offs visited before the final one above.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_STOPS)
  @ValidateNested({ each: true })
  @Type(() => DeliveryStopInputDto)
  stops?: DeliveryStopInputDto[];

  @IsString()
  itemDescription: string;

  @IsOptional()
  @IsString()
  itemPhotoUrl?: string;

  @IsOptional()
  @IsBoolean()
  isFragile?: boolean;

  @IsOptional()
  @IsBoolean()
  isLiquid?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cashOnDeliveryAmount?: number;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
}
