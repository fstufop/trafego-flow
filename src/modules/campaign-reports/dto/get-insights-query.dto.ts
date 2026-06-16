import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';


export enum MetaDatePreset {
  TODAY = 'today',
  YESTERDAY = 'yesterday',
  LAST_7D = 'last_7d',
  LAST_14D = 'last_14d',
  LAST_30D = 'last_30d',
  THIS_MONTH = 'this_month',
  LAST_MONTH = 'last_month',
}

export enum MetaInsightsLevel {
  ACCOUNT = 'account',
  CAMPAIGN = 'campaign',
  ADSET = 'adset',
  AD = 'ad',
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
}
