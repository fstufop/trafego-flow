import { ConfigService } from '@nestjs/config';
import { AiReportPayload } from '../interfaces/ai-provider.interface.js';
import { OpenAiAdapter } from './openai.adapter.js';

const mockPayload: AiReportPayload = {
  period: { since: '2026-07-27', until: '2026-08-02', weekNumber: 31 },
  current: { spend: 244.74, reach: 6825, impressions: 10000, clicks: 361, ctr: 3.61, cpm: 24.47, purchases: 0, addToCart: 18, pageViews: 165 },
  previous: null,
  deltas: {},
  clientContext: null,
};

const makeConfig = (overrides: Record<string, string> = {}) =>
  ({ get: jest.fn((key: string, def?: string) => overrides[key] ?? def ?? '') } as unknown as ConfigService);

const mockCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

describe('OpenAiAdapter', () => {
  beforeEach(() => mockCreate.mockReset());

  it('returns content from first chat completion choice', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'relatório gerado pelo GPT' } }],
    });
    const adapter = new OpenAiAdapter(makeConfig({ OPENAI_API_KEY: 'sk-test', AI_MODEL: 'gpt-4o-mini' }));
    const result = await adapter.generateReport(mockPayload);
    expect(result).toBe('relatório gerado pelo GPT');
  });

  it('returns empty string when choices is empty', async () => {
    mockCreate.mockResolvedValue({ choices: [] });
    const adapter = new OpenAiAdapter(makeConfig({ OPENAI_API_KEY: 'sk-test' }));
    const result = await adapter.generateReport(mockPayload);
    expect(result).toBe('');
  });
});
