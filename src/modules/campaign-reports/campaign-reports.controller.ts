import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard.js';
import { CampaignReportsService } from './campaign-reports.service.js';
import { GetInsightsQueryDto, MetaDatePreset } from './dto/get-insights-query.dto.js';

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

  @Get('insights')
  @ApiOperation({ summary: 'Get insights for an ad account' })
  getInsights(@Query() query: GetInsightsQueryDto) {
    return this.campaignReportsService.getInsights(query.adAccountId, query);
  }

  @Get('insights/:campaignId')
  @ApiOperation({ summary: 'Get insights for a specific campaign' })
  @ApiQuery({ name: 'adAccountId', required: true, example: 'act_123456789' })
  @ApiQuery({ name: 'datePreset', required: false, enum: MetaDatePreset })
  getCampaignInsights(
    @Param('campaignId') campaignId: string,
    @Query('adAccountId') adAccountId: string,
    @Query('datePreset') datePreset: MetaDatePreset = MetaDatePreset.LAST_30D,
  ) {
    return this.campaignReportsService.getCampaignInsights(campaignId, adAccountId, datePreset);
  }
}
