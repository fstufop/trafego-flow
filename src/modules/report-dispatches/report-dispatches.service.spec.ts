import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ReportDispatchesService } from './report-dispatches.service.js';
import { AdsetMessageRow, LiveReportData } from '../ai/interfaces/ai-provider.interface.js';
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

async function buildService(overrides: Record<string, any> = {}) {
  const repo = makeRepo();
  const module = await Test.createTestingModule({
    providers: [
      ReportDispatchesService,
      { provide: getRepositoryToken(ReportDispatchLogEntity), useValue: repo },
      { provide: AiService, useValue: { generateReport: jest.fn().mockResolvedValue('texto da IA'), ...overrides.aiService } },
      { provide: InsightSnapshotsService, useValue: { saveSnapshot: jest.fn(), findPreviousSnapshot: jest.fn().mockResolvedValue(null), ...overrides.snapshotsService } },
      { provide: ClientsService, useValue: { findOne: jest.fn().mockResolvedValue({ aiStrategyContext: null, profileType: null }), ...overrides.clientsService } },
      { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(null) } },
      { provide: CampaignReportsService, useValue: {
        getInsights: jest.fn().mockResolvedValue({ data: [] }),
        getAdsetMessageRows: jest.fn().mockResolvedValue([]),
        getLiveReportData: jest.fn().mockResolvedValue([]),
        ...overrides.campaignReportsService,
      }},
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
          { action_type: 'view_content', value: '60' },
          { action_type: 'initiate_checkout', value: '5' },
          { action_type: 'messaging_conversation_started_7d', value: '2' },
          { action_type: 'video_play', value: '15' },
        ],
      } as any;

      const result = (service as any).toInsightsSummary(insights);

      expect(result).toEqual({
        spend: 100.50, reach: 500, impressions: 1000, clicks: 50,
        ctr: 5.00, cpm: 10.05, purchases: 3, addToCart: 10, pageViews: 80,
        contentViews: 60, checkoutInitiated: 5, messagesStarted: 2, liveViews: 15,
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
      expect(result.contentViews).toBe(0);
      expect(result.checkoutInitiated).toBe(0);
      expect(result.messagesStarted).toBe(0);
      expect(result.liveViews).toBe(0);
    });
  });

  describe('computeDeltas', () => {
    it('returns empty object when previous is null', async () => {
      const { service } = await buildService();
      const current = {
        spend: 100, reach: 500, impressions: 1000, clicks: 50, ctr: 5, cpm: 10,
        purchases: 3, addToCart: 10, pageViews: 80,
        contentViews: 60, checkoutInitiated: 5, messagesStarted: 2, liveViews: 15,
      };
      expect((service as any).computeDeltas(current, null)).toEqual({});
    });

    it('computes relative deltas correctly', async () => {
      const { service } = await buildService();
      const base = { spend: 100, reach: 500, impressions: 1000, clicks: 50, ctr: 5, cpm: 10, purchases: 3, addToCart: 10, pageViews: 80, contentViews: 60, checkoutInitiated: 5, messagesStarted: 2, liveViews: 15 };
      const current  = { ...base, spend: 110, reach: 565 };
      const previous = { ...base };
      const deltas = (service as any).computeDeltas(current, previous);
      expect(deltas.reach).toBeCloseTo(0.13, 2);
      expect(deltas.spend).toBeCloseTo(0.10, 2);
    });

    it('returns null for delta where previous value is 0', async () => {
      const { service } = await buildService();
      const current =  { spend: 100, reach: 500, impressions: 1000, clicks: 50, ctr: 5, cpm: 10, purchases: 3, addToCart: 0, pageViews: 80, contentViews: 60, checkoutInitiated: 5, messagesStarted: 2, liveViews: 15 };
      const previous = { spend: 100, reach: 500, impressions: 1000, clicks: 50, ctr: 5, cpm: 10, purchases: 0, addToCart: 0, pageViews: 80, contentViews: 60, checkoutInitiated: 5, messagesStarted: 2, liveViews: 15 };
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

  describe('findLogs', () => {
    it('should return all logs when clientId is not provided', async () => {
      const { service, repo } = await buildService();
      const allLogs = [
        { id: 'log-1', clientId: 'client-1' },
        { id: 'log-2', clientId: 'client-2' },
      ];
      repo.find.mockResolvedValue(allLogs);

      const result = await service.findLogs(undefined);

      expect(result).toEqual(allLogs);
      expect(repo.find).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC' },
      });
    });

    it('should filter by clientId when provided', async () => {
      const { service, repo } = await buildService();
      const filtered = [{ id: 'log-1', clientId: 'client-1' }];
      repo.find.mockResolvedValue(filtered);

      const result = await service.findLogs('client-1');

      expect(result).toEqual(filtered);
      expect(repo.find).toHaveBeenCalledWith({
        where: { clientId: 'client-1' },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('buildAndSend — branch por clientProfile', () => {
    it('chama getAdsetMessageRows e inclui adsetRows no payload para MESSAGE_SALES', async () => {
      const adsetRows: AdsetMessageRow[] = [
        { adsetName: 'Conjunto A', messagesStarted: 10, costPerMessage: 5, startDate: '01/08/26' },
      ];
      const mockGetAdsetRows = jest.fn().mockResolvedValue(adsetRows);
      const mockGetLiveData = jest.fn().mockResolvedValue([]);
      const generateReport = jest.fn().mockResolvedValue('texto');

      const { service } = await buildService({
        clientsService: { findOne: jest.fn().mockResolvedValue({ aiStrategyContext: null, profileType: 'message_sales' }) },
        campaignReportsService: {
          getInsights: jest.fn().mockResolvedValue({ data: [] }),
          getAdsetMessageRows: mockGetAdsetRows,
          getLiveReportData: mockGetLiveData,
        },
        aiService: { generateReport },
      });
      jest.spyOn(service as any, 'randomDelay').mockResolvedValue(undefined);

      await (service as any).buildAndSend(
        'client-1',
        { adAccountId: 'act_123', accountName: 'Conta' },
        [{ groupJid: 'jid@g.us' }],
        new Date('2026-09-14'),
      );

      const payload = generateReport.mock.calls[0]?.[0];
      expect(payload?.adsetRows).toEqual(adsetRows);
      expect(payload?.liveData).toBeUndefined();
    });

    it('chama getLiveReportData e inclui liveData no payload para LIVE_SALES', async () => {
      const liveData: LiveReportData[] = [
        { liveDate: '01/09/2026', captationSpend: 500, captationReach: 10000, captationClicks: 200, adReaches: [] },
      ];
      const mockGetAdsetRows = jest.fn().mockResolvedValue([]);
      const mockGetLiveData = jest.fn().mockResolvedValue(liveData);
      const generateReport = jest.fn().mockResolvedValue('texto');

      const { service } = await buildService({
        clientsService: { findOne: jest.fn().mockResolvedValue({ aiStrategyContext: null, profileType: 'live_sales' }) },
        campaignReportsService: {
          getInsights: jest.fn().mockResolvedValue({ data: [] }),
          getAdsetMessageRows: mockGetAdsetRows,
          getLiveReportData: mockGetLiveData,
        },
        aiService: { generateReport },
      });
      jest.spyOn(service as any, 'randomDelay').mockResolvedValue(undefined);

      await (service as any).buildAndSend(
        'client-1',
        { adAccountId: 'act_123', accountName: 'Conta' },
        [{ groupJid: 'jid@g.us' }],
        new Date('2026-09-14'),
      );

      const payload = generateReport.mock.calls[0]?.[0];
      expect(payload?.liveData).toEqual(liveData);
      expect(payload?.adsetRows).toBeUndefined();
    });

    it('não chama getAdsetMessageRows nem getLiveReportData para SITE_SALES', async () => {
      const mockGetAdsetRows = jest.fn().mockResolvedValue([]);
      const mockGetLiveData = jest.fn().mockResolvedValue([]);

      const { service } = await buildService({
        clientsService: { findOne: jest.fn().mockResolvedValue({ aiStrategyContext: null, profileType: 'site_sales' }) },
        campaignReportsService: {
          getInsights: jest.fn().mockResolvedValue({ data: [] }),
          getAdsetMessageRows: mockGetAdsetRows,
          getLiveReportData: mockGetLiveData,
        },
      });
      jest.spyOn(service as any, 'randomDelay').mockResolvedValue(undefined);

      await (service as any).buildAndSend(
        'client-1',
        { adAccountId: 'act_123', accountName: 'Conta' },
        [{ groupJid: 'jid@g.us' }],
        new Date('2026-09-14'),
      );

      expect(mockGetAdsetRows).not.toHaveBeenCalled();
      expect(mockGetLiveData).not.toHaveBeenCalled();
    });

    it('continua sem adsetRows quando getAdsetMessageRows lança erro', async () => {
      const generateReport = jest.fn().mockResolvedValue('texto');

      const { service } = await buildService({
        clientsService: { findOne: jest.fn().mockResolvedValue({ aiStrategyContext: null, profileType: 'message_sales' }) },
        campaignReportsService: {
          getInsights: jest.fn().mockResolvedValue({ data: [] }),
          getAdsetMessageRows: jest.fn().mockRejectedValue(new Error('API timeout')),
          getLiveReportData: jest.fn().mockResolvedValue([]),
        },
        aiService: { generateReport },
      });
      jest.spyOn(service as any, 'randomDelay').mockResolvedValue(undefined);

      await expect(
        (service as any).buildAndSend(
          'client-1',
          { adAccountId: 'act_123', accountName: 'Conta' },
          [{ groupJid: 'jid@g.us' }],
          new Date('2026-09-14'),
        ),
      ).resolves.not.toThrow();

      const payload = generateReport.mock.calls[0]?.[0];
      expect(payload?.adsetRows).toBeUndefined();
    });
  });
});
