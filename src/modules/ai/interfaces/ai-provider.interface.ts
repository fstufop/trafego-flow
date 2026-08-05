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
}

export interface AiReportPayload {
  period: {
    since: string;       // 'YYYY-MM-DD'
    until: string;       // 'YYYY-MM-DD'
    weekNumber: number;  // ISO 8601
  };
  current: InsightsSummary;
  previous: InsightsSummary | null;
  deltas: Record<string, number | null>;
  clientContext: string | null;
}

export interface IAiProvider {
  generateReport(payload: AiReportPayload): Promise<string>;
}
