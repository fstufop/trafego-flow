// src/modules/clients/dto/renew-client-billing.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { DiscountType, PaymentMethod } from '../entities/client-billing.entity.js';

export class RenewClientBillingDto {
  @ApiProperty({ example: '2026-07-01', description: 'New contract start date' })
  @Type(() => Date)
  @IsDate()
  startDate: Date;

  @ApiProperty({ example: 6, description: 'Contract duration in months (1–12)' })
  @IsInt()
  @Min(1)
  @Max(12)
  durationMonths: number;

  @ApiPropertyOptional({ example: 1500.0, description: 'Inherits from previous contract if omitted' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  amount?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  dueDay?: number;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ enum: DiscountType })
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @ApiPropertyOptional({ example: 100.0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  discountValue?: number;
}
