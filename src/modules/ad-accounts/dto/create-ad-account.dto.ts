import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class CreateAdAccountDto {
  @ApiProperty({ example: 'uuid-do-client', description: 'ID do client (tenant)' })
  @IsUUID()
  clientId: string;

  @ApiProperty({ example: 'act_123456789', description: 'Ad Account ID no formato act_{numeric_id}' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^act_\d+$/, { message: 'adAccountId must follow the format act_{numeric_id}' })
  adAccountId: string;

  @ApiProperty({ description: 'User Access Token de longa duração com permissão ads_read (será criptografado)' })
  @IsString()
  @IsNotEmpty()
  accessToken: string;

  @ApiPropertyOptional({ example: 'Conta Principal', description: 'Nome legível da conta (opcional)' })
  @IsOptional()
  @IsString()
  accountName?: string;

  @ApiPropertyOptional({ example: '2027-01-01T00:00:00Z', description: 'Expiração do token (null = permanente)' })
  @IsOptional()
  @IsDateString()
  tokenExpiresAt?: string;
}
