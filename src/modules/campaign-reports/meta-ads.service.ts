import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { OAuthTokenExpiredException } from '../../common/exceptions/oauth-token-expired.exception.js';
import { IMetaAdsService } from './interfaces/meta-ads-service.interface.js';
import {
  MetaCampaign,
  MetaInsights,
  MetaInsightsParams,
  MetaApiPaginatedResponse,
} from './interfaces/meta-campaign.interface.js';

const INSIGHTS_FIELDS =
  'campaign_id,campaign_name,impressions,clicks,spend,reach,cpm,cpc,ctr,actions,cost_per_action_type,date_start,date_stop';

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
        },
      }),
    ).catch((err: MetaErrorResponse) => this.handleError(err, adAccountId));

    return response.data;
  }

  async fetchCampaignInsights(
    campaignId: string,
    accessToken: string,
    params: MetaInsightsParams,
  ): Promise<MetaInsights> {
    const url = `${this.baseUrl}/${campaignId}/insights`;
    const response = await firstValueFrom(
      this.httpService.get<MetaApiPaginatedResponse<MetaInsights>>(url, {
        params: {
          fields: INSIGHTS_FIELDS,
          date_preset: params.datePreset,
          access_token: accessToken,
        },
      }),
    ).catch((err: MetaErrorResponse) => this.handleError(err, campaignId));

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
