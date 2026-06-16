import { MetaDatePreset, MetaInsightsLevel } from '../dto/get-insights-query.dto.js';

export interface MetaCampaign {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';
  objective: string;
  created_time: string;
}

export interface MetaInsights {
  campaign_id?: string;
  campaign_name?: string;
  impressions: string;
  clicks: string;
  spend: string;
  reach: string;
  cpm: string;
  cpc: string;
  ctr: string;
  actions?: MetaAction[];
  cost_per_action_type?: MetaAction[];
  date_start: string;
  date_stop: string;
}

export interface MetaAction {
  action_type: string;
  value: string;
}

export interface MetaInsightsParams {
  datePreset: MetaDatePreset;
  level?: MetaInsightsLevel;
}

export interface MetaApiPaginatedResponse<T> {
  data: T[];
  paging?: {
    cursors?: { before: string; after: string };
    next?: string;
  };
}

export interface PaginatedResult<T> {
  data: T[];
  paging: { next?: string };
}
