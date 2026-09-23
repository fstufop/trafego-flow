// src/modules/ai/utils/prompt-builder.spec.ts
import { buildSystemPrompt, buildUserMessage } from './prompt-builder.js';
import { AiReportPayload, InsightsSummary } from '../interfaces/ai-provider.interface.js';
import { ClientProfileType } from '../../clients/enums/client-profile-type.enum.js';

const baseInsights: InsightsSummary = {
  spend: 500, reach: 10000, impressions: 50000, clicks: 1000,
  ctr: 2.0, cpm: 10.0, purchases: 20, addToCart: 80,
  pageViews: 600, contentViews: 400, checkoutInitiated: 50,
  messagesStarted: 0, liveViews: 0,
};

const basePayload: AiReportPayload = {
  period: { since: '2026-07-28', until: '2026-08-03', weekNumber: 31 },
  current: baseInsights,
  previous: null,
  deltas: {},
  acquisition: null,
  sales: null,
  clientProfile: ClientProfileType.SITE_SALES,
  clientContext: null,
};

describe('buildSystemPrompt', () => {
  it('forbids emojis and markdown explicitly', () => {
    const prompt = buildSystemPrompt(ClientProfileType.SITE_SALES, null);
    expect(prompt).toMatch(/emoji/i);
    expect(prompt).toMatch(/markdown/i);
  });

  it('requires first-person singular for next steps', () => {
    const prompt = buildSystemPrompt(ClientProfileType.SITE_SALES, null);
    expect(prompt).toMatch(/primeira pessoa do singular/i);
  });

  it('instructs positive framing for negative results', () => {
    const prompt = buildSystemPrompt(ClientProfileType.SITE_SALES, null);
    expect(prompt).toMatch(/positiv/i);
  });

  it('appends clientContext when provided', () => {
    const prompt = buildSystemPrompt(ClientProfileType.SITE_SALES, 'foco em e-commerce');
    expect(prompt).toContain('foco em e-commerce');
  });

  it('does not mention clientContext when null', () => {
    const prompt = buildSystemPrompt(ClientProfileType.SITE_SALES, null);
    expect(prompt).not.toContain('foco em e-commerce');
  });

  it('mentions SITE_SALES profile context', () => {
    expect(buildSystemPrompt(ClientProfileType.SITE_SALES, null)).toMatch(/site|e-commerce|funil/i);
  });

  it('mentions MESSAGE_SALES profile context', () => {
    expect(buildSystemPrompt(ClientProfileType.MESSAGE_SALES, null)).toMatch(/mensagem|direct/i);
  });

  it('mentions LIVE_SALES profile context', () => {
    expect(buildSystemPrompt(ClientProfileType.LIVE_SALES, null)).toMatch(/live/i);
  });
});

describe('buildUserMessage — SITE_SALES', () => {
  const acquisition: InsightsSummary = { ...baseInsights, spend: 200, clicks: 500 };
  const sales: InsightsSummary = {
    ...baseInsights,
    spend: 1000, clicks: 300, pageViews: 290, contentViews: 180,
    addToCart: 60, checkoutInitiated: 20, purchases: 10,
  };

  it('includes week number and date range', () => {
    const payload = { ...basePayload, clientProfile: ClientProfileType.SITE_SALES };
    const msg = buildUserMessage(payload);
    expect(msg).toContain('Semana 31');
    expect(msg).toContain('2026-07-28');
  });

  it('includes acquisition section when acquisition is present', () => {
    const payload = { ...basePayload, clientProfile: ClientProfileType.SITE_SALES, acquisition, sales };
    const msg = buildUserMessage(payload);
    expect(msg).toContain('Campanha de Captação');
    expect(msg).toContain('R$ 200,00');
  });

  it('omits acquisition section when acquisition is null', () => {
    const payload = { ...basePayload, clientProfile: ClientProfileType.SITE_SALES, acquisition: null, sales };
    const msg = buildUserMessage(payload);
    expect(msg).not.toContain('Campanha de Captação');
  });

  it('includes funnel with correct step conversion rates', () => {
    const payload = { ...basePayload, clientProfile: ClientProfileType.SITE_SALES, acquisition: null, sales };
    const msg = buildUserMessage(payload);
    // pageViews/clicks = 290/300 = 96.7%
    expect(msg).toContain('96,7%');
    // contentViews/pageViews = 180/290 = 62.1%
    expect(msg).toContain('62,1%');
    // purchases/clicks = 10/300 = 3.3%
    expect(msg).toContain('3,3%');
  });

  it('omits funil section when sales is null', () => {
    const payload = { ...basePayload, clientProfile: ClientProfileType.SITE_SALES, sales: null };
    const msg = buildUserMessage(payload);
    expect(msg).not.toContain('Funil de Vendas');
  });

  it('includes PREENCHER slots for narrative parts', () => {
    const payload = { ...basePayload, clientProfile: ClientProfileType.SITE_SALES };
    const msg = buildUserMessage(payload);
    expect(msg).toContain('[PREENCHER');
    expect(msg).toContain('Próximos passos:');
  });

  it('includes delta reference data when deltas are present', () => {
    const payload = { ...basePayload, clientProfile: ClientProfileType.SITE_SALES, deltas: { reach: 0.13 } };
    const msg = buildUserMessage(payload);
    expect(msg).toContain('0.13');
  });
});

describe('buildUserMessage — MESSAGE_SALES', () => {
  const insights: InsightsSummary = { ...baseInsights, messagesStarted: 59 };

  it('includes mensagens-specific metrics', () => {
    const payload = { ...basePayload, clientProfile: ClientProfileType.MESSAGE_SALES, current: insights, acquisition: null, sales: null };
    const msg = buildUserMessage(payload);
    expect(msg).toContain('Conversas iniciadas');
    expect(msg).toContain('59');
  });

  it('does not include funnel section', () => {
    const payload = { ...basePayload, clientProfile: ClientProfileType.MESSAGE_SALES };
    const msg = buildUserMessage(payload);
    expect(msg).not.toContain('Funil de Vendas');
  });
});

describe('buildUserMessage — LIVE_SALES', () => {
  const insights: InsightsSummary = { ...baseInsights, liveViews: 350 };

  it('includes live-specific metrics', () => {
    const payload = { ...basePayload, clientProfile: ClientProfileType.LIVE_SALES, current: insights };
    const msg = buildUserMessage(payload);
    expect(msg).toContain('Visualizações da live');
    expect(msg).toContain('350');
  });

  it('does not include funil section', () => {
    const payload = { ...basePayload, clientProfile: ClientProfileType.LIVE_SALES };
    const msg = buildUserMessage(payload);
    expect(msg).not.toContain('Funil de Vendas');
  });
});

describe('buildUserMessage — MESSAGE_SALES', () => {
  const messageSalesPayload: AiReportPayload = {
    ...basePayload,
    clientProfile: ClientProfileType.MESSAGE_SALES,
    current: { ...baseInsights, messagesStarted: 150, spend: 750 },
  };

  it('exibe tabela por adset quando adsetRows está presente', () => {
    const payload: AiReportPayload = {
      ...messageSalesPayload,
      adsetRows: [
        { adsetName: 'Conjunto A', messagesStarted: 100, costPerMessage: 5, startDate: '01/08/26' },
        { adsetName: 'Conjunto B', messagesStarted: 50, costPerMessage: 10, startDate: '15/08/26' },
      ],
    };
    const text = buildUserMessage(payload);
    expect(text).toContain('Conjunto A');
    expect(text).toContain('100');
    expect(text).toContain('R$ 5,00');
    expect(text).toContain('01/08/26');
    expect(text).toContain('Conjunto B');
  });

  it('usa fallback de métricas agregadas quando adsetRows está ausente', () => {
    const text = buildUserMessage(messageSalesPayload);
    expect(text).toContain('Investimento');
    expect(text).toContain('750');
  });

  it('exibe "–" para costPerMessage null', () => {
    const payload: AiReportPayload = {
      ...messageSalesPayload,
      adsetRows: [
        { adsetName: 'Conjunto A', messagesStarted: 0, costPerMessage: null, startDate: '01/08/26' },
      ],
    };
    const text = buildUserMessage(payload);
    expect(text).toContain('–');
  });
});

describe('buildUserMessage — LIVE_SALES com liveData', () => {
  const liveSalesPayload: AiReportPayload = {
    ...basePayload,
    clientProfile: ClientProfileType.LIVE_SALES,
    current: { ...baseInsights, liveViews: 500 },
  };

  it('exibe as 2 lives quando liveData está presente', () => {
    const payload: AiReportPayload = {
      ...liveSalesPayload,
      liveData: [
        {
          liveDate: '01/09/2026',
          captationSpend: 500,
          captationReach: 10000,
          captationClicks: 200,
          adReaches: [
            { adName: 'Anuncio A', reach: 3000 },
            { adName: 'Anuncio B', reach: 2000 },
          ],
        },
        {
          liveDate: '15/08/2026',
          captationSpend: 400,
          captationReach: 8000,
          captationClicks: 150,
          adReaches: [],
        },
      ],
    };
    const text = buildUserMessage(payload);
    expect(text).toContain('01/09/2026');
    expect(text).toContain('15/08/2026');
    expect(text).toContain('500');
    expect(text).toContain('Anuncio A');
    expect(text).toContain('3.000');
  });

  it('renderiza 1 live normalmente quando liveData tem 1 entrada', () => {
    const payload: AiReportPayload = {
      ...liveSalesPayload,
      liveData: [
        { liveDate: '01/09/2026', captationSpend: 500, captationReach: 10000, captationClicks: 200, adReaches: [] },
      ],
    };
    const text = buildUserMessage(payload);
    expect(text).toContain('01/09/2026');
  });

  it('usa fallback quando liveData está ausente', () => {
    const text = buildUserMessage(liveSalesPayload);
    expect(text).toContain('Investimento');
  });

  it('omite seção de alcance por anúncio quando adReaches está vazio', () => {
    const payload: AiReportPayload = {
      ...liveSalesPayload,
      liveData: [
        { liveDate: '01/09/2026', captationSpend: 500, captationReach: 10000, captationClicks: 200, adReaches: [] },
      ],
    };
    const text = buildUserMessage(payload);
    expect(text).not.toContain('Alcance por anuncio');
  });
});
