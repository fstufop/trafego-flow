import { MetaCampaign, MetaInsights } from './meta-campaign.interface.js';
import { GetInsightsQueryDto, MetaDatePreset } from '../dto/get-insights-query.dto.js';

export interface ICampaignReportsService {
  listCampaigns(adAccountId: string): Promise<MetaCampaign[]>;
  getInsights(adAccountId: string, query: GetInsightsQueryDto): Promise<MetaInsights[]>;
  getCampaignInsights(campaignId: string, adAccountId: string, datePreset: MetaDatePreset): Promise<MetaInsights>;
}
