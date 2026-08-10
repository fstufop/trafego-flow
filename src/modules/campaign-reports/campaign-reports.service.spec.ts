import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CampaignReportsService } from './campaign-reports.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { MetaAdsService } from './meta-ads.service.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { CsvFormatterService } from '../../common/csv/csv-formatter.service.js';
import { AdAccountEntity } from '../ad-accounts/entities/ad-account.entity.js';
import { MetaDatePreset, MetaInsightsLevel, MetaTimeIncrement } from './dto/get-insights-query.dto.js';
import { MetaAdset, MetaApiPaginatedResponse, MetaCampaign, MetaInsights } from './interfaces/meta-campaign.interface.js';
import { MetaInsightsColumn } from './enums/insights-column.enum.js';
import { ExportInsightsCsvDto } from './dto/export-insights-csv.dto.js';

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

const mockAdAccountsService = { findByAdAccountId: jest.fn() };
const mockMetaAdsService = {
  fetchCampaigns: jest.fn(),
  fetchInsights: jest.fn(),
  fetchCampaignInsights: jest.fn(),
  fetchAdCreatives: jest.fn(),
  fetchAdsets: jest.fn(),
  fetchAdsetInsights: jest.fn(),
};
const mockCrypto = { decrypt: jest.fn().mockReturnValue('plaintext-token') };
const mockCache = { get: jest.fn(), set: jest.fn() };
const mockConfigService = {
  get: jest.fn().mockImplementation((key: string) => {
    if (key === 'meta-ads.insightsCacheTtlSeconds') return 300;
    return undefined;
  }),
};
const mockCsvFormatter = { format: jest.fn().mockReturnValue('csv-output') };

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
        { provide: CsvFormatterService, useValue: mockCsvFormatter },
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
    });

    it('should return PaginatedResult with paging.next from cursors.after', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchCampaigns.mockResolvedValue(mockCampaignsApiResponse);

      const result = await service.listCampaigns('act_123456789');

      expect(result).toEqual({ data: mockCampaigns, paging: { next: 'next_cursor' } });
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

  describe('getInsights — cache key builder', () => {
    beforeEach(() => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchInsights.mockResolvedValue(mockInsightsApiResponse);
    });

    it('should use base cache key without timeIncrement or breakdowns', async () => {
      await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        datePreset: MetaDatePreset.LAST_30D,
        level: MetaInsightsLevel.CAMPAIGN,
      });

      expect(mockCache.get).toHaveBeenCalledWith('meta:insights:act_123456789:campaign:last_30d');
    });

    it('should include timeIncrement in cache key', async () => {
      await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        datePreset: MetaDatePreset.LAST_30D,
        level: MetaInsightsLevel.CAMPAIGN,
        timeIncrement: MetaTimeIncrement.DAILY,
      });

      expect(mockCache.get).toHaveBeenCalledWith('meta:insights:act_123456789:campaign:last_30d:ti:1');
      expect(mockCache.set).toHaveBeenCalledWith(
        'meta:insights:act_123456789:campaign:last_30d:ti:1',
        expect.anything(),
        300000,
      );
    });

    it('should include sorted breakdowns in cache key', async () => {
      await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        datePreset: MetaDatePreset.LAST_30D,
        breakdowns: 'gender,age',
      });

      // breakdowns should be sorted alphabetically: age,gender
      expect(mockCache.get).toHaveBeenCalledWith(
        'meta:insights:act_123456789:campaign:last_30d:bd:age,gender',
      );
    });

    it('should produce same cache key regardless of breakdown order', async () => {
      // First call: gender,age
      await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        datePreset: MetaDatePreset.LAST_30D,
        breakdowns: 'gender,age',
      });
      const firstKey = mockCache.get.mock.calls[0][0];

      jest.clearAllMocks();
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchInsights.mockResolvedValue(mockInsightsApiResponse);

      // Second call: age,gender
      await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        datePreset: MetaDatePreset.LAST_30D,
        breakdowns: 'age,gender',
      });
      const secondKey = mockCache.get.mock.calls[0][0];

      expect(firstKey).toBe(secondKey);
    });

    it('should include both timeIncrement and breakdowns in cache key', async () => {
      await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        datePreset: MetaDatePreset.LAST_7D,
        timeIncrement: MetaTimeIncrement.DAILY,
        breakdowns: 'country',
      });

      expect(mockCache.get).toHaveBeenCalledWith(
        'meta:insights:act_123456789:campaign:last_7d:ti:1:bd:country',
      );
    });

    it('should use TTL from ConfigService', async () => {
      await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        datePreset: MetaDatePreset.LAST_30D,
      });

      expect(mockCache.set).toHaveBeenCalledWith(expect.any(String), expect.anything(), 300000);
    });

    it('should pass timeIncrement and breakdowns to MetaAdsService.fetchInsights', async () => {
      await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        datePreset: MetaDatePreset.LAST_7D,
        timeIncrement: MetaTimeIncrement.WEEKLY,
        breakdowns: 'age,gender',
      });

      expect(mockMetaAdsService.fetchInsights).toHaveBeenCalledWith(
        'act_123456789',
        'plaintext-token',
        expect.objectContaining({
          timeIncrement: MetaTimeIncrement.WEEKLY,
          breakdowns: 'age,gender',
        }),
        undefined,
      );
    });

    it('should return cached insights on cache hit without calling MetaAdsService', async () => {
      const cached = { data: mockInsights, paging: {} };
      mockCache.get.mockResolvedValue(cached);

      const result = await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        datePreset: MetaDatePreset.LAST_30D,
        timeIncrement: MetaTimeIncrement.DAILY,
      });

      expect(result).toEqual(cached);
      expect(mockMetaAdsService.fetchInsights).not.toHaveBeenCalled();
    });
  });

  describe('getInsights — thumbnails', () => {
    const adLevelInsights: MetaInsights[] = [
      { ...mockInsights[0], ad_id: 'ad_1', ad_name: 'Anúncio 1' },
      { ...mockInsights[0], ad_id: 'ad_2', ad_name: 'Anúncio 2' },
    ];

    beforeEach(() => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchInsights.mockResolvedValue({ data: adLevelInsights, paging: {} });
    });

    it('should throw BadRequestException when includeThumbnails is used without level=ad', async () => {
      await expect(
        service.getInsights('act_123456789', {
          adAccountId: 'act_123456789',
          includeThumbnails: true,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockMetaAdsService.fetchInsights).not.toHaveBeenCalled();
    });

    it('should enrich rows with thumbnail_url, image_url and instagram_permalink_url from ad creatives', async () => {
      mockMetaAdsService.fetchAdCreatives.mockResolvedValue({
        ad_1: {
          id: 'cr_1',
          thumbnail_url: 'https://cdn.fb/t1.jpg',
          image_url: 'https://cdn.fb/i1.jpg',
          instagram_permalink_url: 'https://www.instagram.com/p/ABC123/',
        },
      });

      const result = await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        level: MetaInsightsLevel.AD,
        includeThumbnails: true,
      });

      expect(mockMetaAdsService.fetchAdCreatives).toHaveBeenCalledWith(
        ['ad_1', 'ad_2'],
        'plaintext-token',
      );
      expect(result.data[0]).toMatchObject({
        ad_id: 'ad_1',
        thumbnail_url: 'https://cdn.fb/t1.jpg',
        image_url: 'https://cdn.fb/i1.jpg',
        instagram_permalink_url: 'https://www.instagram.com/p/ABC123/',
      });
      // ad_2 sem creative retornado permanece sem thumbnail
      expect(result.data[1].thumbnail_url).toBeUndefined();
      expect(result.data[1].instagram_permalink_url).toBeUndefined();
    });

    it('should include :thumbs in cache key when includeThumbnails is true', async () => {
      mockMetaAdsService.fetchAdCreatives.mockResolvedValue({});

      await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        datePreset: MetaDatePreset.LAST_7D,
        level: MetaInsightsLevel.AD,
        includeThumbnails: true,
      });

      expect(mockCache.get).toHaveBeenCalledWith('meta:insights:act_123456789:ad:last_7d:thumbs');
    });

    it('should NOT call fetchAdCreatives when includeThumbnails is false', async () => {
      await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        level: MetaInsightsLevel.AD,
      });

      expect(mockMetaAdsService.fetchAdCreatives).not.toHaveBeenCalled();
    });

    it('should return rows without thumbnails when creative fetch fails (best-effort)', async () => {
      mockMetaAdsService.fetchAdCreatives.mockRejectedValue(new Error('Meta API down'));

      const result = await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        level: MetaInsightsLevel.AD,
        includeThumbnails: true,
      });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].thumbnail_url).toBeUndefined();
    });

    it('should NOT call fetchAdCreatives when no row has ad_id', async () => {
      mockMetaAdsService.fetchInsights.mockResolvedValue({ data: mockInsights, paging: {} });

      await service.getInsights('act_123456789', {
        adAccountId: 'act_123456789',
        level: MetaInsightsLevel.AD,
        includeThumbnails: true,
      });

      expect(mockMetaAdsService.fetchAdCreatives).not.toHaveBeenCalled();
    });
  });

  describe('getCampaignInsights', () => {
    it('should return cached single insight on cache hit', async () => {
      mockCache.get.mockResolvedValue(mockInsights[0]);

      const result = await service.getCampaignInsights('111', 'act_123456789', MetaDatePreset.LAST_7D);

      expect(result).toEqual(mockInsights[0]);
      expect(mockMetaAdsService.fetchCampaignInsights).not.toHaveBeenCalled();
    });

    it('should return single MetaInsights when no timeIncrement or breakdowns', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchCampaignInsights.mockResolvedValue(mockInsights[0]);

      const result = await service.getCampaignInsights('111', 'act_123456789', MetaDatePreset.LAST_7D);

      expect(result).toEqual(mockInsights[0]);
      expect(mockCache.set).toHaveBeenCalledWith(
        'meta:insights:campaign:111:last_7d',
        mockInsights[0],
        300000,
      );
    });

    it('should return PaginatedResult when timeIncrement is provided', async () => {
      const apiResponse: MetaApiPaginatedResponse<MetaInsights> = {
        data: [
          { ...mockInsights[0], date_start: '2026-06-10', date_stop: '2026-06-10' },
          { ...mockInsights[0], date_start: '2026-06-11', date_stop: '2026-06-11' },
        ],
        paging: {},
      };
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchCampaignInsights.mockResolvedValue(apiResponse);

      const result = await service.getCampaignInsights(
        '111', 'act_123456789', MetaDatePreset.LAST_7D, MetaTimeIncrement.DAILY,
      );

      expect(result).toEqual({ data: apiResponse.data, paging: { next: undefined } });
    });

    it('should return PaginatedResult when breakdowns are provided', async () => {
      const apiResponse: MetaApiPaginatedResponse<MetaInsights> = {
        data: [
          { ...mockInsights[0], age: '18-24', gender: 'male' },
          { ...mockInsights[0], age: '25-34', gender: 'female' },
        ],
        paging: {},
      };
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchCampaignInsights.mockResolvedValue(apiResponse);

      const result = await service.getCampaignInsights(
        '111', 'act_123456789', MetaDatePreset.LAST_30D, undefined, 'age,gender',
      );

      expect(result).toEqual({ data: apiResponse.data, paging: { next: undefined } });
    });

    it('should use timeIncrement in cache key for getCampaignInsights', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchCampaignInsights.mockResolvedValue({ data: mockInsights, paging: {} });

      await service.getCampaignInsights(
        '111', 'act_123456789', MetaDatePreset.LAST_7D, MetaTimeIncrement.DAILY,
      );

      expect(mockCache.get).toHaveBeenCalledWith('meta:insights:campaign:111:last_7d:ti:1');
      expect(mockCache.set).toHaveBeenCalledWith(
        'meta:insights:campaign:111:last_7d:ti:1',
        expect.anything(),
        300000,
      );
    });

    it('should use sorted breakdowns in cache key for getCampaignInsights', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchCampaignInsights.mockResolvedValue({ data: mockInsights, paging: {} });

      await service.getCampaignInsights(
        '111', 'act_123456789', MetaDatePreset.LAST_30D, undefined, 'gender,age',
      );

      expect(mockCache.get).toHaveBeenCalledWith(
        'meta:insights:campaign:111:last_30d:bd:age,gender',
      );
    });

    it('should use base cache key when no timeIncrement or breakdowns', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchCampaignInsights.mockResolvedValue(mockInsights[0]);

      await service.getCampaignInsights('111', 'act_123456789', MetaDatePreset.LAST_30D);

      expect(mockCache.get).toHaveBeenCalledWith('meta:insights:campaign:111:last_30d');
    });

    it('should throw UnprocessableEntityException for inactive account', async () => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue({ ...mockAccount, isActive: false });

      await expect(
        service.getCampaignInsights('111', 'act_123456789', MetaDatePreset.LAST_7D),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('exportInsightsCsv', () => {
    const baseExportDto: ExportInsightsCsvDto = {
      adAccountId: 'act_123456789',
      datePreset: MetaDatePreset.LAST_30D,
      level: MetaInsightsLevel.CAMPAIGN,
    };

    const singlePageResponse: MetaApiPaginatedResponse<MetaInsights> = {
      data: mockInsights,
      paging: {},
    };

    beforeEach(() => {
      mockCache.get.mockResolvedValue(null);
      mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
      mockMetaAdsService.fetchInsights.mockResolvedValue(singlePageResponse);
      mockCsvFormatter.format.mockReturnValue('csv-output');
    });

    it('returns csv string from CsvFormatterService', async () => {
      const result = await service.exportInsightsCsv(baseExportDto);
      expect(result).toBe('csv-output');
      expect(mockCsvFormatter.format).toHaveBeenCalledWith(mockInsights, expect.any(Array));
    });

    it('uses all non-breakdown columns when columns is not provided', async () => {
      await service.exportInsightsCsv(baseExportDto);
      const [, columns] = mockCsvFormatter.format.mock.calls[0] as [MetaInsights[], MetaInsightsColumn[]];
      expect(columns).not.toContain(MetaInsightsColumn.AGE);
      expect(columns).not.toContain(MetaInsightsColumn.GENDER);
      expect(columns).toContain(MetaInsightsColumn.SPEND);
    });

    it('includes breakdown columns when breakdowns param matches', async () => {
      await service.exportInsightsCsv({ ...baseExportDto, breakdowns: 'age,gender' });
      const [, columns] = mockCsvFormatter.format.mock.calls[0] as [MetaInsights[], MetaInsightsColumn[]];
      expect(columns).toContain(MetaInsightsColumn.AGE);
      expect(columns).toContain(MetaInsightsColumn.GENDER);
      expect(columns).not.toContain(MetaInsightsColumn.COUNTRY);
    });

    it('uses only selected columns when columns array is provided', async () => {
      const selected = [MetaInsightsColumn.CAMPAIGN_NAME, MetaInsightsColumn.SPEND];
      await service.exportInsightsCsv({ ...baseExportDto, columns: selected });
      const [, columns] = mockCsvFormatter.format.mock.calls[0] as [MetaInsights[], MetaInsightsColumn[]];
      expect(columns).toEqual(selected);
    });

    it('throws BadRequestException when datePreset and since are both provided', async () => {
      await expect(
        service.exportInsightsCsv({ ...baseExportDto, since: '2025-11-01', until: '2025-11-30' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when since is provided without until', async () => {
      await expect(
        service.exportInsightsCsv({ adAccountId: 'act_123456789', since: '2025-11-01' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when until is provided without since', async () => {
      await expect(
        service.exportInsightsCsv({ adAccountId: 'act_123456789', until: '2025-11-30' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('uses since/until cache key when since and until are provided', async () => {
      await service.exportInsightsCsv({
        adAccountId: 'act_123456789',
        since: '2025-11-01',
        until: '2025-11-30',
        level: MetaInsightsLevel.CAMPAIGN,
      });
      expect(mockCache.get).toHaveBeenCalledWith(
        'meta:insights:act_123456789:campaign:since:2025-11-01:until:2025-11-30',
      );
    });

    it('passes time_range params to MetaAdsService when since/until provided', async () => {
      await service.exportInsightsCsv({
        adAccountId: 'act_123456789',
        since: '2025-11-01',
        until: '2025-11-30',
        level: MetaInsightsLevel.CAMPAIGN,
      });
      expect(mockMetaAdsService.fetchInsights).toHaveBeenCalledWith(
        'act_123456789',
        'plaintext-token',
        expect.objectContaining({ since: '2025-11-01', until: '2025-11-30' }),
        undefined,
      );
    });

    it('accumulates all rows across multiple pages via cursor loop', async () => {
      const page1: MetaApiPaginatedResponse<MetaInsights> = {
        data: [{ ...mockInsights[0], impressions: '1000' }],
        paging: { cursors: { before: 'b', after: 'cursor2' } },
      };
      const page2: MetaApiPaginatedResponse<MetaInsights> = {
        data: [{ ...mockInsights[0], impressions: '2000' }],
        paging: {},
      };
      mockMetaAdsService.fetchInsights
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2);

      await service.exportInsightsCsv(baseExportDto);

      const [rows] = mockCsvFormatter.format.mock.calls[0] as [MetaInsights[], MetaInsightsColumn[]];
      expect(rows).toHaveLength(2);
      expect(mockMetaAdsService.fetchInsights).toHaveBeenCalledTimes(2);
    });

    it('uses cache hit for second page without calling MetaAdsService again', async () => {
      const cachedPage = { data: mockInsights, paging: {} };
      mockCache.get.mockResolvedValue(cachedPage);

      await service.exportInsightsCsv(baseExportDto);

      expect(mockMetaAdsService.fetchInsights).not.toHaveBeenCalled();
    });

    it('defaults to last_30d when no period provided', async () => {
      await service.exportInsightsCsv({ adAccountId: 'act_123456789' });
      expect(mockCache.get).toHaveBeenCalledWith(
        'meta:insights:act_123456789:campaign:last_30d',
      );
    });

    it('excludes thumbnail_url and instagram_permalink_url columns by default', async () => {
      await service.exportInsightsCsv(baseExportDto);
      const [, columns] = mockCsvFormatter.format.mock.calls[0] as [MetaInsights[], MetaInsightsColumn[]];
      expect(columns).not.toContain(MetaInsightsColumn.THUMBNAIL_URL);
      expect(columns).not.toContain(MetaInsightsColumn.INSTAGRAM_PERMALINK_URL);
    });

    it('throws BadRequestException when includeThumbnails is used without level=ad', async () => {
      await expect(
        service.exportInsightsCsv({ ...baseExportDto, includeThumbnails: true }),
      ).rejects.toThrow(BadRequestException);
    });

    it('includes thumbnail_url column and enriches rows when includeThumbnails with level=ad', async () => {
      const adRows: MetaInsights[] = [{ ...mockInsights[0], ad_id: 'ad_1', ad_name: 'Anúncio 1' }];
      mockMetaAdsService.fetchInsights.mockResolvedValue({ data: adRows, paging: {} });
      mockMetaAdsService.fetchAdCreatives.mockResolvedValue({
        ad_1: {
          id: 'cr_1',
          thumbnail_url: 'https://cdn.fb/t1.jpg',
          instagram_permalink_url: 'https://www.instagram.com/p/ABC123/',
        },
      });

      await service.exportInsightsCsv({
        ...baseExportDto,
        level: MetaInsightsLevel.AD,
        includeThumbnails: true,
      });

      const [rows, columns] = mockCsvFormatter.format.mock.calls[0] as [MetaInsights[], MetaInsightsColumn[]];
      expect(columns).toContain(MetaInsightsColumn.THUMBNAIL_URL);
      expect(columns).toContain(MetaInsightsColumn.INSTAGRAM_PERMALINK_URL);
      expect(rows[0].thumbnail_url).toBe('https://cdn.fb/t1.jpg');
      expect(rows[0].instagram_permalink_url).toBe('https://www.instagram.com/p/ABC123/');
      expect(mockMetaAdsService.fetchAdCreatives).toHaveBeenCalledWith(['ad_1'], 'plaintext-token');
    });
  });

  describe('listAdsets', () => {
    it('decrypts the token and delegates to MetaAdsService.fetchAdsets', async () => {
      const mockAdsets: MetaAdset[] = [
        { id: 'adset_1', name: 'CJ - Retargeting', updated_time: '2026-08-01T00:00:00+0000', effective_status: 'ACTIVE' },
      ];
      mockAdAccountsService.findByAdAccountId.mockResolvedValueOnce({
        adAccountId: 'act_123',
        accessToken: 'encrypted_token',
        isActive: true,
      });
      mockCrypto.decrypt.mockReturnValueOnce('plain_token');
      mockMetaAdsService.fetchAdsets.mockResolvedValueOnce(mockAdsets);

      const result = await service.listAdsets('act_123');

      expect(mockCrypto.decrypt).toHaveBeenCalledWith('encrypted_token');
      expect(mockMetaAdsService.fetchAdsets).toHaveBeenCalledWith('act_123', 'plain_token');
      expect(result).toEqual(mockAdsets);
    });

    it('throws UnprocessableEntityException when ad account is inactive', async () => {
      mockAdAccountsService.findByAdAccountId.mockResolvedValueOnce({
        adAccountId: 'act_123',
        accessToken: 'encrypted_token',
        isActive: false,
      });

      await expect(service.listAdsets('act_123')).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('getAdsetInsights', () => {
    it('decrypts token and delegates to MetaAdsService.fetchAdsetInsights', async () => {
      const mockInsight: Partial<MetaInsights> = {
        purchase_roas: [{ action_type: 'omni_purchase', value: '3.42' }],
      };
      mockAdAccountsService.findByAdAccountId.mockResolvedValueOnce({
        adAccountId: 'act_123',
        accessToken: 'encrypted_token',
        isActive: true,
      });
      mockCrypto.decrypt.mockReturnValueOnce('plain_token');
      mockMetaAdsService.fetchAdsetInsights.mockResolvedValueOnce(mockInsight as MetaInsights);

      const result = await service.getAdsetInsights('adset_1', 'act_123', '2026-08-01', '2026-08-09');

      expect(mockMetaAdsService.fetchAdsetInsights).toHaveBeenCalledWith(
        'adset_1',
        'plain_token',
        '2026-08-01',
        '2026-08-09',
      );
      expect(result).toEqual(mockInsight);
    });
  });
});
