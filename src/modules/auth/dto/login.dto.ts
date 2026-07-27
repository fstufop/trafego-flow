import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'gestor@agenciaxyz.com.br' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'senha-secreta' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
