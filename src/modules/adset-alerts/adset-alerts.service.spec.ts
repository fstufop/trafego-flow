import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { AdsetAlertsService } from './adset-alerts.service.js';
import { AdsetAlertSnapshotEntity } from './entities/adset-alert-snapshot.entity.js';
import { AlertJobsService } from '../alert-jobs/alert-jobs.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { CampaignReportsService } from '../campaign-reports/campaign-reports.service.js';
import { WhatsAppSessionService } from '../whatsapp-session/whatsapp-session.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { AlertJobStatus } from '../alert-jobs/enums/alert-job-status.enum.js';
import { AlertJobType } from '../alert-jobs/enums/alert-job-type.enum.js';

const mockSnapshotRepo = {
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};
const mockAlertJobsService = { findActive: jest.fn() };
const mockAdAccountsService = { findAll: jest.fn() };
const mockCampaignReportsService = {
  listAdsets: jest.fn(),
  getAdsetInsights: jest.fn(),
};
const mockWhatsAppSessionService = { sendMessage: jest.fn() };
const mockClientsService = { findAll: jest.fn() };
const mockConfigService = {
  get: jest.fn().mockReturnValue('managers_group@g.us'),
};

const makeJob = (overrides = {}) => ({
  id: 'job-uuid-1',
  type: AlertJobType.ADSET_INSIGHTS,
  status: AlertJobStatus.ACTIVE,
  clientId: null,
  fields: ['roas', 'last_updated'],
  ...overrides,
});

describe('AdsetAlertsService', () => {
  let service: AdsetAlertsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSnapshotRepo.create.mockImplementation((data: unknown) => data);
    mockSnapshotRepo.save.mockImplementation((data: unknown) =>
      Promise.resolve({ ...(data as object), id: 'snapshot-uuid' }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdsetAlertsService,
        {
          provide: getRepositoryToken(AdsetAlertSnapshotEntity),
          useValue: mockSnapshotRepo,
        },
        { provide: AlertJobsService, useValue: mockAlertJobsService },
        { provide: AdAccountsService, useValue: mockAdAccountsService },
        {
          provide: CampaignReportsService,
          useValue: mockCampaignReportsService,
        },
        {
          provide: WhatsAppSessionService,
          useValue: mockWhatsAppSessionService,
        },
        { provide: ClientsService, useValue: mockClientsService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<AdsetAlertsService>(AdsetAlertsService);
  });

  describe('formatMessage', () => {
    it('formats clients and adsets with bold WhatsApp syntax', () => {
      const map = new Map([
        [
          'c1',
          {
            clientName: 'Marca ABC',
            adsets: [
              {
                adsetName: 'CJ - Retargeting',
                roas: 3.42,
                updatedTime: '2026-08-05',
              },
              {
                adsetName: 'CJ - Prospecting',
                roas: 1.87,
                updatedTime: '2026-08-01',
              },
            ],
          },
        ],
      ]);

      const result = service.formatMessage(map, []);

      expect(result).toContain('*Nome do cliente*: Marca ABC');
      expect(result).toContain(
        '*Conjunto de anúncios*: CJ - Retargeting | *ROAS*: 3.42 | *Última atualização*: 05/08/2026',
      );
      expect(result).toContain(
        '*Conjunto de anúncios*: CJ - Prospecting | *ROAS*: 1.87 | *Última atualização*: 01/08/2026',
      );
    });

    it('displays – when ROAS is null', () => {
      const map = new Map([
        [
          'c1',
          {
            clientName: 'Loja XYZ',
            adsets: [
              { adsetName: 'CJ - Top', roas: null, updatedTime: '2026-08-03' },
            ],
          },
        ],
      ]);

      const result = service.formatMessage(map, []);

      expect(result).toContain('*ROAS*: –');
    });

    it('appends error footer when there are errors', () => {
      const map = new Map<string, { clientName: string; adsets: [] }>();
      const errors = ['Marca ZZZ / act_456: token expirado'];

      const result = service.formatMessage(map, errors);

      expect(result).toContain('⚠️ *Erros:*');
      expect(result).toContain('- Marca ZZZ / act_456: token expirado');
    });

    it('omits error footer when there are no errors', () => {
      const map = new Map([
        [
          'c1',
          {
            clientName: 'Marca ABC',
            adsets: [
              { adsetName: 'CJ - Test', roas: 2.0, updatedTime: '2026-08-01' },
            ],
          },
        ],
      ]);

      const result = service.formatMessage(map, []);

      expect(result).not.toContain('⚠️');
    });

    it('formats date as DD/MM/YYYY', () => {
      const map = new Map([
        [
          'c1',
          {
            clientName: 'Marca',
            adsets: [{ adsetName: 'CJ', roas: 1.0, updatedTime: '2026-01-09' }],
          },
        ],
      ]);

      const result = service.formatMessage(map, []);

      expect(result).toContain('09/01/2026');
    });

    it('skips clients with no adsets', () => {
      const map = new Map([
        ['c1', { clientName: 'Vazio', adsets: [] }],
        [
          'c2',
          {
            clientName: 'Com dados',
            adsets: [{ adsetName: 'CJ', roas: 1.0, updatedTime: '2026-08-01' }],
          },
        ],
      ]);

      const result = service.formatMessage(map, []);

      expect(result).not.toContain('Vazio');
      expect(result).toContain('Com dados');
    });
  });

  describe('runForJob', () => {
    it('skips inactive ad accounts', async () => {
      const job = makeJob({ clientId: 'client-1' });
      mockClientsService.findAll.mockResolvedValueOnce([
        { id: 'client-1', name: 'Marca' },
      ]);
      mockAdAccountsService.findAll.mockResolvedValueOnce([
        { adAccountId: 'act_123', isActive: false },
      ]);
      mockWhatsAppSessionService.sendMessage.mockResolvedValueOnce(undefined);

      await service.runForJob(job);

      expect(mockCampaignReportsService.listAdsets).not.toHaveBeenCalled();
    });

    it('accumulates error and continues when listAdsets throws', async () => {
      const job = makeJob({ clientId: 'client-1' });
      mockClientsService.findAll.mockResolvedValueOnce([
        { id: 'client-1', name: 'Marca' },
      ]);
      mockAdAccountsService.findAll.mockResolvedValueOnce([
        { adAccountId: 'act_123', isActive: true },
      ]);
      mockCampaignReportsService.listAdsets.mockRejectedValueOnce(
        new Error('API down'),
      );
      mockWhatsAppSessionService.sendMessage.mockResolvedValueOnce(undefined);

      await service.runForJob(job);

      expect(mockWhatsAppSessionService.sendMessage).toHaveBeenCalledWith(
        'managers_group@g.us',
        expect.stringContaining('⚠️ *Erros:*'),
      );
    });

    it('stores roas as null when ROAS value is 0', async () => {
      const job = makeJob({ clientId: 'client-1' });
      mockClientsService.findAll.mockResolvedValueOnce([
        { id: 'client-1', name: 'Marca' },
      ]);
      mockAdAccountsService.findAll.mockResolvedValueOnce([
        { adAccountId: 'act_123', isActive: true },
      ]);
      mockCampaignReportsService.listAdsets.mockResolvedValueOnce([
        {
          id: 'adset_1',
          name: 'CJ',
          updated_time: '2026-08-01T00:00:00+0000',
          effective_status: 'ACTIVE',
        },
      ]);
      mockCampaignReportsService.getAdsetInsights.mockResolvedValueOnce({
        purchase_roas: [{ action_type: 'omni_purchase', value: '0' }],
      });
      mockWhatsAppSessionService.sendMessage.mockResolvedValueOnce(undefined);

      await service.runForJob(job);

      expect(mockSnapshotRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ roas: null }),
      );
    });
  });
});
