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
import { AdsetMessageRow, LiveReportData, AdReachRow } from '../ai/interfaces/ai-provider.interface.js';
import {
  parseLiveCampaigns,
  getLatestLiveDates,
  formatDisplayDate,
  formatIsoDate,
  ACQUISITION_PATTERN,
} from './utils/live-date.util.js';
import {
  MetaAdset,
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
  CREATIVE_ENRICHMENT_COLUMNS,
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
    includeThumbnails?: boolean,
  ): string {
    let key = base;
    if (timeIncrement) key += `:ti:${timeIncrement}`;
    if (breakdowns) {
      const sorted = breakdowns.split(',').map(s => s.trim()).sort().join(',');
      key += `:bd:${sorted}`;
    }
    if (includeThumbnails) key += ':thumbs';
    if (cursor) key += `:cursor:${cursor}`;
    return key;
  }

  private assertThumbnailsLevel(includeThumbnails: boolean, level: MetaInsightsLevel): void {
    if (includeThumbnails && level !== MetaInsightsLevel.AD) {
      throw new BadRequestException('includeThumbnails requer level=ad');
    }
  }

  /**
   * Busca os creatives dos anúncios e anexa thumbnail_url/image_url às linhas.
   * Best-effort: falha na busca de creatives não derruba o relatório.
   */
  private async enrichWithThumbnails(rows: MetaInsights[], accessToken: string): Promise<MetaInsights[]> {
    const adIds = [...new Set(rows.map(r => r.ad_id).filter((id): id is string => !!id))];
    if (!adIds.length) return rows;

    try {
      const creatives = await this.metaAdsService.fetchAdCreatives(adIds, accessToken);
      return rows.map(row => {
        const creative = row.ad_id ? creatives[row.ad_id] : undefined;
        return creative
          ? {
              ...row,
              thumbnail_url: creative.thumbnail_url,
              image_url: creative.image_url,
              instagram_permalink_url: creative.instagram_permalink_url,
            }
          : row;
      });
    } catch (err) {
      this.logger.warn(`Falha ao buscar thumbnails dos anúncios: ${(err as Error)?.message ?? err}`);
      return rows;
    }
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
    if (query.datePreset && (query.since || query.until)) {
      throw new BadRequestException('Informe datePreset OU since+until, não ambos');
    }
    if (!!query.since !== !!query.until) {
      throw new BadRequestException('since e until devem ser informados juntos');
    }

    const level = query.level ?? MetaInsightsLevel.CAMPAIGN;
    const includeThumbnails = query.includeThumbnails ?? false;
    this.assertThumbnailsLevel(includeThumbnails, level);

    const period = this.resolveInsightsPeriod(query);
    const periodPart = period.since
      ? `since:${period.since}:until:${period.until}`
      : period.datePreset;
    const cacheKey = this.buildInsightsCacheKey(
      `meta:insights:${adAccountId}:${level}:${periodPart}`,
      query.cursor,
      query.timeIncrement,
      query.breakdowns,
      includeThumbnails,
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
      { ...period, level, timeIncrement: query.timeIncrement, breakdowns: query.breakdowns },
      query.cursor,
    );
    const rows = includeThumbnails
      ? await this.enrichWithThumbnails(result.data, token)
      : result.data;
    const paginated: PaginatedResult<MetaInsights> = {
      data: rows,
      paging: { next: result.paging?.cursors?.after },
    };
    await this.cache.set(cacheKey, paginated, this.insightsTtlMs);
    return paginated;
  }

  private resolveInsightsPeriod(
    query: Pick<GetInsightsQueryDto, 'since' | 'until' | 'datePreset'>,
  ): Pick<MetaInsightsParams, 'datePreset' | 'since' | 'until'> {
    if (query.since && query.until) return { since: query.since, until: query.until };
    return { datePreset: query.datePreset ?? MetaDatePreset.LAST_30D };
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

    const level = dto.level ?? MetaInsightsLevel.CAMPAIGN;
    const includeThumbnails = dto.includeThumbnails ?? false;
    this.assertThumbnailsLevel(includeThumbnails, level);

    const columns = this.resolveColumns(dto.columns, dto.breakdowns, includeThumbnails);
    const period = this.resolvePeriod(dto);

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

    // Thumbnails são enriquecidos após o loop para não gravar no cache URLs que expiram
    const rows = includeThumbnails
      ? await this.enrichWithThumbnails(allRows, token)
      : allRows;

    return this.csvFormatter.format(rows, columns);
  }

  private resolveColumns(
    columns?: MetaInsightsColumn[],
    breakdowns?: string,
    includeThumbnails = false,
  ): MetaInsightsColumn[] {
    if (columns?.length) return columns;
    const activeBreakdowns = breakdowns
      ? breakdowns.split(',').map(s => s.trim())
      : [];
    return Object.values(MetaInsightsColumn).filter(
      col =>
        (!CREATIVE_ENRICHMENT_COLUMNS.includes(col) || includeThumbnails) &&
        (!BREAKDOWN_COLUMNS.includes(col) || activeBreakdowns.includes(col)),
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

  async listAdsets(adAccountId: string): Promise<MetaAdset[]> {
    const account = await this.adAccountsService.findByAdAccountId(adAccountId);
    if (!account.isActive) {
      throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);
    }
    const token = this.crypto.decrypt(account.accessToken);
    return this.metaAdsService.fetchAdsets(adAccountId, token);
  }

  async getAdsetInsights(
    adsetId: string,
    adAccountId: string,
    since: string,
    until: string,
  ): Promise<MetaInsights | null> {
    const account = await this.adAccountsService.findByAdAccountId(adAccountId);
    if (!account.isActive) {
      throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);
    }
    const token = this.crypto.decrypt(account.accessToken);
    return this.metaAdsService.fetchAdsetInsights(adsetId, token, since, until);
  }

  async getAdsetMessageRows(
    adAccountId: string,
    since: string,
    until: string,
  ): Promise<AdsetMessageRow[]> {
    const account = await this.adAccountsService.findByAdAccountId(adAccountId);
    if (!account.isActive) {
      throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);
    }
    const token = this.crypto.decrypt(account.accessToken);

    const [insightRows, adsets] = await Promise.all([
      this.metaAdsService.fetchAdsetMessageInsights(adAccountId, token, since, until),
      this.metaAdsService.fetchAdsets(adAccountId, token),
    ]);

    const startTimeById = new Map(adsets.map((a) => [a.id, a.start_time]));

    const rows: AdsetMessageRow[] = insightRows.map((row) => {
      const messagesStarted = parseInt(
        row.actions?.find((a) => a.action_type === 'messaging_conversation_started_7d')?.value ?? '0',
        10,
      );
      const spend = parseFloat(row.spend ?? '0');
      const costPerMessage = messagesStarted > 0 ? spend / messagesStarted : null;
      const rawStart = startTimeById.get(row.adset_id ?? '') ?? null;
      const startDate = rawStart ? this.formatAdsetDate(rawStart) : '–';
      return {
        adsetName: row.adset_name ?? row.adset_id ?? '',
        messagesStarted,
        costPerMessage,
        startDate,
      };
    });

    return rows.sort((a, b) => b.messagesStarted - a.messagesStarted);
  }

  private formatAdsetDate(isoString: string): string {
    const match = isoString.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return '–';
    const [, year, month, day] = match;
    return `${day}/${month}/${year.slice(2)}`;
  }

  async getLiveReportData(adAccountId: string): Promise<LiveReportData[]> {
    const account = await this.adAccountsService.findByAdAccountId(adAccountId);
    if (!account.isActive) {
      throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);
    }
    const token = this.crypto.decrypt(account.accessToken);

    const today = new Date();
    const sixtyDaysAgo = new Date(today);
    sixtyDaysAgo.setDate(today.getDate() - 60);
    const since60 = formatIsoDate(sixtyDaysAgo);
    const todayStr = formatIsoDate(today);

    // Discovery fetch: 60-day window — only used to identify which live dates exist
    const discoveryResult = await this.metaAdsService.fetchInsights(adAccountId, token, {
      since: since60,
      until: todayStr,
      level: MetaInsightsLevel.CAMPAIGN,
    });

    const campaigns = discoveryResult.data
      .map((r) => ({ id: r.campaign_id ?? '', name: r.campaign_name ?? '' }))
      .filter((c) => c.id && c.name);

    const parsed = parseLiveCampaigns(campaigns);
    const latestDates = getLatestLiveDates(parsed, 2);

    if (latestDates.length === 0) return [];

    const results: LiveReportData[] = [];

    for (const liveDate of latestDates) {
      const liveDateIso = formatIsoDate(liveDate);
      const liveDateDisplay = formatDisplayDate(liveDate);
      const dd = String(liveDate.getDate()).padStart(2, '0');
      const mm = String(liveDate.getMonth() + 1).padStart(2, '0');
      const yy = String(liveDate.getFullYear()).slice(2);
      const liveDateStr = `${dd}_${mm}_${yy}`;

      // Per-live metrics fetch: live-date→today window, same as the ad-level fetch below
      const liveInsightResult = await this.metaAdsService.fetchInsights(adAccountId, token, {
        since: liveDateIso,
        until: todayStr,
        level: MetaInsightsLevel.CAMPAIGN,
      });

      const captationRows = liveInsightResult.data.filter((r) => {
        const name = r.campaign_name ?? '';
        return name.includes(liveDateStr) && ACQUISITION_PATTERN.test(name);
      });

      let captationSpend = 0;
      let captationReach = 0;
      let captationClicks = 0;
      for (const row of captationRows) {
        captationSpend += parseFloat(row.spend ?? '0');
        captationReach += parseInt(row.reach ?? '0', 10);
        captationClicks += parseInt(row.clicks ?? '0', 10);
      }

      const adRows = await this.metaAdsService.fetchAdInsightsByPeriod(
        adAccountId,
        token,
        liveDateIso,
        todayStr,
      );

      const adReaches: AdReachRow[] = adRows
        .filter((r) => {
          const name = r.campaign_name ?? '';
          return name.includes(liveDateStr) && ACQUISITION_PATTERN.test(name);
        })
        .map((r) => ({
          adName: r.ad_name ?? r.ad_id ?? '',
          reach: parseInt(r.reach ?? '0', 10),
        }))
        .filter((r) => r.adName && r.reach > 0)
        .sort((a, b) => b.reach - a.reach);

      results.push({ liveDate: liveDateDisplay, captationSpend, captationReach, captationClicks, adReaches });
    }

    return results;
  }
}
