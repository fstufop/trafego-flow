import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetPostsQueryDto {
  @ApiProperty({ example: '17841400000000000', description: 'ID da página do Instagram' })
  @IsString()
  @IsNotEmpty()
  pageId: string;

  @ApiPropertyOptional({ example: 12, description: 'Resultados por página (máx 50)', default: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 12;

  @ApiPropertyOptional({ description: 'Cursor de paginação retornado em paging.cursors.after' })
  @IsOptional()
  @IsString()
  after?: string;
}
