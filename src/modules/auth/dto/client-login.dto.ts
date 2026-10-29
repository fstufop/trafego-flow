import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class ClientLoginDto {
  @ApiProperty({ example: 'cliente@empresa.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'senha-secreta' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
