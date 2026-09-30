import { IsNumber, Min } from 'class-validator';

export class UpdateDeliverySurchargeDto {
  @IsNumber()
  @Min(0)
  amount: number;
}
