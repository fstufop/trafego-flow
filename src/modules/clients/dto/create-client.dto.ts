// src/modules/clients/dto/create-client.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CreateClientBillingDto } from './create-client-billing.dto.js';

export class CreateClientDto {
  @ApiProperty({ example: 'Agência XYZ', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({ example: 'contato@agenciaxyz.com.br' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: '(32) 99999-0000' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: '120363000000000000@g.us', description: 'JID do grupo WhatsApp' })
  @IsOptional()
  @IsString()
  whatsappGroupCode?: string;

  @ApiPropertyOptional({ example: 'https://drive.google.com/drive/folders/xxx' })
  @IsOptional()
  @IsString()
  googleDriveFolderUrl?: string;

  @ApiPropertyOptional({ type: () => CreateClientBillingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateClientBillingDto)
  billing?: CreateClientBillingDto;
}
