import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { MetaAdsService } from './meta-ads.service.js';
import { ICampaignReportsService } from './interfaces/campaign-reports-service.interface.js';
import { MetaCampaign, MetaInsights } from './interfaces/meta-campaign.interface.js';
import { GetInsightsQueryDto, MetaDatePreset, MetaInsightsLevel } from './dto/get-insights-query.dto.js';

const INSIGHTS_TTL_MS = 300 * 1000;

@Injectable()
export class CampaignReportsService implements ICampaignReportsService {
  constructor(
    private readonly adAccountsService: AdAccountsService,
    private readonly metaAdsService: MetaAdsService,
    private readonly crypto: AesCryptoService,
    @Inject(CACHE_MANAGER)
    private readonly cache: Cache,
  ) {}

  async listCampaigns(adAccountId: string): Promise<MetaCampaign[]> {
    const cacheKey = `meta:campaigns:${adAccountId}`;
    const cached = await this.cache.get<MetaCampaign[]>(cacheKey);
    if (cached) return cached;

    const account = await this.adAccountsService.findByAdAccountId(adAccountId);
    if (!account.isActive) {
      throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);
    }

    const token = this.crypto.decrypt(account.accessToken);
    const campaigns = await this.metaAdsService.fetchCampaigns(adAccountId, token);
    await this.cache.set(cacheKey, campaigns, INSIGHTS_TTL_MS);
    return campaigns;
  }

  async getInsights(adAccountId: string, query: GetInsightsQueryDto): Promise<MetaInsights[]> {
    const level = query.level ?? MetaInsightsLevel.CAMPAIGN;
    const datePreset = query.datePreset ?? MetaDatePreset.LAST_30D;
    const cacheKey = `meta:insights:${adAccountId}:${level}:${datePreset}`;

    const cached = await this.cache.get<MetaInsights[]>(cacheKey);
    if (cached) return cached;

    const account = await this.adAccountsService.findByAdAccountId(adAccountId);
    if (!account.isActive) {
      throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);
    }

    const token = this.crypto.decrypt(account.accessToken);
    const insights = await this.metaAdsService.fetchInsights(adAccountId, token, { datePreset, level });
    await this.cache.set(cacheKey, insights, INSIGHTS_TTL_MS);
    return insights;
  }

  async getCampaignInsights(
    campaignId: string,
    adAccountId: string,
    datePreset: MetaDatePreset,
  ): Promise<MetaInsights> {
    const cacheKey = `meta:insights:campaign:${campaignId}:${datePreset}`;

    const cached = await this.cache.get<MetaInsights>(cacheKey);
    if (cached) return cached;

    const account = await this.adAccountsService.findByAdAccountId(adAccountId);
    if (!account.isActive) {
      throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);
    }

    const token = this.crypto.decrypt(account.accessToken);
    const insight = await this.metaAdsService.fetchCampaignInsights(campaignId, token, { datePreset });
    await this.cache.set(cacheKey, insight, INSIGHTS_TTL_MS);
    return insight;
  }
}
