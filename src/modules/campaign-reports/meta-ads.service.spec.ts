import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { MetaAdsService } from './meta-ads.service.js';
import { OAuthTokenExpiredException } from '../../common/exceptions/oauth-token-expired.exception.js';
import { MetaDatePreset, MetaInsightsLevel, MetaTimeIncrement } from './dto/get-insights-query.dto.js';
import { MetaApiPaginatedResponse, MetaCampaign, MetaInsights } from './interfaces/meta-campaign.interface.js';

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
    it('should return paginated response without cursor', async () => {
      const apiResponse: MetaApiPaginatedResponse<MetaCampaign> = { data: mockCampaigns, paging: {} };
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse(apiResponse)));

      const result = await service.fetchCampaigns('act_123', 'token-abc');

      expect(result).toEqual(apiResponse);
      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/act_123/campaigns',
        expect.objectContaining({
          params: expect.not.objectContaining({ after: expect.anything() }),
        }),
      );
    });

    it('should include after param when cursor is provided', async () => {
      const apiResponse: MetaApiPaginatedResponse<MetaCampaign> = {
        data: mockCampaigns,
        paging: { next: 'cursor_xyz', cursors: { before: 'b', after: 'cursor_xyz' } },
      };
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse(apiResponse)));

      const result = await service.fetchCampaigns('act_123', 'token-abc', 'cursor_abc');

      expect(result).toEqual(apiResponse);
      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/act_123/campaigns',
        expect.objectContaining({
          params: expect.objectContaining({ after: 'cursor_abc' }),
        }),
      );
    });

    it('should return empty paging on last page', async () => {
      const apiResponse: MetaApiPaginatedResponse<MetaCampaign> = { data: mockCampaigns, paging: {} };
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse(apiResponse)));

      const result = await service.fetchCampaigns('act_123', 'token-abc', 'last_cursor');

      expect(result.paging).toEqual({});
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
    it('should return paginated response without cursor', async () => {
      const apiResponse: MetaApiPaginatedResponse<MetaInsights> = { data: mockInsights, paging: {} };
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse(apiResponse)));

      const result = await service.fetchInsights('act_123', 'token-abc', {
        datePreset: MetaDatePreset.LAST_30D,
        level: MetaInsightsLevel.CAMPAIGN,
      });

      expect(result).toEqual(apiResponse);
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

    it('should include after param when cursor is provided', async () => {
      const apiResponse: MetaApiPaginatedResponse<MetaInsights> = { data: mockInsights, paging: {} };
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse(apiResponse)));

      await service.fetchInsights('act_123', 'token-abc', { datePreset: MetaDatePreset.LAST_7D }, 'cursor_abc');

      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({ after: 'cursor_abc' }),
        }),
      );
    });

    it('should include time_increment param when timeIncrement is provided', async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({ data: mockInsights, paging: {} })));

      await service.fetchInsights('act_123', 'token-abc', {
        datePreset: MetaDatePreset.LAST_7D,
        timeIncrement: MetaTimeIncrement.DAILY,
      });

      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({ time_increment: '1' }),
        }),
      );
    });

    it('should include breakdowns param when breakdowns is provided', async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({ data: mockInsights, paging: {} })));

      await service.fetchInsights('act_123', 'token-abc', {
        datePreset: MetaDatePreset.LAST_7D,
        breakdowns: 'age,gender',
      });

      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({ breakdowns: 'age,gender' }),
        }),
      );
    });

    it('should include both time_increment and breakdowns when both provided', async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({ data: mockInsights, paging: {} })));

      await service.fetchInsights('act_123', 'token-abc', {
        datePreset: MetaDatePreset.LAST_30D,
        timeIncrement: MetaTimeIncrement.DAILY,
        breakdowns: 'country',
      });

      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({
            time_increment: '1',
            breakdowns: 'country',
          }),
        }),
      );
    });

    it('should NOT include time_increment when timeIncrement is undefined', async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({ data: mockInsights, paging: {} })));

      await service.fetchInsights('act_123', 'token-abc', { datePreset: MetaDatePreset.LAST_7D });

      const callParams = mockHttpService.get.mock.calls[0][1].params;
      expect(callParams).not.toHaveProperty('time_increment');
      expect(callParams).not.toHaveProperty('breakdowns');
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
    it('should return single MetaInsights when no timeIncrement or breakdowns', async () => {
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

    it('should return full MetaApiPaginatedResponse when timeIncrement is provided', async () => {
      const apiResponse: MetaApiPaginatedResponse<MetaInsights> = {
        data: [
          { ...mockInsights[0], date_start: '2026-06-10', date_stop: '2026-06-10' },
          { ...mockInsights[0], date_start: '2026-06-11', date_stop: '2026-06-11' },
        ],
        paging: {},
      };
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse(apiResponse)));

      const result = await service.fetchCampaignInsights('111', 'token-abc', {
        datePreset: MetaDatePreset.LAST_7D,
        timeIncrement: MetaTimeIncrement.DAILY,
      });

      expect(result).toEqual(apiResponse);
      expect((result as MetaApiPaginatedResponse<MetaInsights>).data).toHaveLength(2);
    });

    it('should return full MetaApiPaginatedResponse when breakdowns are provided', async () => {
      const apiResponse: MetaApiPaginatedResponse<MetaInsights> = {
        data: [
          { ...mockInsights[0], age: '18-24', gender: 'male' },
          { ...mockInsights[0], age: '25-34', gender: 'female' },
        ],
        paging: {},
      };
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse(apiResponse)));

      const result = await service.fetchCampaignInsights('111', 'token-abc', {
        datePreset: MetaDatePreset.LAST_7D,
        breakdowns: 'age,gender',
      });

      expect(result).toEqual(apiResponse);
    });

    it('should NOT throw NotFoundException when timeIncrement provided and data is empty', async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({ data: [], paging: {} })));

      const result = await service.fetchCampaignInsights('111', 'token-abc', {
        datePreset: MetaDatePreset.LAST_7D,
        timeIncrement: MetaTimeIncrement.DAILY,
      });

      expect((result as MetaApiPaginatedResponse<MetaInsights>).data).toEqual([]);
    });

    it('should include time_increment and breakdowns in the HTTP call', async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({ data: mockInsights, paging: {} })));

      await service.fetchCampaignInsights('111', 'token-abc', {
        datePreset: MetaDatePreset.LAST_7D,
        timeIncrement: MetaTimeIncrement.WEEKLY,
        breakdowns: 'country',
      });

      expect(mockHttpService.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({
            time_increment: '7',
            breakdowns: 'country',
          }),
        }),
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

    it('should throw NotFoundException when Meta returns empty data array (no breakdowns)', async () => {
      mockHttpService.get.mockReturnValue(of(makeAxiosResponse({ data: [] })));

      await expect(
        service.fetchCampaignInsights('111', 'token-abc', { datePreset: MetaDatePreset.LAST_7D }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
