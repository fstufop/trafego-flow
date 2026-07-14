import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenExpiredException } from '../../common/exceptions/oauth-token-expired.exception.js';
import { MetaPermissionException } from '../../common/exceptions/meta-permission.exception.js';
import { IMetaAdsService } from './interfaces/meta-ads-service.interface.js';
import {
  MetaAdCreative,
  MetaAdWithCreative,
  MetaApiPaginatedResponse,
  MetaCampaign,
  MetaInsights,
  MetaInsightsParams,
} from './interfaces/meta-campaign.interface.js';
import { MetaInsightsLevel } from './dto/get-insights-query.dto.js';

const INSIGHTS_FIELDS =
  'campaign_id,campaign_name,impressions,clicks,spend,reach,cpm,cpc,ctr,' +
  'actions,cost_per_action_type,date_start,date_stop,' +
  'purchase_roas,frequency,unique_clicks,cost_per_unique_click,' +
  'video_play_actions,video_p25_watched_actions,video_p50_watched_actions,' +
  'video_p75_watched_actions,video_p100_watched_actions';

// A Meta rejeita campos de identidade mais granulares que o level solicitado,
// então eles só podem ser adicionados quando o level correspondente é usado.
const LEVEL_IDENTITY_FIELDS: Partial<Record<MetaInsightsLevel, string>> = {
  [MetaInsightsLevel.ADSET]: 'adset_id,adset_name',
  [MetaInsightsLevel.AD]: 'adset_id,adset_name,ad_id,ad_name',
};

// Limite do Graph API para leitura em lote via ?ids=
const ADS_BATCH_SIZE = 50;

type MetaApiError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

type MetaErrorResponse = {
  response?: { status?: number; data?: { error?: MetaApiError } };
  message?: string;
};

// Faixa reservada pela Meta para erros de permissão
// https://developers.facebook.com/docs/graph-api/guides/error-handling
const META_PERMISSION_ERROR_MIN = 200;
const META_PERMISSION_ERROR_MAX = 299;

@Injectable()
export class MetaAdsService implements IMetaAdsService {
  private readonly logger = new Logger(MetaAdsService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  async fetchCampaigns(
    adAccountId: string,
    accessToken: string,
    cursor?: string,
  ): Promise<MetaApiPaginatedResponse<MetaCampaign>> {
    const url = `${this.baseUrl}/${adAccountId}/campaigns`;
    const response = await firstValueFrom(
      this.httpService.get<MetaApiPaginatedResponse<MetaCampaign>>(url, {
        params: {
          fields: 'id,name,status,objective,created_time',
          access_token: accessToken,
          ...(cursor && { after: cursor }),
        },
      }),
    ).catch((err: MetaErrorResponse) => this.handleError(err, adAccountId));

    return response.data;
  }

  async fetchInsights(
    adAccountId: string,
    accessToken: string,
    params: MetaInsightsParams,
    cursor?: string,
  ): Promise<MetaApiPaginatedResponse<MetaInsights>> {
    const url = `${this.baseUrl}/${adAccountId}/insights`;
    const response = await firstValueFrom(
      this.httpService.get<MetaApiPaginatedResponse<MetaInsights>>(url, {
        params: {
          fields: this.buildInsightsFields(params.level),
          ...(params.since && params.until
            ? { time_range: JSON.stringify({ since: params.since, until: params.until }) }
            : { date_preset: params.datePreset }),
          level: params.level,
          access_token: accessToken,
          ...(cursor && { after: cursor }),
          ...(params.timeIncrement && { time_increment: params.timeIncrement }),
          ...(params.breakdowns && { breakdowns: params.breakdowns }),
        },
      }),
    ).catch((err: MetaErrorResponse) => this.handleError(err, adAccountId));

    return response.data;
  }

  async fetchCampaignInsights(
    campaignId: string,
    accessToken: string,
    params: MetaInsightsParams,
  ): Promise<MetaInsights | MetaApiPaginatedResponse<MetaInsights>> {
    const url = `${this.baseUrl}/${campaignId}/insights`;
    const response = await firstValueFrom(
      this.httpService.get<MetaApiPaginatedResponse<MetaInsights>>(url, {
        params: {
          fields: INSIGHTS_FIELDS,
          date_preset: params.datePreset,
          access_token: accessToken,
          ...(params.timeIncrement && { time_increment: params.timeIncrement }),
          ...(params.breakdowns && { breakdowns: params.breakdowns }),
        },
      }),
    ).catch((err: MetaErrorResponse) => this.handleError(err, campaignId));

    // With breakdowns or timeIncrement multiple rows are expected — return full paginated response
    if (params.timeIncrement || params.breakdowns) {
      return response.data;
    }

    const insight = response.data.data[0];
    if (!insight) {
      throw new NotFoundException(`No insights found for campaign ${campaignId} on preset ${params.datePreset}`);
    }
    return insight;
  }

  async fetchAdCreatives(
    adIds: string[],
    accessToken: string,
  ): Promise<Record<string, MetaAdCreative>> {
    const creativesByAdId: Record<string, MetaAdCreative> = {};

    for (let i = 0; i < adIds.length; i += ADS_BATCH_SIZE) {
      const chunk = adIds.slice(i, i + ADS_BATCH_SIZE);
      const response = await firstValueFrom(
        this.httpService.get<Record<string, MetaAdWithCreative>>(`${this.baseUrl}/`, {
          params: {
            ids: chunk.join(','),
            fields: 'creative{id,thumbnail_url,image_url,instagram_permalink_url}',
            access_token: accessToken,
          },
        }),
      ).catch((err: MetaErrorResponse) => this.handleError(err, `ads batch [${chunk[0]}...]`));

      for (const [adId, ad] of Object.entries(response.data)) {
        if (ad.creative) creativesByAdId[adId] = ad.creative;
      }
    }

    return creativesByAdId;
  }

  private buildInsightsFields(level?: MetaInsightsLevel): string {
    const identityFields = level && LEVEL_IDENTITY_FIELDS[level];
    return identityFields ? `${INSIGHTS_FIELDS},${identityFields}` : INSIGHTS_FIELDS;
  }

  private get baseUrl(): string {
    const url = this.config.get<string>('meta.graphApiUrl');
    const version = this.config.get<string>('meta-ads.apiVersion');
    return `${url}/${version}`;
  }

  private handleError(err: MetaErrorResponse, identifier: string): never {
    const metaError = err?.response?.data?.error;

    if (!metaError) {
      this.logger.error(`Meta Ads API unreachable for ${identifier}: ${err?.message}`);
      throw new ServiceUnavailableException(
        `Meta Ads API unreachable for ${identifier}: ${err?.message ?? 'unknown error'}`,
      );
    }

    this.logger.error(
      `Meta Ads API error for ${identifier}: [code ${metaError.code}] ${metaError.message} (fbtrace_id: ${metaError.fbtrace_id})`,
    );

    if (metaError.code === 190) {
      throw new OAuthTokenExpiredException(identifier);
    }

    if (
      metaError.code !== undefined &&
      metaError.code >= META_PERMISSION_ERROR_MIN &&
      metaError.code <= META_PERMISSION_ERROR_MAX
    ) {
      throw new MetaPermissionException(identifier, metaError.message);
    }

    throw new BadGatewayException({
      message: `Meta Ads API error for ${identifier}: ${metaError.message}`,
      metaCode: metaError.code,
      metaErrorSubcode: metaError.error_subcode,
      fbtraceId: metaError.fbtrace_id,
    });
  }
}
