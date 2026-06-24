import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum AdType {
  ALL = 'ALL',
  EMPLOYMENT_ADS = 'EMPLOYMENT_ADS',
  HOUSING_ADS = 'HOUSING_ADS',
  FINANCIAL_PRODUCTS_AND_SERVICES_ADS = 'FINANCIAL_PRODUCTS_AND_SERVICES_ADS',
}

export enum AdActiveStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ALL = 'ALL',
}

export enum SearchType {
  KEYWORD_UNORDERED = 'KEYWORD_UNORDERED',
  KEYWORD_EXACT_PHRASE = 'KEYWORD_EXACT_PHRASE',
}

export enum MediaType {
  ALL = 'ALL',
  IMAGE = 'IMAGE',
  MEME = 'MEME',
  VIDEO = 'VIDEO',
  NONE = 'NONE',
}

export class SearchAdLibraryDto {
  // ── Filtros Meta API ──────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: 'moda', description: 'Palavras-chave nos criativos (máx 100 chars). Espaço = AND' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  terms?: string = 'moda';

  @ApiPropertyOptional({ enum: SearchType, default: SearchType.KEYWORD_UNORDERED })
  @IsOptional()
  @IsEnum(SearchType)
  searchType?: SearchType = SearchType.KEYWORD_UNORDERED;

  @ApiPropertyOptional({ example: 'BR', description: 'Código ISO-2 do país. Múltiplos separados por vírgula: BR,AR' })
  @IsOptional()
  @IsString()
  country?: string = 'BR';

  @ApiPropertyOptional({ enum: AdType, default: AdType.ALL })
  @IsOptional()
  @IsEnum(AdType)
  adType?: AdType = AdType.ALL;

  @ApiPropertyOptional({ enum: AdActiveStatus, default: AdActiveStatus.ACTIVE })
  @IsOptional()
  @IsEnum(AdActiveStatus)
  activeStatus?: AdActiveStatus = AdActiveStatus.ACTIVE;

  @ApiPropertyOptional({ example: 'INSTAGRAM,FACEBOOK', description: 'Plataformas separadas por vírgula' })
  @IsOptional()
  @IsString()
  platforms?: string;

  @ApiPropertyOptional({ example: 'pt', description: 'Códigos ISO 639-1 separados por vírgula' })
  @IsOptional()
  @IsString()
  languages?: string;

  @ApiPropertyOptional({ enum: MediaType })
  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType;

  @ApiPropertyOptional({ example: '2024-01-01', description: 'Data mínima de veiculação (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  deliveryDateMin?: string;

  @ApiPropertyOptional({ example: '2024-12-31', description: 'Data máxima de veiculação (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  deliveryDateMax?: string;

  @ApiPropertyOptional({ example: '123456,789012', description: 'Até 10 IDs de página separados por vírgula' })
  @IsOptional()
  @IsString()
  pageIds?: string;

  // ── Paginação ─────────────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: 50, description: 'Resultados únicos por página (máx 100)', default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 50;

  @ApiPropertyOptional({ description: 'Cursor de paginação retornado em paging.cursors.after' })
  @IsOptional()
  @IsString()
  after?: string;

  // ── Filtros pós-resposta (aplicados no service) ───────────────────────────

  @ApiPropertyOptional({ example: 100, description: 'Descarta anunciantes com spend.lowerBound abaixo deste valor' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  minSpend?: number;

  @ApiPropertyOptional({ example: 1000, description: 'Descarta anunciantes com impressions.lowerBound abaixo deste valor' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  minImpressions?: number;
}
