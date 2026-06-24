import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiProduces, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiKeyGuard } from '../../common/guards/api-key.guard.js';
import { CampaignReportsService } from './campaign-reports.service.js';
import {
  GetInsightsQueryDto,
  MetaDatePreset,
  MetaTimeIncrement,
} from './dto/get-insights-query.dto.js';
import { ExportInsightsCsvDto } from './dto/export-insights-csv.dto.js';

@ApiTags('campaign-reports')
@ApiSecurity('x-api-key')
@UseGuards(ApiKeyGuard)
@Controller('campaign-reports')
export class CampaignReportsController {
  constructor(private readonly campaignReportsService: CampaignReportsService) {}

  @Get('campaigns')
  @ApiOperation({ summary: 'List campaigns for an ad account' })
  @ApiQuery({ name: 'adAccountId', required: true, example: 'act_123456789' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Cursor de paginação retornado em paging.next' })
  listCampaigns(
    @Query('adAccountId') adAccountId: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.campaignReportsService.listCampaigns(adAccountId, cursor);
  }

  @Post('insights/export/csv')
  @ApiOperation({ summary: 'Exporta insights de campanhas em formato CSV' })
  @ApiProduces('text/csv')
  @ApiBody({ type: ExportInsightsCsvDto })
  async exportCsv(
    @Body() dto: ExportInsightsCsvDto,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.campaignReportsService.exportInsightsCsv(dto);
    const period = dto.since ? `${dto.since}_${dto.until}` : (dto.datePreset ?? 'last_30d');
    const filename = `insights_${dto.adAccountId}_${period}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @Get('insights')
  @ApiOperation({ summary: 'Get insights for an ad account' })
  getInsights(@Query() query: GetInsightsQueryDto) {
    return this.campaignReportsService.getInsights(query.adAccountId, query);
  }

  @Get('insights/:campaignId')
  @ApiOperation({ summary: 'Get insights for a specific campaign' })
  @ApiQuery({ name: 'adAccountId', required: true, example: 'act_123456789' })
  @ApiQuery({ name: 'datePreset', required: false, enum: MetaDatePreset })
  @ApiQuery({ name: 'timeIncrement', required: false, enum: MetaTimeIncrement, description: '1=diário, 7=semanal, monthly, all_days' })
  @ApiQuery({ name: 'breakdowns', required: false, description: 'age, gender, country, region, publisher_platform, device_platform (separados por vírgula)' })
  getCampaignInsights(
    @Param('campaignId') campaignId: string,
    @Query('adAccountId') adAccountId: string,
    @Query('datePreset') datePreset: MetaDatePreset = MetaDatePreset.LAST_30D,
    @Query('timeIncrement') timeIncrement?: MetaTimeIncrement,
    @Query('breakdowns') breakdowns?: string,
  ) {
    return this.campaignReportsService.getCampaignInsights(
      campaignId,
      adAccountId,
      datePreset,
      timeIncrement,
      breakdowns,
    );
  }
}
