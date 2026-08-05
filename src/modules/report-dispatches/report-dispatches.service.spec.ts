import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ReportDispatchesService } from './report-dispatches.service.js';
import { ReportDispatchLogEntity, DispatchStatus } from './entities/report-dispatch-log.entity.js';
import { CampaignReportsService } from '../campaign-reports/campaign-reports.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { WhatsAppGroupsService } from '../whatsapp-groups/whatsapp-groups.service.js';
import { WhatsAppSessionService } from '../whatsapp-session/whatsapp-session.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { AiService } from '../ai/ai.service.js';
import { InsightSnapshotsService } from '../insight-snapshots/insight-snapshots.service.js';

const makeRepo = () => ({
  save: jest.fn(),
  create: jest.fn((v) => v),
  find: jest.fn(),
  findOne: jest.fn(),
});

async function buildService(overrides: Record<string, unknown> = {}) {
  const repo = makeRepo();
  const module = await Test.createTestingModule({
    providers: [
      ReportDispatchesService,
      { provide: getRepositoryToken(ReportDispatchLogEntity), useValue: repo },
      { provide: AiService, useValue: { generateReport: jest.fn().mockResolvedValue('texto da IA'), ...overrides.aiService } },
      { provide: InsightSnapshotsService, useValue: { saveSnapshot: jest.fn(), findPreviousSnapshot: jest.fn().mockResolvedValue(null), ...overrides.snapshotsService } },
      { provide: ClientsService, useValue: { findOne: jest.fn().mockResolvedValue({ aiStrategyContext: null }), ...overrides.clientsService } },
      { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(null) } },
      { provide: CampaignReportsService, useValue: { getInsights: jest.fn().mockResolvedValue({ data: [] }) } },
      { provide: AdAccountsService, useValue: { findAll: jest.fn().mockResolvedValue([]) } },
      { provide: WhatsAppGroupsService, useValue: { findAllActiveGroupedByClientId: jest.fn().mockResolvedValue(new Map()) } },
      { provide: WhatsAppSessionService, useValue: { sendMessage: jest.fn().mockResolvedValue(undefined) } },
    ],
  }).compile();
  return { service: module.get(ReportDispatchesService), repo };
}

describe('ReportDispatchesService', () => {
  describe('toInsightsSummary', () => {
    it('maps MetaInsights string fields to numeric InsightsSummary', async () => {
      const { service } = await buildService();
      const insights = {
        impressions: '1000', clicks: '50', spend: '100.50',
        reach: '500', cpm: '10.05', cpc: '2.01', ctr: '5.00',
        date_start: '2026-07-27', date_stop: '2026-08-02',
        actions: [
          { action_type: 'purchase', value: '3' },
          { action_type: 'add_to_cart', value: '10' },
          { action_type: 'landing_page_view', value: '80' },
        ],
      } as any;

      const result = (service as any).toInsightsSummary(insights);

      expect(result).toEqual({
        spend: 100.50, reach: 500, impressions: 1000, clicks: 50,
        ctr: 5.00, cpm: 10.05, purchases: 3, addToCart: 10, pageViews: 80,
      });
    });

    it('returns 0 for action types not present', async () => {
      const { service } = await buildService();
      const insights = {
        impressions: '100', clicks: '5', spend: '10', reach: '50',
        cpm: '1', cpc: '2', ctr: '5',
        date_start: '2026-07-27', date_stop: '2026-08-02',
      } as any;
      const result = (service as any).toInsightsSummary(insights);
      expect(result.purchases).toBe(0);
      expect(result.addToCart).toBe(0);
      expect(result.pageViews).toBe(0);
    });
  });

  describe('computeDeltas', () => {
    it('returns empty object when previous is null', async () => {
      const { service } = await buildService();
      const current = { spend: 100, reach: 500, impressions: 1000, clicks: 50, ctr: 5, cpm: 10, purchases: 3, addToCart: 10, pageViews: 80 };
      expect((service as any).computeDeltas(current, null)).toEqual({});
    });

    it('computes relative deltas correctly', async () => {
      const { service } = await buildService();
      const current =  { spend: 110, reach: 565, impressions: 1100, clicks: 55, ctr: 5, cpm: 10, purchases: 3, addToCart: 10, pageViews: 80 };
      const previous = { spend: 100, reach: 500, impressions: 1000, clicks: 50, ctr: 5, cpm: 10, purchases: 3, addToCart: 10, pageViews: 80 };
      const deltas = (service as any).computeDeltas(current, previous);
      expect(deltas.reach).toBeCloseTo(0.13, 2);
      expect(deltas.spend).toBeCloseTo(0.10, 2);
    });

    it('returns null for delta where previous value is 0', async () => {
      const { service } = await buildService();
      const current =  { spend: 100, reach: 500, impressions: 1000, clicks: 50, ctr: 5, cpm: 10, purchases: 3, addToCart: 0, pageViews: 80 };
      const previous = { spend: 100, reach: 500, impressions: 1000, clicks: 50, ctr: 5, cpm: 10, purchases: 0, addToCart: 0, pageViews: 80 };
      const deltas = (service as any).computeDeltas(current, previous);
      expect(deltas.purchases).toBeNull();
      expect(deltas.addToCart).toBeNull();
    });
  });

  describe('getISOWeekNumber', () => {
    it('returns 31 for 2026-07-27', async () => {
      const { service } = await buildService();
      expect((service as any).getISOWeekNumber(new Date('2026-07-27'))).toBe(31);
    });

    it('returns 1 for 2026-01-05', async () => {
      const { service } = await buildService();
      expect((service as any).getISOWeekNumber(new Date('2026-01-05'))).toBe(2);
    });
  });
});
