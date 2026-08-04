import { buildSystemPrompt, buildUserMessage } from './prompt-builder.js';
import { AiReportPayload } from '../interfaces/ai-provider.interface.js';

const mockPayload: AiReportPayload = {
  period: { since: '2026-07-27', until: '2026-08-02', weekNumber: 31 },
  current: { spend: 244.74, reach: 6825, impressions: 10000, clicks: 361, ctr: 3.61, cpm: 24.47, purchases: 0, addToCart: 18, pageViews: 165 },
  previous: null,
  deltas: {},
  clientContext: null,
};

describe('buildSystemPrompt', () => {
  it('includes plural first-person instruction', () => {
    expect(buildSystemPrompt(null)).toContain('primeira pessoa do plural');
  });

  it('appends clientContext when provided', () => {
    expect(buildSystemPrompt('foco em e-commerce')).toContain('foco em e-commerce');
  });

  it('does not mention clientContext when null', () => {
    expect(buildSystemPrompt(null)).not.toContain('Contexto');
  });
});

describe('buildUserMessage', () => {
  it('includes week number', () => {
    expect(buildUserMessage(mockPayload)).toContain('31');
  });

  it('includes serialized spend value', () => {
    expect(buildUserMessage(mockPayload)).toContain('244.74');
  });
});
