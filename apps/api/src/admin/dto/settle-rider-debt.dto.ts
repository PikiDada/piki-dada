import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class SettleRiderDebtDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  note?: string;
}
