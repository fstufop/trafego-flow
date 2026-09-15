import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateDriveFolderDto {
  @ApiProperty({ example: 'Cliente XYZ', description: 'Nome da pasta a criar no Google Drive' })
  @IsString()
  @IsNotEmpty()
  name: string;
}
