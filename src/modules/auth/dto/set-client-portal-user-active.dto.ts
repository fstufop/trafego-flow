import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetClientPortalUserActiveDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isActive: boolean;
}
