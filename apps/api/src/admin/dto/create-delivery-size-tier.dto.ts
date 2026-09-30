import { IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateDeliverySizeTierDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsNumber()
  maxWeightKg?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
