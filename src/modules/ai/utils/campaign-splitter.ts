import { MetaInsights } from '../../campaign-reports/interfaces/meta-campaign.interface.js';
import { InsightsSummary } from '../interfaces/ai-provider.interface.js';

const ACQUISITION_PATTERN = /(^|_)CAP[T]?(?:_|$)/i;

function isAcquisition(row: MetaInsights): boolean {
  return ACQUISITION_PATTERN.test(row.campaign_name ?? '');
}

function findAction(actions: MetaInsights['actions'], type: string): number {
  return parseInt(actions?.find(a => a.action_type === type)?.value ?? '0', 10);
}

function aggregateRows(rows: MetaInsights[]): InsightsSummary {
  let spend = 0, impressions = 0, clicks = 0, reach = 0;
  let purchases = 0, addToCart = 0, pageViews = 0;
  let messagesStarted = 0, contentViews = 0, checkoutInitiated = 0, liveViews = 0;

  for (const row of rows) {
    spend += parseFloat(row.spend ?? '0');
    impressions += parseInt(row.impressions ?? '0', 10);
    clicks += parseInt(row.clicks ?? '0', 10);
    reach += parseInt(row.reach ?? '0', 10);
    purchases += findAction(row.actions, 'purchase');
    addToCart += findAction(row.actions, 'add_to_cart');
    pageViews += findAction(row.actions, 'landing_page_view');
    contentViews += findAction(row.actions, 'view_content');
    checkoutInitiated += findAction(row.actions, 'initiate_checkout');
    messagesStarted += findAction(row.actions, 'messaging_conversation_started_7d');
    liveViews += findAction(row.actions, 'video_play');
  }

  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;

  return {
    spend, reach, impressions, clicks,
    ctr: parseFloat(ctr.toFixed(2)),
    cpm: parseFloat(cpm.toFixed(2)),
    purchases, addToCart, pageViews,
    messagesStarted, contentViews, checkoutInitiated, liveViews,
  };
}

export function splitAndAggregateCampaigns(rows: MetaInsights[]): {
  acquisition: InsightsSummary | null;
  sales: InsightsSummary | null;
  total: InsightsSummary;
} {
  const acquisitionRows = rows.filter(isAcquisition);
  const salesRows = rows.filter(r => !isAcquisition(r));

  return {
    acquisition: acquisitionRows.length > 0 ? aggregateRows(acquisitionRows) : null,
    sales: salesRows.length > 0 ? aggregateRows(salesRows) : null,
    total: aggregateRows(rows),
  };
}
