import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SearchAdLibraryDto } from './dto/search-ad-library.dto.js';
import type {
  AdLibraryAdvertiser,
  AdLibrarySearchResult,
  IAdLibraryService,
  MetaAdLibraryResponse,
  RawMetaAd,
} from './interfaces/ad-library.interface.js';

const AD_LIBRARY_FIELDS = [
  'page_id',
  'page_name',
  'bylines',
  'spend',
  'impressions',
  'estimated_audience_size',
  'ad_delivery_start_time',
  'ad_delivery_stop_time',
  'publisher_platforms',
  'languages',
  'demographic_distribution',
  'delivery_by_region',
  'target_ages',
  'target_gender',
  'target_locations',
  'ad_snapshot_url',
].join(',');

@Injectable()
export class AdLibraryService implements IAdLibraryService {
  private readonly logger = new Logger(AdLibraryService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  async search(dto: SearchAdLibraryDto): Promise<AdLibrarySearchResult> {
    const params = this.buildParams(dto);

    const response = await firstValueFrom(
      this.httpService.get<MetaAdLibraryResponse>(`${this.baseUrl}/ads_archive`, { params }),
    ).catch((err: unknown) => this.handleError(err));

    const raw = response.data.data ?? [];
    const paging = response.data.paging ?? null;

    const deduplicated = this.deduplicate(raw);
    const filtered = this.applyClientFilters(deduplicated, dto);
    const sliced = filtered.slice(0, dto.limit ?? 50);

    return {
      data: sliced.map(ad => this.mapToAdvertiser(ad)),
      paging: paging?.cursors ? { cursors: paging.cursors } : null,
      total: sliced.length,
    };
  }

  private get baseUrl(): string {
    const url = this.config.get<string>('meta.graphApiUrl');
    const version = this.config.get<string>('meta.graphApiVersion');
    return `${url}/${version}`;
  }

  private get accessToken(): string {
    const systemUserToken = this.config.get<string>('meta.systemUserToken');
    if (systemUserToken) return systemUserToken;

    const appId = this.config.get<string>('meta.appId');
    const appSecret = this.config.get<string>('meta.appSecret');
    return `${appId}|${appSecret}`;
  }

  private buildParams(dto: SearchAdLibraryDto): Record<string, unknown> {
    const limit = dto.limit ?? 50;
    const countries = (dto.country ?? 'BR').split(',').map(c => c.trim());

    return {
      access_token: this.accessToken,
      fields: AD_LIBRARY_FIELDS,
      ad_reached_countries: JSON.stringify(countries),
      search_terms: dto.terms ?? 'moda',
      search_type: dto.searchType,
      ad_type: dto.adType ?? 'ALL',
      ad_active_status: dto.activeStatus ?? 'ACTIVE',
      limit: limit * 3,
      ...(dto.platforms && { publisher_platforms: JSON.stringify(dto.platforms.split(',').map(p => p.trim())) }),
      ...(dto.languages && { languages: JSON.stringify(dto.languages.split(',').map(l => l.trim())) }),
      ...(dto.mediaType && { media_type: dto.mediaType }),
      ...(dto.deliveryDateMin && { ad_delivery_date_min: dto.deliveryDateMin }),
      ...(dto.deliveryDateMax && { ad_delivery_date_max: dto.deliveryDateMax }),
      ...(dto.pageIds && { search_page_ids: JSON.stringify(dto.pageIds.split(',').map(id => id.trim())) }),
      ...(dto.after && { after: dto.after }),
    };
  }

  private deduplicate(ads: RawMetaAd[]): RawMetaAd[] {
    const map = new Map<string, RawMetaAd>();

    for (const ad of ads) {
      const existing = map.get(ad.page_id);
      if (!existing || ad.ad_delivery_start_time > existing.ad_delivery_start_time) {
        map.set(ad.page_id, ad);
      }
    }

    return Array.from(map.values());
  }

  private applyClientFilters(ads: RawMetaAd[], dto: SearchAdLibraryDto): RawMetaAd[] {
    return ads.filter(ad => {
      if (dto.minSpend !== undefined && ad.spend) {
        if (parseInt(ad.spend.lower_bound, 10) < dto.minSpend) return false;
      }
      if (dto.minImpressions !== undefined && ad.impressions) {
        if (parseInt(ad.impressions.lower_bound, 10) < dto.minImpressions) return false;
      }
      return true;
    });
  }

  private mapToAdvertiser(raw: RawMetaAd): AdLibraryAdvertiser {
    return {
      pageId: raw.page_id,
      pageName: raw.page_name,
      fundingEntity: raw.bylines ?? null,
      spend: raw.spend
        ? { lowerBound: raw.spend.lower_bound, upperBound: raw.spend.upper_bound }
        : null,
      impressions: raw.impressions
        ? { lowerBound: raw.impressions.lower_bound, upperBound: raw.impressions.upper_bound }
        : null,
      estimatedAudienceSize: raw.estimated_audience_size
        ? { lowerBound: raw.estimated_audience_size.lower_bound, upperBound: raw.estimated_audience_size.upper_bound }
        : null,
      brTotalReach: raw.br_total_reach ?? null,
      adDeliveryStartTime: raw.ad_delivery_start_time,
      adDeliveryStopTime: raw.ad_delivery_stop_time ?? null,
      publisherPlatforms: raw.publisher_platforms ?? [],
      languages: raw.languages ?? [],
      demographicDistribution: (raw.demographic_distribution ?? []).map(d => ({
        age: d.age,
        gender: d.gender,
        percentage: d.percentage,
      })),
      deliveryByRegion: (raw.delivery_by_region ?? []).map(d => ({
        region: d.region,
        percentage: d.percentage,
      })),
      targetAges: raw.target_ages ?? [],
      targetGender: raw.target_gender ?? null,
      targetLocations: (raw.target_locations ?? []).map(l => ({
        name: l.name,
        type: l.type,
      })),
      adSnapshotUrl: raw.ad_snapshot_url,
    };
  }

  private handleError(err: unknown): never {
    const metaError = (err as { response?: { data?: { error?: { message?: string; code?: number; type?: string } } } })
      ?.response?.data?.error;

    this.logger.error(
      `Meta Ad Library API error — code: ${metaError?.code}, type: ${metaError?.type}, message: ${metaError?.message}`,
    );

    const message = metaError?.message ?? 'Erro ao consultar a Meta Ad Library API';
    throw new BadGatewayException(message);
  }
}
