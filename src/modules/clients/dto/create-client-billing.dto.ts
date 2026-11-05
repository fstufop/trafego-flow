import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import {
  DiscountType,
  PaymentMethod,
} from '../entities/client-billing.entity.js';

export class CreateClientBillingDto {
  @ApiProperty({ example: '2026-01-15', description: 'Contract start date' })
  @Type(() => Date)
  @IsDate()
  startDate: Date;

  @ApiProperty({
    example: 6,
    description: 'Contract duration in months (1–12)',
  })
  @IsInt()
  @Min(1)
  @Max(12)
  durationMonths: number;

  @ApiProperty({ example: 1500.0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @ApiProperty({ example: 10, description: 'Due day of month (1–30)' })
  @IsInt()
  @Min(1)
  @Max(30)
  dueDay: number;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.PIX })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiPropertyOptional({ enum: DiscountType })
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @ApiPropertyOptional({ example: 100.0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  discountValue?: number;
}
