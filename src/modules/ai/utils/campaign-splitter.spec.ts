import { splitAndAggregateCampaigns } from './campaign-splitter.js';
import { MetaInsights } from '../../campaign-reports/interfaces/meta-campaign.interface.js';

function makeRow(overrides: Partial<MetaInsights> & { campaign_name?: string }): MetaInsights {
  return {
    impressions: '0', clicks: '0', spend: '0', reach: '0',
    cpm: '0', cpc: '0', ctr: '0',
    date_start: '2026-07-28', date_stop: '2026-08-03',
    ...overrides,
  };
}

describe('splitAndAggregateCampaigns', () => {
  it('returns null acquisition and null sales when rows is empty', () => {
    const result = splitAndAggregateCampaigns([]);
    expect(result.acquisition).toBeNull();
    expect(result.sales).toBeNull();
    expect(result.total.spend).toBe(0);
  });

  it('classifies row with CAP in name as acquisition', () => {
    const row = makeRow({ campaign_name: 'MF_ENG_FRIO_CAP_JUL26', spend: '100', clicks: '50' });
    const result = splitAndAggregateCampaigns([row]);
    expect(result.acquisition).not.toBeNull();
    expect(result.acquisition!.spend).toBeCloseTo(100);
    expect(result.acquisition!.clicks).toBe(50);
    expect(result.sales).toBeNull();
  });

  it('classifies row with CAPT in name as acquisition (case-insensitive)', () => {
    const row = makeRow({ campaign_name: 'mf_eng_frio_capt_jul26', spend: '200' });
    const result = splitAndAggregateCampaigns([row]);
    expect(result.acquisition).not.toBeNull();
    expect(result.acquisition!.spend).toBeCloseTo(200);
  });

  it('classifies row without CAP/CAPT as sales', () => {
    const row = makeRow({ campaign_name: 'MF_VENDA_HOT_JUL26', spend: '1000', clicks: '300' });
    const result = splitAndAggregateCampaigns([row]);
    expect(result.sales).not.toBeNull();
    expect(result.sales!.spend).toBeCloseTo(1000);
    expect(result.acquisition).toBeNull();
  });

  it('classifies row with undefined campaign_name as sales', () => {
    const row = makeRow({ spend: '500' });
    const result = splitAndAggregateCampaigns([row]);
    expect(result.sales).not.toBeNull();
    expect(result.acquisition).toBeNull();
  });

  it('splits mixed rows correctly and total equals sum', () => {
    const captRow = makeRow({ campaign_name: 'MF_CAPT', spend: '100', clicks: '50', reach: '500', impressions: '1000' });
    const vendaRow = makeRow({ campaign_name: 'MF_VENDA', spend: '900', clicks: '300', reach: '2000', impressions: '5000' });
    const result = splitAndAggregateCampaigns([captRow, vendaRow]);
    expect(result.acquisition!.spend).toBeCloseTo(100);
    expect(result.sales!.spend).toBeCloseTo(900);
    expect(result.total.spend).toBeCloseTo(1000);
    expect(result.total.clicks).toBe(350);
  });

  it('maps action_types to InsightsSummary fields', () => {
    const row = makeRow({
      campaign_name: 'MF_VENDA',
      spend: '500',
      actions: [
        { action_type: 'purchase', value: '10' },
        { action_type: 'add_to_cart', value: '25' },
        { action_type: 'landing_page_view', value: '300' },
        { action_type: 'view_content', value: '200' },
        { action_type: 'initiate_checkout', value: '15' },
        { action_type: 'messaging_conversation_started_7d', value: '5' },
        { action_type: 'video_play', value: '80' },
      ],
    });
    const result = splitAndAggregateCampaigns([row]);
    expect(result.sales!.purchases).toBe(10);
    expect(result.sales!.addToCart).toBe(25);
    expect(result.sales!.pageViews).toBe(300);
    expect(result.sales!.contentViews).toBe(200);
    expect(result.sales!.checkoutInitiated).toBe(15);
    expect(result.sales!.messagesStarted).toBe(5);
    expect(result.sales!.liveViews).toBe(80);
  });
});
