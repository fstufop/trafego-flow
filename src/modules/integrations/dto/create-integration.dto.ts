import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { MetaPlatform } from '../entities/integration.entity.js';

export class CreateIntegrationDto {
  @ApiProperty({ example: 'uuid-do-client', description: 'ID do client (tenant)' })
  @IsUUID()
  clientId: string;

  @ApiProperty({ enum: MetaPlatform, example: MetaPlatform.INSTAGRAM })
  @IsEnum(MetaPlatform)
  platform: MetaPlatform;

  @ApiProperty({ example: '123456789', description: 'Instagram Page ID ou WhatsApp Phone Number ID' })
  @IsString()
  @IsNotEmpty()
  pageId: string;

  @ApiProperty({ description: 'Token de acesso de longa duração (será criptografado)' })
  @IsString()
  @IsNotEmpty()
  accessToken: string;

  @ApiPropertyOptional({ example: '2027-01-01T00:00:00Z', description: 'Expiração do token (null = permanente)' })
  @IsOptional()
  @IsDateString()
  tokenExpiresAt?: string;
}
