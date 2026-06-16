import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetExpiringQueryDto {
  @ApiProperty({ example: 'uuid-do-client' })
  @IsUUID()
  clientId: string;

  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  daysAhead?: number = 7;
}
