import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

export class UpdateIntegrationDto {
  @ApiPropertyOptional({ description: 'Novo token de acesso (rotação de token)' })
  @IsString()
  @IsOptional()
  accessToken?: string;

  @ApiPropertyOptional({ example: '2027-01-01T00:00:00Z' })
  @IsDateString()
  @IsOptional()
  tokenExpiresAt?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
