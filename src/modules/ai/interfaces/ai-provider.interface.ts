import { ClientProfileType } from '../../clients/enums/client-profile-type.enum.js';

export interface InsightsSummary {
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  purchases: number;
  addToCart: number;
  pageViews: number;
  messagesStarted: number;   // action_type: messaging_conversation_started_7d
  contentViews: number;      // action_type: view_content
  checkoutInitiated: number; // action_type: initiate_checkout
  liveViews: number;         // action_type: video_play
}

export interface AiReportPayload {
  period: {
    since: string;       // 'YYYY-MM-DD'
    until: string;       // 'YYYY-MM-DD'
    weekNumber: number;  // ISO 8601 week
  };
  current: InsightsSummary;         // total aggregated (acquisition + sales)
  previous: InsightsSummary | null; // previous week total from snapshot
  deltas: Record<string, number | null>;
  acquisition: InsightsSummary | null; // campaigns with CAP/CAPT in name
  sales: InsightsSummary | null;       // remaining campaigns
  clientProfile: ClientProfileType;
  clientContext: string | null;
}

export interface IAiProvider {
  generateReport(payload: AiReportPayload): Promise<string>;
}
