import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { MetaAdsService } from './meta-ads.service.js';
import { OAuthTokenExpiredException } from '../../common/exceptions/oauth-token-expired.exception.js';
import { MetaDatePreset, MetaInsightsLevel } from './dto/get-insights-query.dto.js';
import { MetaCampaign, MetaInsights } from './interfaces/meta-campaign.interface.js';

const mockCampaigns: MetaCampaign[] = [
  { id: '111', name: 'Campanha A', status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC', created_time: '2026-01-01T00:00:00Z' },
];

const mockInsights: MetaInsights[] = [
  {
    campaign_id: '111',
    campaign_name: 'Campanha A',
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

const mockHttpService = { get: jest.fn() };

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string) => {
    if (key === 'meta.graphApiUrl') return 'https://graph.facebook.com';
    if (key === 'meta-ads.apiVersion') return 'v21.0';
    return undefined;
  }),
};

const makeAxiosResponse = <T>(data: T): AxiosResponse<T> =>
  ({ data, status: 200, statusText: 'OK', headers: {}, config: {} as never });

describe('MetaAdsService', () => {
  let service: MetaAdsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetaAdsService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MetaAdsService>(MetaAdsService);
  });

  describe('fetchCampaigns', () => {
    it('should return campaigns from data array', async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({ data: mockCampaigns })));

      const result = await service.fetchCampaigns('act_123', 'token-abc');

      expect(result).toEqual(mockCampaigns);
      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/act_123/campaigns',
        expect.objectContaining({
          params: expect.objectContaining({ access_token: 'token-abc' }),
        }),
      );
    });

    it('should throw OAuthTokenExpiredException on error code 190', async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() => ({ response: { data: { error: { code: 190 } } } })),
      );

      await expect(service.fetchCampaigns('act_123', 'expired-token')).rejects.toThrow(
        OAuthTokenExpiredException,
      );
    });

    it('should rethrow generic errors without transforming', async () => {
      const genericError = new Error('Network error');
      mockHttpService.get.mockReturnValue(throwError(() => genericError));

      await expect(service.fetchCampaigns('act_123', 'token')).rejects.toThrow('Network error');
    });
  });

  describe('fetchInsights', () => {
    it('should pass date_preset and level params', async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({ data: mockInsights })));

      const result = await service.fetchInsights('act_123', 'token-abc', {
        datePreset: MetaDatePreset.LAST_30D,
        level: MetaInsightsLevel.CAMPAIGN,
      });

      expect(result).toEqual(mockInsights);
      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/act_123/insights',
        expect.objectContaining({
          params: expect.objectContaining({
            date_preset: 'last_30d',
            level: 'campaign',
          }),
        }),
      );
    });

    it('should throw OAuthTokenExpiredException on error code 190', async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() => ({ response: { data: { error: { code: 190 } } } })),
      );

      await expect(
        service.fetchInsights('act_123', 'token', { datePreset: MetaDatePreset.LAST_7D }),
      ).rejects.toThrow(OAuthTokenExpiredException);
    });
  });

  describe('fetchCampaignInsights', () => {
    it('should return first element of data array', async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({ data: mockInsights })));

      const result = await service.fetchCampaignInsights('111', 'token-abc', {
        datePreset: MetaDatePreset.LAST_7D,
      });

      expect(result).toEqual(mockInsights[0]);
      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/111/insights',
        expect.any(Object),
      );
    });

    it('should throw OAuthTokenExpiredException on error code 190', async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() => ({ response: { data: { error: { code: 190 } } } })),
      );

      await expect(
        service.fetchCampaignInsights('111', 'token', { datePreset: MetaDatePreset.LAST_7D }),
      ).rejects.toThrow(OAuthTokenExpiredException);
    });

    it('should throw NotFoundException when Meta returns empty data array', async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({ data: [] })));

      await expect(
        service.fetchCampaignInsights('111', 'token-abc', { datePreset: MetaDatePreset.LAST_7D }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
