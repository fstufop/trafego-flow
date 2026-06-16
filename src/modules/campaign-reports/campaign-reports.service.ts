import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { MetaAdsService } from './meta-ads.service.js';
import { ICampaignReportsService } from './interfaces/campaign-reports-service.interface.js';
import { MetaInsights, PaginatedResult } from './interfaces/meta-campaign.interface.js';
import { GetInsightsQueryDto, MetaDatePreset, MetaInsightsLevel } from './dto/get-insights-query.dto.js';
import { MetaCampaign } from './interfaces/meta-campaign.interface.js';

@Injectable()
export class CampaignReportsService implements ICampaignReportsService {
  constructor(
    private readonly adAccountsService: AdAccountsService,
    private readonly metaAdsService: MetaAdsService,
    private readonly crypto: AesCryptoService,
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER)
    private readonly cache: Cache,
  ) {}

  private get insightsTtlMs(): number {
    return this.config.get<number>('meta-ads.insightsCacheTtlSeconds')! * 1000;
  }

  async listCampaigns(adAccountId: string, cursor?: string): Promise<PaginatedResult<MetaCampaign>> {
    const cacheKey = cursor
      ? `meta:campaigns:${adAccountId}:cursor:${cursor}`
      : `meta:campaigns:${adAccountId}`;

    const cached = await this.cache.get<PaginatedResult<MetaCampaign>>(cacheKey);
    if (cached) return cached;

    const account = await this.adAccountsService.findByAdAccountId(adAccountId);
    if (!account.isActive) {
      throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);
    }

    const token = this.crypto.decrypt(account.accessToken);
    const result = await this.metaAdsService.fetchCampaigns(adAccountId, token, cursor);
    const paginated: PaginatedResult<MetaCampaign> = {
      data: result.data,
      paging: { next: result.paging?.cursors?.after },
    };
    await this.cache.set(cacheKey, paginated, this.insightsTtlMs);
    return paginated;
  }

  async getInsights(adAccountId: string, query: GetInsightsQueryDto): Promise<PaginatedResult<MetaInsights>> {
    const level = query.level ?? MetaInsightsLevel.CAMPAIGN;
    const datePreset = query.datePreset ?? MetaDatePreset.LAST_30D;
    const cursor = query.cursor;
    const cacheKey = cursor
      ? `meta:insights:${adAccountId}:${level}:${datePreset}:cursor:${cursor}`
      : `meta:insights:${adAccountId}:${level}:${datePreset}`;

    const cached = await this.cache.get<PaginatedResult<MetaInsights>>(cacheKey);
    if (cached) return cached;

    const account = await this.adAccountsService.findByAdAccountId(adAccountId);
    if (!account.isActive) {
      throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);
    }

    const token = this.crypto.decrypt(account.accessToken);
    const result = await this.metaAdsService.fetchInsights(adAccountId, token, { datePreset, level }, cursor);
    const paginated: PaginatedResult<MetaInsights> = {
      data: result.data,
      paging: { next: result.paging?.cursors?.after },
    };
    await this.cache.set(cacheKey, paginated, this.insightsTtlMs);
    return paginated;
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
    await this.cache.set(cacheKey, insight, this.insightsTtlMs);
    return insight;
  }
}
