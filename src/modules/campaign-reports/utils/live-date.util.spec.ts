import {
  parseLiveCampaigns,
  getLatestLiveDates,
  formatDisplayDate,
  formatIsoDate,
} from './live-date.util.js';

describe('parseLiveCampaigns', () => {
  it('extrai data e marca captação quando nome tem CAP + data', () => {
    const campaigns = [
      { id: '1', name: 'LIVE_01_09_25_CAP' },
      { id: '2', name: 'LIVE_01_09_25_VENDAS' },
    ];
    const result = parseLiveCampaigns(campaigns);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      campaignId: '1',
      liveDateStr: '01_09_25',
      isAcquisition: true,
    });
    expect(result[1]).toMatchObject({
      campaignId: '2',
      isAcquisition: false,
    });
  });

  it('ignora campanhas sem padrão DD_MM_AA no nome', () => {
    const campaigns = [{ id: '1', name: 'CAMPANHA_SEM_DATA' }];
    expect(parseLiveCampaigns(campaigns)).toHaveLength(0);
  });

  it('descarta datas inválidas (99_99_99)', () => {
    const campaigns = [{ id: '1', name: 'LIVE_99_99_99_CAP' }];
    expect(parseLiveCampaigns(campaigns)).toHaveLength(0);
  });

  it('reconhece CAPT além de CAP', () => {
    const campaigns = [{ id: '1', name: 'LIVE_15_08_25_CAPT_FB' }];
    const result = parseLiveCampaigns(campaigns);
    expect(result[0].isAcquisition).toBe(true);
  });
});

describe('getLatestLiveDates', () => {
  it('retorna as N datas mais recentes, deduplicadas', () => {
    const campaigns = [
      { id: '1', name: 'LIVE_01_09_25_CAP' },
      { id: '2', name: 'LIVE_01_09_25_VENDAS' }, // mesma data
      { id: '3', name: 'LIVE_15_08_25_CAP' },
      { id: '4', name: 'LIVE_01_08_25_CAP' },
    ];
    const parsed = parseLiveCampaigns(campaigns);
    const dates = getLatestLiveDates(parsed, 2);
    expect(dates).toHaveLength(2);
    // Mais recente primeiro
    expect(dates[0].getFullYear()).toBe(2025);
    expect(dates[0].getMonth()).toBe(8); // setembro (0-indexed)
    expect(dates[0].getDate()).toBe(1);
    expect(dates[1].getMonth()).toBe(7); // agosto
    expect(dates[1].getDate()).toBe(15);
  });

  it('retorna menos de N quando não há suficientes', () => {
    const parsed = parseLiveCampaigns([{ id: '1', name: 'LIVE_01_09_25_CAP' }]);
    expect(getLatestLiveDates(parsed, 2)).toHaveLength(1);
  });

  it('retorna [] quando parsed está vazio', () => {
    expect(getLatestLiveDates([], 2)).toHaveLength(0);
  });
});

describe('formatDisplayDate', () => {
  it('formata como DD/MM/AAAA', () => {
    expect(formatDisplayDate(new Date(2025, 8, 1))).toBe('01/09/2025');
  });
});

describe('formatIsoDate', () => {
  it('formata como YYYY-MM-DD', () => {
    expect(formatIsoDate(new Date(2025, 8, 1))).toBe('2025-09-01');
  });
});
