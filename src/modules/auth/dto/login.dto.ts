import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'filipesimoesteodoro@gmail.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'MFPerformance' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
