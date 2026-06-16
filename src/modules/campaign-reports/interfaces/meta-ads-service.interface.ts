import { MetaCampaign, MetaInsights, MetaInsightsParams } from './meta-campaign.interface.js';

export interface IMetaAdsService {
  fetchCampaigns(adAccountId: string, accessToken: string): Promise<MetaCampaign[]>;
  fetchInsights(adAccountId: string, accessToken: string, params: MetaInsightsParams): Promise<MetaInsights[]>;
  fetchCampaignInsights(campaignId: string, accessToken: string, params: MetaInsightsParams): Promise<MetaInsights>;
}
