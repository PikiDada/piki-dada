import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsString,
  ValidateNested,
} from 'class-validator';
import { MAX_STOPS } from '../pricing.service';

export class StopInputDto {
  @IsString()
  address: string;

  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;
}

// The full list of stops the passenger wants still to come, in visiting order. Stops already
// reached are locked and left out of this list; the service keeps them as they are.
export class ReplaceStopsDto {
  @IsArray()
  @ArrayMaxSize(MAX_STOPS)
  @ValidateNested({ each: true })
  @Type(() => StopInputDto)
  stops: StopInputDto[];
}
