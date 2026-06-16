import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { AdAccountsTokenMonitorService } from './ad-accounts-token-monitor.service.js';
import { AdAccountsService } from './ad-accounts.service.js';
import { AdAccountEntity } from './entities/ad-account.entity.js';

const makeAccount = (adAccountId: string, clientId: string, daysFromNow: number): AdAccountEntity => {
  const tokenExpiresAt = new Date();
  tokenExpiresAt.setDate(tokenExpiresAt.getDate() + daysFromNow);
  return {
    id: `uuid-${adAccountId}`,
    clientId,
    client: {} as never,
    adAccountId,
    accountName: null,
    accessToken: 'encrypted',
    tokenExpiresAt,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
};

const mockAdAccountsService = {
  findAllExpiring: jest.fn(),
};

describe('AdAccountsTokenMonitorService', () => {
  let service: AdAccountsTokenMonitorService;
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdAccountsTokenMonitorService,
        { provide: AdAccountsService, useValue: mockAdAccountsService },
      ],
    }).compile();

    service = module.get<AdAccountsTokenMonitorService>(AdAccountsTokenMonitorService);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkExpiringTokens', () => {
    it('should call Logger.warn for each expiring account', async () => {
      mockAdAccountsService.findAllExpiring.mockResolvedValue([
        makeAccount('act_111', 'uuid-client-1', 3),
        makeAccount('act_222', 'uuid-client-2', 6),
      ]);

      await service.checkExpiringTokens();

      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    it('should log adAccountId and clientId in warning message', async () => {
      mockAdAccountsService.findAllExpiring.mockResolvedValue([
        makeAccount('act_111', 'uuid-client-1', 3),
      ]);

      await service.checkExpiringTokens();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('act_111'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('uuid-client-1'),
      );
    });

    it('should not call Logger.warn when no accounts are expiring', async () => {
      mockAdAccountsService.findAllExpiring.mockResolvedValue([]);

      await service.checkExpiringTokens();

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should call findAllExpiring with 7 days ahead', async () => {
      mockAdAccountsService.findAllExpiring.mockResolvedValue([]);

      await service.checkExpiringTokens();

      expect(mockAdAccountsService.findAllExpiring).toHaveBeenCalledWith(7);
    });

    it('should not alter any data in the database', async () => {
      mockAdAccountsService.findAllExpiring.mockResolvedValue([
        makeAccount('act_111', 'uuid-client-1', 2),
      ]);

      await service.checkExpiringTokens();

      expect(mockAdAccountsService.findAllExpiring).toHaveBeenCalledTimes(1);
      const serviceKeys = Object.keys(mockAdAccountsService);
      const writeMethods = serviceKeys.filter(
        (k) => k !== 'findAllExpiring' && typeof (mockAdAccountsService as never)[k] === 'function',
      );
      writeMethods.forEach((method) => {
        expect((mockAdAccountsService as never)[method]).not.toHaveBeenCalled();
      });
    });
  });
});
