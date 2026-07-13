import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { MetaInsightsColumn } from '../enums/insights-column.enum.js';
import {
  MetaDatePreset,
  MetaInsightsLevel,
  MetaTimeIncrement,
} from './get-insights-query.dto.js';

export class ExportInsightsCsvDto {
  @ApiProperty({ example: 'act_123456789' })
  @IsString()
  @IsNotEmpty()
  adAccountId: string;

  @ApiPropertyOptional({
    type: [String],
    enum: MetaInsightsColumn,
    isArray: true,
    description: 'Colunas a exportar. Quando ausente, exporta todas.',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(MetaInsightsColumn, { each: true })
  @ArrayMaxSize(30)
  columns?: MetaInsightsColumn[];

  @ApiPropertyOptional({
    enum: MetaDatePreset,
    default: MetaDatePreset.LAST_30D,
    description: 'Preset de período. Mutuamente exclusivo com since/until.',
  })
  @IsOptional()
  @IsEnum(MetaDatePreset)
  @ValidateIf((o: ExportInsightsCsvDto) => !o.since && !o.until)
  datePreset?: MetaDatePreset;

  @ApiPropertyOptional({
    example: '2025-11-01',
    description: 'Data inicial do intervalo customizado (YYYY-MM-DD). Requer until.',
  })
  @IsOptional()
  @IsDateString()
  @ValidateIf((o: ExportInsightsCsvDto) => !o.datePreset)
  since?: string;

  @ApiPropertyOptional({
    example: '2025-11-30',
    description: 'Data final do intervalo customizado (YYYY-MM-DD). Requer since.',
  })
  @IsOptional()
  @IsDateString()
  @ValidateIf((o: ExportInsightsCsvDto) => !o.datePreset)
  until?: string;

  @ApiPropertyOptional({ enum: MetaInsightsLevel, default: MetaInsightsLevel.CAMPAIGN })
  @IsOptional()
  @IsEnum(MetaInsightsLevel)
  level?: MetaInsightsLevel = MetaInsightsLevel.CAMPAIGN;

  @ApiPropertyOptional({ enum: MetaTimeIncrement })
  @IsOptional()
  @IsEnum(MetaTimeIncrement)
  timeIncrement?: MetaTimeIncrement;

  @ApiPropertyOptional({ example: 'age,gender' })
  @IsOptional()
  @IsString()
  breakdowns?: string;

  @ApiPropertyOptional({
    description:
      'Inclui as colunas Thumbnail e Link do Post (Instagram) do criativo de cada anúncio. Requer level=ad. As URLs de thumbnail são assinadas pela Meta e expiram; o link do post é estável.',
  })
  @IsOptional()
  @IsBoolean()
  includeThumbnails?: boolean;
}
