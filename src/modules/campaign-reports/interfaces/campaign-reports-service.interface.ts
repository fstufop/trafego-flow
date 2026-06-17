import { MetaCampaign, MetaInsights, PaginatedResult } from './meta-campaign.interface.js';
import { GetInsightsQueryDto, MetaDatePreset, MetaTimeIncrement } from '../dto/get-insights-query.dto.js';

export interface ICampaignReportsService {
  listCampaigns(adAccountId: string, cursor?: string): Promise<PaginatedResult<MetaCampaign>>;
  getInsights(adAccountId: string, query: GetInsightsQueryDto): Promise<PaginatedResult<MetaInsights>>;
  getCampaignInsights(
    campaignId: string,
    adAccountId: string,
    datePreset: MetaDatePreset,
    timeIncrement?: MetaTimeIncrement,
    breakdowns?: string,
  ): Promise<MetaInsights | PaginatedResult<MetaInsights>>;
}
