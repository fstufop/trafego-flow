import { ConfigService } from '@nestjs/config';
import { AiReportPayload } from '../interfaces/ai-provider.interface.js';
import { ClientProfileType } from '../../clients/enums/client-profile-type.enum.js';
import { GeminiAdapter } from './gemini.adapter.js';

const mockPayload: AiReportPayload = {
  period: { since: '2026-07-27', until: '2026-08-02', weekNumber: 31 },
  current: {
    spend: 244.74, reach: 6825, impressions: 10000, clicks: 361,
    ctr: 3.61, cpm: 24.47, purchases: 0, addToCart: 18, pageViews: 165,
    contentViews: 0, checkoutInitiated: 0, messagesStarted: 0, liveViews: 0,
  },
  previous: null,
  deltas: {},
  acquisition: null,
  sales: null,
  clientProfile: ClientProfileType.SITE_SALES,
  clientContext: null,
};

const makeConfig = (overrides: Record<string, string> = {}) =>
  ({ get: jest.fn((key: string, def?: string) => overrides[key] ?? def ?? '') } as unknown as ConfigService);

const mockGenerateContent = jest.fn();

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
}));

describe('GeminiAdapter', () => {
  beforeEach(() => mockGenerateContent.mockReset());

  it('returns text from Gemini response', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'relatório gerado pelo Gemini' },
    });
    const adapter = new GeminiAdapter(makeConfig({ GEMINI_API_KEY: 'AIza-test', AI_MODEL: 'gemini-1.5-flash' }));
    const result = await adapter.generateReport(mockPayload);
    expect(result).toBe('relatório gerado pelo Gemini');
  });
});
