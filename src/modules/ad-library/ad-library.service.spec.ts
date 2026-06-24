import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { AdLibraryService } from './ad-library.service.js';
import { SearchAdLibraryDto, AdActiveStatus, AdType, SearchType } from './dto/search-ad-library.dto.js';
import type { MetaAdLibraryResponse, RawMetaAd } from './interfaces/ad-library.interface.js';

const makeRawAd = (overrides: Partial<RawMetaAd> = {}): RawMetaAd => ({
  page_id: '111',
  page_name: 'Loja Teste',
  bylines: 'Empresa Teste LTDA',
  spend: { lower_bound: '200', upper_bound: '499' },
  impressions: { lower_bound: '2000', upper_bound: '4999' },
  estimated_audience_size: { lower_bound: '5000', upper_bound: '9999' },
  br_total_reach: 3000,
  ad_delivery_start_time: '2024-03-01',
  publisher_platforms: ['INSTAGRAM'],
  languages: ['pt'],
  demographic_distribution: [{ age: '25-34', gender: 'female', percentage: '0.45' }],
  delivery_by_region: [{ region: 'São Paulo', percentage: '0.40' }],
  target_ages: ['18', '24'],
  target_gender: 'All',
  target_locations: [{ name: 'Brazil', type: 'country' }],
  ad_snapshot_url: 'https://facebook.com/ads/archive/render_ad/?id=1',
  ...overrides,
});

const makeAxiosResponse = (data: MetaAdLibraryResponse): AxiosResponse<MetaAdLibraryResponse> => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config: { headers: {} } as never,
});

describe('AdLibraryService', () => {
  let service: AdLibraryService;
  let httpService: jest.Mocked<Pick<HttpService, 'get'>>;

  const mockConfig = {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        'meta.graphApiUrl': 'https://graph.facebook.com',
        'meta.graphApiVersion': 'v21.0',
        'meta.appId': 'APP_ID',
        'meta.appSecret': 'APP_SECRET',
      };
      return map[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdLibraryService,
        { provide: HttpService, useValue: { get: jest.fn() } },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<AdLibraryService>(AdLibraryService);
    httpService = module.get(HttpService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('search', () => {
    const dto: SearchAdLibraryDto = {
      terms: 'moda',
      country: 'BR',
      activeStatus: AdActiveStatus.ACTIVE,
      adType: AdType.ALL,
      searchType: SearchType.KEYWORD_UNORDERED,
      limit: 50,
    };

    it('retorna resultado com data, paging e total', async () => {
      const raw = makeRawAd();
      (httpService.get as jest.Mock).mockReturnValue(
        of(makeAxiosResponse({ data: [raw], paging: { cursors: { before: 'abc', after: 'xyz' } } })),
      );

      const result = await service.search(dto);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.paging?.cursors.after).toBe('xyz');
    });

    it('mapeia campos snake_case → camelCase corretamente', async () => {
      const raw = makeRawAd();
      (httpService.get as jest.Mock).mockReturnValue(of(makeAxiosResponse({ data: [raw] })));

      const result = await service.search(dto);
      const advertiser = result.data[0];

      expect(advertiser.pageId).toBe('111');
      expect(advertiser.pageName).toBe('Loja Teste');
      expect(advertiser.fundingEntity).toBe('Empresa Teste LTDA');
      expect(advertiser.spend).toEqual({ lowerBound: '200', upperBound: '499' });
      expect(advertiser.impressions).toEqual({ lowerBound: '2000', upperBound: '4999' });
      expect(advertiser.brTotalReach).toBe(3000);
      expect(advertiser.publisherPlatforms).toEqual(['INSTAGRAM']);
      expect(advertiser.targetGender).toBe('All');
    });

    it('deduplica por page_id mantendo o ad_delivery_start_time mais recente', async () => {
      const older = makeRawAd({ page_id: '111', ad_delivery_start_time: '2024-01-01', pageName: 'Antigo' } as never);
      const newer = makeRawAd({ page_id: '111', ad_delivery_start_time: '2024-06-01', page_name: 'Recente' });
      (httpService.get as jest.Mock).mockReturnValue(of(makeAxiosResponse({ data: [older, newer] })));

      const result = await service.search(dto);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].pageName).toBe('Recente');
    });

    it('filtra por minSpend — descarta anunciante com spend abaixo do mínimo', async () => {
      const low = makeRawAd({ page_id: '111', spend: { lower_bound: '50', upper_bound: '99' } });
      const high = makeRawAd({ page_id: '222', spend: { lower_bound: '200', upper_bound: '499' } });
      (httpService.get as jest.Mock).mockReturnValue(of(makeAxiosResponse({ data: [low, high] })));

      const result = await service.search({ ...dto, minSpend: 100 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].pageId).toBe('222');
    });

    it('filtra por minImpressions — descarta anunciante com impressions abaixo do mínimo', async () => {
      const low = makeRawAd({ page_id: '111', impressions: { lower_bound: '300', upper_bound: '499' } });
      const high = makeRawAd({ page_id: '222', impressions: { lower_bound: '1500', upper_bound: '2999' } });
      (httpService.get as jest.Mock).mockReturnValue(of(makeAxiosResponse({ data: [low, high] })));

      const result = await service.search({ ...dto, minImpressions: 1000 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].pageId).toBe('222');
    });

    it('retorna resultado vazio quando Meta API retorna lista vazia', async () => {
      (httpService.get as jest.Mock).mockReturnValue(of(makeAxiosResponse({ data: [] })));

      const result = await service.search(dto);

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.paging).toBeNull();
    });

    it('usa app access token no formato APP_ID|APP_SECRET', async () => {
      (httpService.get as jest.Mock).mockReturnValue(of(makeAxiosResponse({ data: [] })));

      await service.search(dto);

      const callParams = (httpService.get as jest.Mock).mock.calls[0][1].params;
      expect(callParams.access_token).toBe('APP_ID|APP_SECRET');
    });

    it('relança erro quando Meta API falha', async () => {
      const error = new Error('Meta API unavailable');
      (httpService.get as jest.Mock).mockReturnValue(throwError(() => error));

      await expect(service.search(dto)).rejects.toThrow('Meta API unavailable');
    });

    it('campos ausentes na resposta são mapeados para null/[]', async () => {
      const minimal: RawMetaAd = {
        page_id: '333',
        page_name: 'Minimal Page',
        ad_delivery_start_time: '2024-01-01',
        ad_snapshot_url: 'https://facebook.com/ads/archive/render_ad/?id=3',
      };
      (httpService.get as jest.Mock).mockReturnValue(of(makeAxiosResponse({ data: [minimal] })));

      const result = await service.search(dto);
      const advertiser = result.data[0];

      expect(advertiser.fundingEntity).toBeNull();
      expect(advertiser.spend).toBeNull();
      expect(advertiser.impressions).toBeNull();
      expect(advertiser.brTotalReach).toBeNull();
      expect(advertiser.adDeliveryStopTime).toBeNull();
      expect(advertiser.publisherPlatforms).toEqual([]);
      expect(advertiser.languages).toEqual([]);
      expect(advertiser.demographicDistribution).toEqual([]);
      expect(advertiser.targetLocations).toEqual([]);
    });
  });
});
