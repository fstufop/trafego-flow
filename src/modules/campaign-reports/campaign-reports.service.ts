import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { MetaAdsService } from './meta-ads.service.js';
import { ICampaignReportsService } from './interfaces/campaign-reports-service.interface.js';
import {
  MetaApiPaginatedResponse,
  MetaCampaign,
  MetaInsights,
  PaginatedResult,
} from './interfaces/meta-campaign.interface.js';
import {
  GetInsightsQueryDto,
  MetaDatePreset,
  MetaInsightsLevel,
  MetaTimeIncrement,
} from './dto/get-insights-query.dto.js';

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

  private buildInsightsCacheKey(
    base: string,
    cursor?: string,
    timeIncrement?: MetaTimeIncrement,
    breakdowns?: string,
  ): string {
    let key = base;
    if (timeIncrement) key += `:ti:${timeIncrement}`;
    if (breakdowns) {
      const sorted = breakdowns.split(',').map(s => s.trim()).sort().join(',');
      key += `:bd:${sorted}`;
    }
    if (cursor) key += `:cursor:${cursor}`;
    return key;
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
    const cacheKey = this.buildInsightsCacheKey(
      `meta:insights:${adAccountId}:${level}:${datePreset}`,
      query.cursor,
      query.timeIncrement,
      query.breakdowns,
    );

    const cached = await this.cache.get<PaginatedResult<MetaInsights>>(cacheKey);
    if (cached) return cached;

    const account = await this.adAccountsService.findByAdAccountId(adAccountId);
    if (!account.isActive) {
      throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);
    }

    const token = this.crypto.decrypt(account.accessToken);
    const result = await this.metaAdsService.fetchInsights(
      adAccountId,
      token,
      { datePreset, level, timeIncrement: query.timeIncrement, breakdowns: query.breakdowns },
      query.cursor,
    );
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
    timeIncrement?: MetaTimeIncrement,
    breakdowns?: string,
  ): Promise<MetaInsights | PaginatedResult<MetaInsights>> {
    const cacheKey = this.buildInsightsCacheKey(
      `meta:insights:campaign:${campaignId}:${datePreset}`,
      undefined,
      timeIncrement,
      breakdowns,
    );

    const cached = await this.cache.get<MetaInsights | PaginatedResult<MetaInsights>>(cacheKey);
    if (cached) return cached;

    const account = await this.adAccountsService.findByAdAccountId(adAccountId);
    if (!account.isActive) {
      throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);
    }

    const token = this.crypto.decrypt(account.accessToken);
    const result = await this.metaAdsService.fetchCampaignInsights(
      campaignId,
      token,
      { datePreset, timeIncrement, breakdowns },
    );

    let toCache: MetaInsights | PaginatedResult<MetaInsights>;
    if (timeIncrement || breakdowns) {
      const paginatedResult = result as MetaApiPaginatedResponse<MetaInsights>;
      toCache = {
        data: paginatedResult.data,
        paging: { next: paginatedResult.paging?.cursors?.after },
      };
    } else {
      toCache = result as MetaInsights;
    }

    await this.cache.set(cacheKey, toCache, this.insightsTtlMs);
    return toCache;
  }
}
