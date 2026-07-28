import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServiceUnavailableException } from '@nestjs/common';
import { ReportDispatchesService } from './report-dispatches.service.js';
import { ReportDispatchLogEntity, DispatchStatus } from './entities/report-dispatch-log.entity.js';
import { CampaignReportsService } from '../campaign-reports/campaign-reports.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { WhatsAppGroupsService } from '../whatsapp-groups/whatsapp-groups.service.js';
import { WhatsAppSessionService } from '../whatsapp-session/whatsapp-session.service.js';

const mockLog = (status: DispatchStatus) =>
  Object.assign(new ReportDispatchLogEntity(), {
    id: 'log-uuid',
    clientId: 'client-uuid',
    groupJid: '120363000000@g.us',
    adAccountId: 'act_123',
    weekStartDate: new Date('2026-06-29'),
    status,
    errorMessage: status === DispatchStatus.FAILED ? 'erro' : null,
    sentAt: status === DispatchStatus.SENT ? new Date() : null,
  });

const mockInsightsResult = {
  data: [
    {
      impressions: '10000',
      clicks: '500',
      spend: '250.00',
      reach: '8000',
      cpm: '25.00',
      cpc: '0.50',
      ctr: '5.00',
      date_start: '2026-06-29',
      date_stop: '2026-07-05',
    },
  ],
  paging: { next: undefined },
};

describe('ReportDispatchesService', () => {
  let service: ReportDispatchesService;

  const mockLogRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((data: any) => Object.assign(new ReportDispatchLogEntity(), data)),
  };

  const mockCampaignReports = {
    getInsights: jest.fn(),
  } as unknown as CampaignReportsService;

  const mockAdAccounts = {
    findAll: jest.fn(),
  } as unknown as AdAccountsService;

  const mockWhatsAppGroups = {
    findAllActiveGroupedByClientId: jest.fn(),
  } as unknown as WhatsAppGroupsService;

  const mockWhatsAppSession = {
    sendMessage: jest.fn(),
  } as unknown as WhatsAppSessionService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportDispatchesService,
        { provide: getRepositoryToken(ReportDispatchLogEntity), useValue: mockLogRepo },
        { provide: CampaignReportsService, useValue: mockCampaignReports },
        { provide: AdAccountsService, useValue: mockAdAccounts },
        { provide: WhatsAppGroupsService, useValue: mockWhatsAppGroups },
        { provide: WhatsAppSessionService, useValue: mockWhatsAppSession },
      ],
    }).compile();

    service = module.get(ReportDispatchesService);

    jest.spyOn(service as any, 'randomDelay').mockResolvedValue(undefined);
  });

  describe('triggerForClient', () => {
    const setupCommonMocks = () => {
      const groupsMap = new Map([
        ['client-uuid', [{ groupJid: '120363000000@g.us' }]],
      ]);
      (mockWhatsAppGroups.findAllActiveGroupedByClientId as jest.Mock).mockResolvedValue(groupsMap);
      (mockAdAccounts.findAll as jest.Mock).mockResolvedValue([
        { adAccountId: 'act_123', accountName: 'Conta Teste', isActive: true },
      ]);
      (mockCampaignReports.getInsights as jest.Mock).mockResolvedValue(mockInsightsResult);
    };

    it('retorna dispatched=1, failed=0 quando sessão conectada', async () => {
      setupCommonMocks();
      (mockWhatsAppSession.sendMessage as jest.Mock).mockResolvedValue(undefined);
      mockLogRepo.save.mockResolvedValue(mockLog(DispatchStatus.SENT));
      mockLogRepo.findOne.mockResolvedValue(mockLog(DispatchStatus.SENT));

      const result = await service.triggerForClient({ clientId: 'client-uuid' });

      expect(result.dispatched).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockWhatsAppSession.sendMessage).toHaveBeenCalledWith(
        '120363000000@g.us',
        expect.any(String),
      );
    });

    it('retorna dispatched=0, failed=1 e salva log quando sessão desconectada', async () => {
      setupCommonMocks();
      (mockWhatsAppSession.sendMessage as jest.Mock).mockRejectedValue(
        new ServiceUnavailableException('Sessão WhatsApp não está conectada'),
      );
      mockLogRepo.save.mockResolvedValue(mockLog(DispatchStatus.FAILED));
      mockLogRepo.findOne.mockResolvedValue(mockLog(DispatchStatus.FAILED));

      const result = await service.triggerForClient({ clientId: 'client-uuid' });

      expect(result.dispatched).toBe(0);
      expect(result.failed).toBe(1);
      expect(mockLogRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: DispatchStatus.FAILED }),
      );
    });

    it('usa a última segunda-feira quando weekStartDate não é informado', async () => {
      setupCommonMocks();
      (mockWhatsAppSession.sendMessage as jest.Mock).mockResolvedValue(undefined);
      mockLogRepo.save.mockResolvedValue(mockLog(DispatchStatus.SENT));
      mockLogRepo.findOne.mockResolvedValue(mockLog(DispatchStatus.SENT));

      await service.triggerForClient({});

      const sinceArg = (mockCampaignReports.getInsights as jest.Mock).mock.calls[0][1].since;
      const sinceDate = new Date(sinceArg);
      expect(sinceDate.getUTCDay()).toBe(1);
    });
  });

  describe('findLogs', () => {
    it('retorna logs ordenados por createdAt DESC', async () => {
      const logs = [mockLog(DispatchStatus.SENT), mockLog(DispatchStatus.FAILED)];
      mockLogRepo.find.mockResolvedValue(logs);

      const result = await service.findLogs('client-uuid');

      expect(mockLogRepo.find).toHaveBeenCalledWith({
        where: { clientId: 'client-uuid' },
        order: { createdAt: 'DESC' },
      });
      expect(result).toBe(logs);
    });

    it('should return all logs when clientId is not provided', async () => {
      const allLogs = [
        { id: 'log-1', clientId: 'client-1' },
        { id: 'log-2', clientId: 'client-2' },
      ];
      mockLogRepo.find.mockResolvedValue(allLogs);

      const result = await service.findLogs(undefined);

      expect(result).toEqual(allLogs);
      expect(mockLogRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC' },
      });
    });

    it('should filter by clientId when provided', async () => {
      const filtered = [{ id: 'log-1', clientId: 'client-1' }];
      mockLogRepo.find.mockResolvedValue(filtered);

      const result = await service.findLogs('client-1');

      expect(result).toEqual(filtered);
      expect(mockLogRepo.find).toHaveBeenCalledWith({
        where: { clientId: 'client-1' },
        order: { createdAt: 'DESC' },
      });
    });
  });
});
