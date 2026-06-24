import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateAdAccountDto {
  @ApiPropertyOptional({ description: 'Novo User Access Token (rotação de credencial)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  accessToken?: string;

  @ApiPropertyOptional({ example: '2027-06-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  tokenExpiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 'Conta Principal' })
  @IsOptional()
  @IsString()
  accountName?: string;
}
