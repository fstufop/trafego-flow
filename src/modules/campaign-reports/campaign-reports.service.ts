import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { CsvFormatterService } from '../../common/csv/csv-formatter.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { MetaAdsService } from './meta-ads.service.js';
import { ICampaignReportsService } from './interfaces/campaign-reports-service.interface.js';
import {
  MetaApiPaginatedResponse,
  MetaCampaign,
  MetaInsights,
  MetaInsightsParams,
  PaginatedResult,
} from './interfaces/meta-campaign.interface.js';
import {
  GetInsightsQueryDto,
  MetaDatePreset,
  MetaInsightsLevel,
  MetaTimeIncrement,
} from './dto/get-insights-query.dto.js';
import { ExportInsightsCsvDto } from './dto/export-insights-csv.dto.js';
import {
  BREAKDOWN_COLUMNS,
  MetaInsightsColumn,
} from './enums/insights-column.enum.js';

const MAX_EXPORT_PAGES = 1000;

@Injectable()
export class CampaignReportsService implements ICampaignReportsService {
  private readonly logger = new Logger(CampaignReportsService.name);

  constructor(
    private readonly adAccountsService: AdAccountsService,
    private readonly metaAdsService: MetaAdsService,
    private readonly crypto: AesCryptoService,
    private readonly config: ConfigService,
    private readonly csvFormatter: CsvFormatterService,
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

  async exportInsightsCsv(dto: ExportInsightsCsvDto): Promise<string> {
    if (dto.datePreset && (dto.since || dto.until)) {
      throw new BadRequestException('Informe datePreset OU since+until, não ambos');
    }
    if (!!dto.since !== !!dto.until) {
      throw new BadRequestException('since e until devem ser informados juntos');
    }

    const columns = this.resolveColumns(dto.columns, dto.breakdowns);
    const period = this.resolvePeriod(dto);
    const level = dto.level ?? MetaInsightsLevel.CAMPAIGN;

    const account = await this.adAccountsService.findByAdAccountId(dto.adAccountId);
    if (!account.isActive) {
      throw new UnprocessableEntityException(`Ad account ${dto.adAccountId} is inactive`);
    }
    const token = this.crypto.decrypt(account.accessToken);

    const allRows: MetaInsights[] = [];
    let cursor: string | undefined;
    let pageCount = 0;

    do {
      const cacheKey = this.buildExportCacheKey(dto.adAccountId, period, level, dto.timeIncrement, dto.breakdowns, cursor);
      let page = await this.cache.get<PaginatedResult<MetaInsights>>(cacheKey);

      if (!page) {
        const result = await this.metaAdsService.fetchInsights(
          dto.adAccountId,
          token,
          { ...period, level, timeIncrement: dto.timeIncrement, breakdowns: dto.breakdowns },
          cursor,
        );
        page = { data: result.data, paging: { next: result.paging?.cursors?.after } };
        await this.cache.set(cacheKey, page, this.insightsTtlMs);
      }

      allRows.push(...page.data);
      cursor = page.paging.next;
      pageCount++;

      if (pageCount >= MAX_EXPORT_PAGES) {
        this.logger.warn(`exportInsightsCsv: MAX_EXPORT_PAGES (${MAX_EXPORT_PAGES}) reached for ${dto.adAccountId}`);
        break;
      }
    } while (cursor);

    return this.csvFormatter.format(allRows, columns);
  }

  private resolveColumns(columns?: MetaInsightsColumn[], breakdowns?: string): MetaInsightsColumn[] {
    if (columns?.length) return columns;
    const activeBreakdowns = breakdowns
      ? breakdowns.split(',').map(s => s.trim())
      : [];
    return Object.values(MetaInsightsColumn).filter(
      col => !BREAKDOWN_COLUMNS.includes(col) || activeBreakdowns.includes(col),
    );
  }

  private resolvePeriod(dto: ExportInsightsCsvDto): Pick<MetaInsightsParams, 'datePreset' | 'since' | 'until'> {
    if (dto.since && dto.until) return { since: dto.since, until: dto.until };
    return { datePreset: dto.datePreset ?? MetaDatePreset.LAST_30D };
  }

  private buildExportCacheKey(
    adAccountId: string,
    period: Pick<MetaInsightsParams, 'datePreset' | 'since' | 'until'>,
    level: MetaInsightsLevel,
    timeIncrement?: MetaTimeIncrement,
    breakdowns?: string,
    cursor?: string,
  ): string {
    const periodPart = period.since
      ? `since:${period.since}:until:${period.until}`
      : period.datePreset;
    return this.buildInsightsCacheKey(
      `meta:insights:${adAccountId}:${level}:${periodPart}`,
      cursor,
      timeIncrement,
      breakdowns,
    );
  }
}
