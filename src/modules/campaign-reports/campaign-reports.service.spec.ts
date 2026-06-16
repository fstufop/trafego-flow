import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CampaignReportsService } from './campaign-reports.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { MetaAdsService } from './meta-ads.service.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { AdAccountEntity } from '../ad-accounts/entities/ad-account.entity.js';
import { MetaDatePreset, MetaInsightsLevel } from './dto/get-insights-query.dto.js';
import { MetaApiPaginatedResponse, MetaCampaign, MetaInsights } from './interfaces/meta-campaign.interface.js';

const mockAccount: AdAccountEntity = {
  id: 'uuid-acc-1',
  clientId: 'uuid-client-1',
  client: {} as never,
  adAccountId: 'act_123456789',
  accountName: 'Conta Principal',
  accessToken: 'encrypted-token',
  tokenExpiresAt: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const mockCampaigns: MetaCampaign[] = [
  { id: '111', name: 'Campanha A', status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC', created_time: '2026-01-01T00:00:00Z' },
];

const mockInsights: MetaInsights[] = [
  {
    campaign_id: '111',
    impressions: '10000',
    clicks: '500',
    spend: '150.00',
    reach: '9000',
    cpm: '15.00',
    cpc: '0.30',
    ctr: '5.00',
    date_start: '2026-05-01',
    date_stop: '2026-05-31',
  },
];

const mockCampaignsApiResponse: MetaApiPaginatedResponse<MetaCampaign> = {
  data: mockCampaigns,
  paging: { cursors: { before: 'b', after: 'next_cursor' } },
};

const mockInsightsApiResponse: MetaApiPaginatedResponse<MetaInsights> = {
  data: mockInsights,
  paging: {},
};

const mockAdAccountsService = {
  findByAdAccountId: jest.fn(),
};

const mockMetaAdsService = {
  fetchCampaigns: jest.fn(),
  fetchInsights: jest.fn(),
  fetchCampaignInsights: jest.fn(),
};

const mockCrypto = {
  decrypt: jest.fn().mockReturnValue('plaintext-token'),
};

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string) => {
    if (key === 'meta-ads.insightsCacheTtlSeconds') return 300;
    return undefined;
  }),
};

describe('CampaignReportsService', () => {
  let service: CampaignReportsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignReportsService,
        { provide: AdAccountsService, useValue: mockAdAccountsService },
        { provide: MetaAdsService, useValue: mockMetaAdsService },
        { provide: AesCryptoService, useValue: mockCrypto },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get<CampaignReportsService>(CampaignReportsService);
  });

  describe('listCampaigns', () => {
    it('should return cached result without calling MetaAdsService', async () => {
      const cached = { data: mockCampaigns, paging: {} };
      mockCache.get.mockResolvedValue(cached);

      const result = await service.listCampaigns('act_123456789');

      expect(result).toEqual(cached);
      expect(mockMetaAdsService.fetchCampaigns).not.toHaveBeenCalled();
    });

    it('should use base cache key without cursor', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchCampaigns.mockResolvedValue(mockCampaignsApiResponse);

      await service.listCampaigns('act_123456789');

      expect(mockCache.get).toHaveBeenCalledWith('meta:campaigns:act_123456789');
      expect(mockCache.set).toHaveBeenCalledWith(
        'meta:campaigns:act_123456789',
        expect.objectContaining({ data: mockCampaigns }),
        300000,
      );
    });

    it('should use cursor-namespaced cache key when cursor provided', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchCampaigns.mockResolvedValue(mockCampaignsApiResponse);

      await service.listCampaigns('act_123456789', 'cursor_abc');

      expect(mockCache.get).toHaveBeenCalledWith('meta:campaigns:act_123456789:cursor:cursor_abc');
      expect(mockCache.set).toHaveBeenCalledWith(
        'meta:campaigns:act_123456789:cursor:cursor_abc',
        expect.anything(),
        300000,
      );
    });

    it('should return PaginatedResult with paging.next from cursors.after', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchCampaigns.mockResolvedValue(mockCampaignsApiResponse);

      const result = await service.listCampaigns('act_123456789');

      expect(result).toEqual({ data: mockCampaigns, paging: { next: 'next_cursor' } });
    });

    it('should return empty paging when no next cursor', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchCampaigns.mockResolvedValue({ data: mockCampaigns, paging: {} });

      const result = await service.listCampaigns('act_123456789');

      expect(result).toEqual({ data: mockCampaigns, paging: { next: undefined } });
    });

    it('should use configurable TTL from ConfigService', async () => {
      const localConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'meta-ads.insightsCacheTtlSeconds') return 600;
          return undefined;
        }),
      };
      const localCache = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchCampaigns.mockResolvedValue({ data: mockCampaigns, paging: {} });

      const module = await Test.createTestingModule({
        providers: [
          CampaignReportsService,
          { provide: AdAccountsService, useValue: mockAdAccountsService },
          { provide: MetaAdsService, useValue: mockMetaAdsService },
          { provide: AesCryptoService, useValue: mockCrypto },
          { provide: ConfigService, useValue: localConfigService },
          { provide: CACHE_MANAGER, useValue: localCache },
        ],
      }).compile();

      const localService = module.get<CampaignReportsService>(CampaignReportsService);
      await localService.listCampaigns('act_123456789');

      expect(localCache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        600000,
      );
    });

    it('should throw UnprocessableEntityException for inactive account', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue({ ...mockAccount, isActive: false });

      await expect(service.listCampaigns('act_123456789')).rejects.toThrow(UnprocessableEntityException);
    });

    it('should propagate NotFoundException from AdAccountsService', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockRejectedValue(new NotFoundException('not found'));

      await expect(service.listCampaigns('act_inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getInsights', () => {
    it('should return cached insights without calling MetaAdsService', async () => {
      const cached = { data: mockInsights, paging: {} };
      mockCache.get.mockResolvedValue(cached);

      const result = await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        datePreset: MetaDatePreset.LAST_30D,
        level: MetaInsightsLevel.CAMPAIGN,
      });

      expect(result).toEqual(cached);
      expect(mockMetaAdsService.fetchInsights).not.toHaveBeenCalled();
    });

    it('should use cursor-namespaced cache key when cursor provided', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchInsights.mockResolvedValue(mockInsightsApiResponse);

      await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        datePreset: MetaDatePreset.LAST_30D,
        level: MetaInsightsLevel.CAMPAIGN,
        cursor: 'cursor_abc',
      });

      expect(mockCache.get).toHaveBeenCalledWith(
        'meta:insights:act_123456789:campaign:last_30d:cursor:cursor_abc',
      );
    });

    it('should fetch from Meta API on cache miss', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchInsights.mockResolvedValue(mockInsightsApiResponse);

      const result = await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        datePreset: MetaDatePreset.LAST_30D,
        level: MetaInsightsLevel.CAMPAIGN,
      });

      expect(mockMetaAdsService.fetchInsights).toHaveBeenCalledWith(
        'act_123456789',
        'plaintext-token',
        { datePreset: MetaDatePreset.LAST_30D, level: MetaInsightsLevel.CAMPAIGN },
        undefined,
      );
      expect(result).toEqual({ data: mockInsights, paging: { next: undefined } });
    });
  });

  describe('getCampaignInsights', () => {
    it('should return cached campaign insight without calling MetaAdsService', async () => {
      mockCache.get.mockResolvedValue(mockInsights[0]);

      const result = await service.getCampaignInsights('111', 'act_123456789', MetaDatePreset.LAST_7D);

      expect(result).toEqual(mockInsights[0]);
      expect(mockMetaAdsService.fetchCampaignInsights).not.toHaveBeenCalled();
    });

    it('should fetch from Meta API on cache miss', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchCampaignInsights.mockResolvedValue(mockInsights[0]);

      const result = await service.getCampaignInsights('111', 'act_123456789', MetaDatePreset.LAST_7D);

      expect(mockMetaAdsService.fetchCampaignInsights).toHaveBeenCalledWith(
        '111',
        'plaintext-token',
        { datePreset: MetaDatePreset.LAST_7D },
      );
      expect(mockCache.set).toHaveBeenCalledWith(
        'meta:insights:campaign:111:last_7d',
        mockInsights[0],
        300000,
      );
      expect(result).toEqual(mockInsights[0]);
    });
  });
});
