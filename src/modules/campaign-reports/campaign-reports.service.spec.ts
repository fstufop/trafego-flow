import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CampaignReportsService } from './campaign-reports.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { MetaAdsService } from './meta-ads.service.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { AdAccountEntity } from '../ad-accounts/entities/ad-account.entity.js';
import { MetaDatePreset, MetaInsightsLevel } from './dto/get-insights-query.dto.js';
import { MetaCampaign, MetaInsights } from './interfaces/meta-campaign.interface.js';

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
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get<CampaignReportsService>(CampaignReportsService);
  });

  describe('listCampaigns', () => {
    it('should return cached campaigns without calling MetaAdsService', async () => {
      mockCache.get.mockResolvedValue(mockCampaigns);

      const result = await service.listCampaigns('act_123456789');

      expect(result).toEqual(mockCampaigns);
      expect(mockMetaAdsService.fetchCampaigns).not.toHaveBeenCalled();
    });

    it('should fetch from Meta API on cache miss and populate cache', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchCampaigns.mockResolvedValue(mockCampaigns);

      const result = await service.listCampaigns('act_123456789');

      expect(mockCrypto.decrypt).toHaveBeenCalledWith('encrypted-token');
      expect(mockMetaAdsService.fetchCampaigns).toHaveBeenCalledWith('act_123456789', 'plaintext-token');
      expect(mockCache.set).toHaveBeenCalledWith('meta:campaigns:act_123456789', mockCampaigns, 300000);
      expect(result).toEqual(mockCampaigns);
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
      mockCache.get.mockResolvedValue(mockInsights);

      const result = await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        datePreset: MetaDatePreset.LAST_30D,
        level: MetaInsightsLevel.CAMPAIGN,
      });

      expect(result).toEqual(mockInsights);
      expect(mockMetaAdsService.fetchInsights).not.toHaveBeenCalled();
    });

    it('should fetch from Meta API on cache miss', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchInsights.mockResolvedValue(mockInsights);

      const result = await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        datePreset: MetaDatePreset.LAST_30D,
        level: MetaInsightsLevel.CAMPAIGN,
      });

      expect(mockMetaAdsService.fetchInsights).toHaveBeenCalledWith(
        'act_123456789',
        'plaintext-token',
        { datePreset: MetaDatePreset.LAST_30D, level: MetaInsightsLevel.CAMPAIGN },
      );
      expect(result).toEqual(mockInsights);
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
