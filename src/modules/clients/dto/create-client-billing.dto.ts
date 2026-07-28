// src/modules/clients/dto/create-client-billing.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import {
  BillingStatus,
  BillingType,
  DiscountType,
  PaymentMethod,
} from '../entities/client-billing.entity.js';

export class CreateClientBillingDto {
  @ApiProperty({ enum: BillingType, example: BillingType.MONTHLY })
  @IsEnum(BillingType)
  type: BillingType;

  @ApiProperty({ example: 1500.00 })
  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @ApiPropertyOptional({ enum: DiscountType })
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @ApiPropertyOptional({ example: 100.00, description: 'Valor ou percentual do desconto' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  discountValue?: number;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.PIX })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiProperty({ example: 10, description: 'Dia do mês de vencimento (1–31)' })
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay: number;

  @ApiProperty({ enum: BillingStatus, example: BillingStatus.PENDING })
  @IsEnum(BillingStatus)
  status: BillingStatus;
}
