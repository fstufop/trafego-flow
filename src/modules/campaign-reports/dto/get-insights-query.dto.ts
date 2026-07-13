import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum MetaTimeIncrement {
  DAILY    = '1',
  WEEKLY   = '7',
  MONTHLY  = 'monthly',
  ALL_DAYS = 'all_days',
}

export enum MetaBreakdown {
  AGE                = 'age',
  GENDER             = 'gender',
  COUNTRY            = 'country',
  REGION             = 'region',
  PUBLISHER_PLATFORM = 'publisher_platform',
  DEVICE_PLATFORM    = 'device_platform',
}

export enum MetaDatePreset {
  TODAY      = 'today',
  YESTERDAY  = 'yesterday',
  LAST_7D    = 'last_7d',
  LAST_14D   = 'last_14d',
  LAST_30D   = 'last_30d',
  THIS_MONTH = 'this_month',
  LAST_MONTH = 'last_month',
}

export enum MetaInsightsLevel {
  ACCOUNT  = 'account',
  CAMPAIGN = 'campaign',
  ADSET    = 'adset',
  AD       = 'ad',
}

export class GetInsightsQueryDto {
  @ApiProperty({ example: 'act_123456789', description: 'Ad Account ID no formato act_{numeric_id}' })
  @IsString()
  @IsNotEmpty()
  adAccountId: string;

  @ApiPropertyOptional({ enum: MetaDatePreset, default: MetaDatePreset.LAST_30D })
  @IsOptional()
  @IsEnum(MetaDatePreset)
  datePreset?: MetaDatePreset = MetaDatePreset.LAST_30D;

  @ApiPropertyOptional({ enum: MetaInsightsLevel, default: MetaInsightsLevel.CAMPAIGN })
  @IsOptional()
  @IsEnum(MetaInsightsLevel)
  level?: MetaInsightsLevel = MetaInsightsLevel.CAMPAIGN;

  @ApiPropertyOptional({ description: 'Cursor de paginação retornado em paging.next' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    enum: MetaTimeIncrement,
    description: 'Granularidade temporal: 1=diário, 7=semanal, monthly, all_days',
  })
  @IsOptional()
  @IsEnum(MetaTimeIncrement)
  timeIncrement?: MetaTimeIncrement;

  @ApiPropertyOptional({
    description: 'Breakdowns separados por vírgula. Valores: age, gender, country, region, publisher_platform, device_platform',
    example: 'age,gender',
  })
  @IsOptional()
  @IsString()
  breakdowns?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Inclui thumbnail_url, image_url e instagram_permalink_url do criativo de cada anúncio. Requer level=ad. As URLs de imagem são assinadas pela Meta e expiram; o permalink do Instagram é estável.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  includeThumbnails?: boolean;
}
