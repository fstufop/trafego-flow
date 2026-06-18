import { MetaDatePreset, MetaInsightsLevel, MetaTimeIncrement } from '../dto/get-insights-query.dto.js';

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

  // Frequência e cliques únicos
  frequency?: string;
  unique_clicks?: string;
  cost_per_unique_click?: string;

  // ROAS
  purchase_roas?: MetaAction[];

  // Métricas de vídeo
  video_play_actions?: MetaAction[];
  video_p25_watched_actions?: MetaAction[];
  video_p50_watched_actions?: MetaAction[];
  video_p75_watched_actions?: MetaAction[];
  video_p100_watched_actions?: MetaAction[];

  // Campos de breakdown (presentes quando breakdowns são solicitados)
  age?: string;
  gender?: string;
  country?: string;
  region?: string;
  publisher_platform?: string;
  device_platform?: string;
}

export interface MetaAction {
  action_type: string;
  value: string;
}

export interface MetaInsightsParams {
  datePreset?: MetaDatePreset;
  since?: string;
  until?: string;
  level?: MetaInsightsLevel;
  timeIncrement?: MetaTimeIncrement;
  breakdowns?: string;
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
