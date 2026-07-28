// src/modules/clients/dto/update-client.dto.ts
import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { CreateClientDto } from './create-client.dto.js';
import { CreateClientBillingDto } from './create-client-billing.dto.js';

export class UpdateClientBillingDto extends PartialType(CreateClientBillingDto) {}

export class UpdateClientDto extends OmitType(PartialType(CreateClientDto), ['billing'] as const) {
  @ApiPropertyOptional({ type: () => UpdateClientBillingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateClientBillingDto)
  billing?: UpdateClientBillingDto;
}
