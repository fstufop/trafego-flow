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
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
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

  // Preenchidos via enriquecimento com o creative do anúncio (includeThumbnails, level=ad).
  // URLs assinadas pela CDN da Meta — expiram; não persistir para uso posterior.
  thumbnail_url?: string;
  image_url?: string;
  // Permalink do post no Instagram — estável, pode ser persistido.
  // Ausente em dark posts ou anúncios sem posicionamento no Instagram.
  instagram_permalink_url?: string;
}

export interface MetaAdCreative {
  id: string;
  thumbnail_url?: string;
  image_url?: string;
  instagram_permalink_url?: string;
}

export interface MetaAdWithCreative {
  id: string;
  creative?: MetaAdCreative;
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

export interface MetaAdset {
  id: string;
  name: string;
  updated_time: string; // ISO 8601, e.g. "2026-08-01T10:00:00+0000"
  effective_status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED' | 'IN_PROCESS' | 'WITH_ISSUES';
}
