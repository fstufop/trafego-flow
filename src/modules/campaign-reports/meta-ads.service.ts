import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenExpiredException } from '../../common/exceptions/oauth-token-expired.exception.js';
import { IMetaAdsService } from './interfaces/meta-ads-service.interface.js';
import {
  MetaApiPaginatedResponse,
  MetaCampaign,
  MetaInsights,
  MetaInsightsParams,
} from './interfaces/meta-campaign.interface.js';

const INSIGHTS_FIELDS =
  'campaign_id,campaign_name,impressions,clicks,spend,reach,cpm,cpc,ctr,' +
  'actions,cost_per_action_type,date_start,date_stop,' +
  'purchase_roas,frequency,unique_clicks,cost_per_unique_click,' +
  'video_play_actions,video_p25_watched_actions,video_p50_watched_actions,' +
  'video_p75_watched_actions,video_p100_watched_actions';

type MetaErrorResponse = { response?: { data?: { error?: { code?: number } } } };

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
          fields: INSIGHTS_FIELDS,
          date_preset: params.datePreset,
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

  private get baseUrl(): string {
    const url = this.config.get<string>('meta.graphApiUrl');
    const version = this.config.get<string>('meta-ads.apiVersion');
    return `${url}/${version}`;
  }

  private handleError(err: MetaErrorResponse, identifier: string): never {
    const code = err?.response?.data?.error?.code;
    if (code === 190) {
      throw new OAuthTokenExpiredException(identifier);
    }
    this.logger.error(`Meta Ads API error for ${identifier}: ${JSON.stringify(err?.response?.data)}`);
    throw err;
  }
}
