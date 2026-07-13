import {
  MetaAdCreative,
  MetaApiPaginatedResponse,
  MetaCampaign,
  MetaInsights,
  MetaInsightsParams,
} from './meta-campaign.interface.js';

export interface IMetaAdsService {
  fetchCampaigns(adAccountId: string, accessToken: string, cursor?: string): Promise<MetaApiPaginatedResponse<MetaCampaign>>;
  fetchInsights(adAccountId: string, accessToken: string, params: MetaInsightsParams, cursor?: string): Promise<MetaApiPaginatedResponse<MetaInsights>>;
  fetchCampaignInsights(campaignId: string, accessToken: string, params: MetaInsightsParams): Promise<MetaInsights | MetaApiPaginatedResponse<MetaInsights>>;
  fetchAdCreatives(adIds: string[], accessToken: string): Promise<Record<string, MetaAdCreative>>;
}
