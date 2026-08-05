import { Test } from '@nestjs/testing';
import { AiService } from './ai.service.js';
import { AI_PROVIDER_TOKEN } from './ai.tokens.js';
import { AiReportPayload } from './interfaces/ai-provider.interface.js';

const mockPayload: AiReportPayload = {
  period: { since: '2026-07-27', until: '2026-08-02', weekNumber: 31 },
  current: { spend: 244.74, reach: 6825, impressions: 10000, clicks: 361, ctr: 3.61, cpm: 24.47, purchases: 0, addToCart: 18, pageViews: 165 },
  previous: null,
  deltas: {},
  clientContext: null,
};

describe('AiService', () => {
  let service: AiService;
  const mockProvider = { generateReport: jest.fn() };

  beforeEach(async () => {
    mockProvider.generateReport.mockReset();
    const module = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: AI_PROVIDER_TOKEN, useValue: mockProvider },
      ],
    }).compile();
    service = module.get(AiService);
  });

  it('delegates to the injected provider', async () => {
    mockProvider.generateReport.mockResolvedValue('relatório gerado');
    const result = await service.generateReport(mockPayload);
    expect(mockProvider.generateReport).toHaveBeenCalledWith(mockPayload);
    expect(result).toBe('relatório gerado');
  });
});
