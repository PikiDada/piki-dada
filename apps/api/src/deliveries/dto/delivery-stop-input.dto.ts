import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsString,
  ValidateNested,
} from 'class-validator';
import { MAX_STOPS } from '../../trips/pricing.service';

export class DeliveryStopInputDto {
  @IsString()
  address: string;

  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsString()
  contactName: string;

  @IsString()
  contactPhone: string;
}

// Same contract as trips' ReplaceStopsDto: drop-offs still to come, in order; reached ones are
// locked and kept by the service.
export class ReplaceDeliveryStopsDto {
  @IsArray()
  @ArrayMaxSize(MAX_STOPS)
  @ValidateNested({ each: true })
  @Type(() => DeliveryStopInputDto)
  stops: DeliveryStopInputDto[];
}
