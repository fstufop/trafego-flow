import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsUUID } from 'class-validator';

export class CreateClientPortalUserDto {
  @ApiProperty({ example: 'b3f1a2d4-5c6e-4f7a-8b9c-0d1e2f3a4b5c' })
  @IsUUID()
  clientId: string;

  @ApiProperty({ example: 'cliente@empresa.com.br' })
  @IsEmail()
  email: string;
}
