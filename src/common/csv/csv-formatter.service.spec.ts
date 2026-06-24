import { Test, TestingModule } from '@nestjs/testing';
import { CsvFormatterService } from './csv-formatter.service.js';
import { MetaInsightsColumn } from '../../modules/campaign-reports/enums/insights-column.enum.js';
import { MetaInsights } from '../../modules/campaign-reports/interfaces/meta-campaign.interface.js';

const UTF8_BOM = '﻿';

const baseRow: MetaInsights = {
  campaign_id: '111',
  campaign_name: 'Black Friday',
  impressions: '125430',
  clicks: '3210',
  spend: '4850.50',
  reach: '98700',
  cpm: '38.66',
  cpc: '1.51',
  ctr: '2.56',
  frequency: '1.87',
  unique_clicks: '2105',
  cost_per_unique_click: '2.30',
  date_start: '2025-11-01',
  date_stop: '2025-11-30',
};

describe('CsvFormatterService', () => {
  let service: CsvFormatterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CsvFormatterService],
    }).compile();
    service = module.get(CsvFormatterService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  it('prefixes output with UTF-8 BOM', () => {
    const csv = service.format([baseRow], [MetaInsightsColumn.CAMPAIGN_NAME]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
  });

  it('generates PT-BR header labels in first line', () => {
    const csv = service.format([baseRow], [MetaInsightsColumn.CAMPAIGN_NAME, MetaInsightsColumn.IMPRESSIONS]);
    const lines = csv.replace(UTF8_BOM, '').split('\r\n');
    expect(lines[0]).toBe('Campanha,Impressões');
  });

  it('formats monetary values as R$ #.###,##', () => {
    const csv = service.format([baseRow], [MetaInsightsColumn.SPEND]);
    expect(csv).toContain('R$ 4.850,50');
  });

  it('formats percentage as #,##%', () => {
    const csv = service.format([baseRow], [MetaInsightsColumn.CTR]);
    expect(csv).toContain('2,56%');
  });

  it('formats count as integer with pt-BR thousand separator', () => {
    const csv = service.format([baseRow], [MetaInsightsColumn.IMPRESSIONS]);
    expect(csv).toContain('125.430');
  });

  it('formats decimal with two decimal places pt-BR', () => {
    const csv = service.format([baseRow], [MetaInsightsColumn.FREQUENCY]);
    expect(csv).toContain('1,87');
  });

  it('formats date YYYY-MM-DD → DD/MM/YYYY without timezone shift', () => {
    const csv = service.format([baseRow], [MetaInsightsColumn.DATE_START]);
    expect(csv).toContain('01/11/2025');
  });

  it('outputs "-" for missing field', () => {
    const row = { ...baseRow, spend: undefined as unknown as string };
    const csv = service.format([row], [MetaInsightsColumn.SPEND]);
    expect(csv).toContain('"-"');
  });

  it('wraps text containing comma in double quotes', () => {
    const row = { ...baseRow, campaign_name: 'Campanha, Outubro' };
    const csv = service.format([row], [MetaInsightsColumn.CAMPAIGN_NAME]);
    expect(csv).toContain('"Campanha, Outubro"');
  });

  it('escapes double quotes inside text fields', () => {
    const row = { ...baseRow, campaign_name: 'Black "Friday"' };
    const csv = service.format([row], [MetaInsightsColumn.CAMPAIGN_NAME]);
    expect(csv).toContain('"Black ""Friday"""');
  });

  it('extracts link_clicks from actions array', () => {
    const row: MetaInsights = {
      ...baseRow,
      actions: [
        { action_type: 'link_click', value: '1500' },
        { action_type: 'post_engagement', value: '5000' },
      ],
    };
    const csv = service.format([row], [MetaInsightsColumn.LINK_CLICKS]);
    expect(csv).toContain('1.500');
  });

  it('extracts purchase_roas from purchase_roas array', () => {
    const row: MetaInsights = {
      ...baseRow,
      purchase_roas: [{ action_type: 'omni_purchase', value: '3.20' }],
    };
    const csv = service.format([row], [MetaInsightsColumn.PURCHASE_ROAS]);
    expect(csv).toContain('3,20');
  });

  it('extracts video_plays from video_play_actions and sums values', () => {
    const row: MetaInsights = {
      ...baseRow,
      video_play_actions: [
        { action_type: 'video_view', value: '3000' },
        { action_type: 'video_view', value: '2000' },
      ],
    };
    const csv = service.format([row], [MetaInsightsColumn.VIDEO_PLAYS]);
    expect(csv).toContain('5.000');
  });

  it('outputs "-" when action_type not found in actions array', () => {
    const row: MetaInsights = {
      ...baseRow,
      actions: [{ action_type: 'post_engagement', value: '999' }],
    };
    const csv = service.format([row], [MetaInsightsColumn.PURCHASES]);
    expect(csv).toContain('"-"');
  });

  it('produces correct line count: 1 header + N data rows', () => {
    const rows = [baseRow, baseRow];
    const csv = service.format(rows, [MetaInsightsColumn.CAMPAIGN_NAME]);
    const lines = csv.replace(UTF8_BOM, '').split('\r\n');
    expect(lines).toHaveLength(3); // header + 2 data rows
  });
});
