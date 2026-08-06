# Report Prompt Standardization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize the tone, structure, and language of weekly WhatsApp reports by adding client profile types, splitting campaigns into acquisition/sales buckets, and rewriting the prompt builder with strict per-profile templates.

**Architecture:** The service pre-processes campaign data (splits captação vs venda rows by name) before calling the AI. The prompt builder produces a near-complete template with all numbers pre-filled; the AI only fills three narrative slots (opening, comparison, next steps). Profile-specific rules are enforced in the system prompt.

**Tech Stack:** NestJS 11, TypeScript 5.7, TypeORM, PostgreSQL, Jest 30

## Global Constraints

- No emojis in generated reports
- No markdown in generated reports (`#`, `*`, `_`, `-` lists are forbidden)
- Numbers in pt-BR locale: `R$ 1.234,56` for currency, `10.611` for integers
- First-person singular for "Próximos passos" section ("vou", not "vamos")
- Fallback to `SITE_SALES` profile when `profileType` is null
- Snapshot saves only the aggregated total — not the split buckets
- All new enum keys and TypeScript property names must be in English

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `src/modules/clients/enums/client-profile-type.enum.ts` | `ClientProfileType` enum |
| Modify | `src/modules/clients/entities/client.entity.ts` | Add `profileType` column |
| Create | `src/database/migrations/1780900000002-AddProfileTypeToClients.ts` | DB migration |
| Modify | `src/modules/ai/interfaces/ai-provider.interface.ts` | Extend `InsightsSummary` and `AiReportPayload` |
| Create | `src/modules/ai/utils/campaign-splitter.ts` | `splitAndAggregateCampaigns` function |
| Create | `src/modules/ai/utils/campaign-splitter.spec.ts` | Tests for campaign splitter |
| Modify | `src/modules/ai/utils/prompt-builder.ts` | Full rewrite — profile-aware system prompt + per-profile templates |
| Modify | `src/modules/ai/utils/prompt-builder.spec.ts` | Full rewrite of tests |
| Modify | `src/modules/report-dispatches/report-dispatches.service.ts` | Wire split, profile load, new payload shape |
| Modify | `src/modules/report-dispatches/report-dispatches.service.spec.ts` | Update tests for new `toInsightsSummary` and `computeDeltas` |

---

## Task 1: ClientProfileType enum + ClientEntity field + migration

**Files:**
- Create: `src/modules/clients/enums/client-profile-type.enum.ts`
- Modify: `src/modules/clients/entities/client.entity.ts`
- Create: `src/database/migrations/1780900000002-AddProfileTypeToClients.ts`

**Interfaces:**
- Produces: `ClientProfileType` enum exported from the enums file; `ClientEntity.profileType: ClientProfileType | null`

- [ ] **Step 1: Create the enum file**

```typescript
// src/modules/clients/enums/client-profile-type.enum.ts
export enum ClientProfileType {
  SITE_SALES    = 'site_sales',
  MESSAGE_SALES = 'message_sales',
  LIVE_SALES    = 'live_sales',
}
```

- [ ] **Step 2: Add the column to ClientEntity**

In `src/modules/clients/entities/client.entity.ts`, add the import and column after the existing `aiStrategyContext` column:

```typescript
import { ClientProfileType } from '../enums/client-profile-type.enum.js';

// inside the class, after aiStrategyContext:
@Column({
  type: 'enum',
  enum: ClientProfileType,
  nullable: true,
  name: 'profile_type',
})
profileType: ClientProfileType | null;
```

- [ ] **Step 3: Create the migration**

```typescript
// src/database/migrations/1780900000002-AddProfileTypeToClients.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProfileTypeToClients1780900000002 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_profile_type_enum') THEN
          CREATE TYPE "client_profile_type_enum" AS ENUM ('site_sales', 'message_sales', 'live_sales');
        END IF;
      END $$;
    `);
    await runner.query(`
      ALTER TABLE "clients"
      ADD COLUMN IF NOT EXISTS "profile_type" "client_profile_type_enum"
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE "clients" DROP COLUMN IF EXISTS "profile_type"`);
    await runner.query(`DROP TYPE IF EXISTS "client_profile_type_enum"`);
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run build
```

Expected: no errors related to `profileType` or `ClientProfileType`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/clients/enums/client-profile-type.enum.ts \
        src/modules/clients/entities/client.entity.ts \
        src/database/migrations/1780900000002-AddProfileTypeToClients.ts
git commit -m "feat: add ClientProfileType enum and profileType column to ClientEntity"
```

---

## Task 2: Extend InsightsSummary and AiReportPayload interfaces

**Files:**
- Modify: `src/modules/ai/interfaces/ai-provider.interface.ts`

**Interfaces:**
- Consumes: `ClientProfileType` from Task 1
- Produces: Extended `InsightsSummary` (4 new fields) and extended `AiReportPayload` (3 new fields); all downstream tasks depend on this shape

- [ ] **Step 1: Rewrite `ai-provider.interface.ts`**

Replace the entire file contents with:

```typescript
import { ClientProfileType } from '../../clients/enums/client-profile-type.enum.js';

export interface InsightsSummary {
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  purchases: number;
  addToCart: number;
  pageViews: number;
  messagesStarted: number;   // action_type: messaging_conversation_started_7d
  contentViews: number;      // action_type: view_content
  checkoutInitiated: number; // action_type: initiate_checkout
  liveViews: number;         // action_type: video_play
}

export interface AiReportPayload {
  period: {
    since: string;       // 'YYYY-MM-DD'
    until: string;       // 'YYYY-MM-DD'
    weekNumber: number;  // ISO 8601 week
  };
  current: InsightsSummary;         // total aggregated (acquisition + sales)
  previous: InsightsSummary | null; // previous week total from snapshot
  deltas: Record<string, number | null>;
  acquisition: InsightsSummary | null; // campaigns with CAP/CAPT in name
  sales: InsightsSummary | null;       // remaining campaigns
  clientProfile: ClientProfileType;
  clientContext: string | null;
}

export interface IAiProvider {
  generateReport(payload: AiReportPayload): Promise<string>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: TypeScript errors in `report-dispatches.service.ts` and `prompt-builder.ts` — these are expected and will be fixed in Tasks 3–5. As long as the interface file itself compiles, this step passes.

- [ ] **Step 3: Commit**

```bash
git add src/modules/ai/interfaces/ai-provider.interface.ts
git commit -m "feat: extend InsightsSummary and AiReportPayload with profile and split fields"
```

---

## Task 3: Campaign splitter utility

**Files:**
- Create: `src/modules/ai/utils/campaign-splitter.ts`
- Create: `src/modules/ai/utils/campaign-splitter.spec.ts`

**Interfaces:**
- Consumes: `MetaInsights` from `campaign-reports/interfaces/meta-campaign.interface.ts`; `InsightsSummary` from Task 2
- Produces: `splitAndAggregateCampaigns(rows: MetaInsights[]): { acquisition: InsightsSummary | null; sales: InsightsSummary | null; total: InsightsSummary }`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/modules/ai/utils/campaign-splitter.spec.ts
import { splitAndAggregateCampaigns } from './campaign-splitter.js';
import { MetaInsights } from '../../campaign-reports/interfaces/meta-campaign.interface.js';

function makeRow(overrides: Partial<MetaInsights> & { campaign_name?: string }): MetaInsights {
  return {
    impressions: '0', clicks: '0', spend: '0', reach: '0',
    cpm: '0', cpc: '0', ctr: '0',
    date_start: '2026-07-28', date_stop: '2026-08-03',
    ...overrides,
  };
}

describe('splitAndAggregateCampaigns', () => {
  it('returns null acquisition and null sales when rows is empty', () => {
    const result = splitAndAggregateCampaigns([]);
    expect(result.acquisition).toBeNull();
    expect(result.sales).toBeNull();
    expect(result.total.spend).toBe(0);
  });

  it('classifies row with CAP in name as acquisition', () => {
    const row = makeRow({ campaign_name: 'MF_ENG_FRIO_CAP_JUL26', spend: '100', clicks: '50' });
    const result = splitAndAggregateCampaigns([row]);
    expect(result.acquisition).not.toBeNull();
    expect(result.acquisition!.spend).toBeCloseTo(100);
    expect(result.acquisition!.clicks).toBe(50);
    expect(result.sales).toBeNull();
  });

  it('classifies row with CAPT in name as acquisition (case-insensitive)', () => {
    const row = makeRow({ campaign_name: 'mf_eng_frio_capt_jul26', spend: '200' });
    const result = splitAndAggregateCampaigns([row]);
    expect(result.acquisition).not.toBeNull();
    expect(result.acquisition!.spend).toBeCloseTo(200);
  });

  it('classifies row without CAP/CAPT as sales', () => {
    const row = makeRow({ campaign_name: 'MF_VENDA_HOT_JUL26', spend: '1000', clicks: '300' });
    const result = splitAndAggregateCampaigns([row]);
    expect(result.sales).not.toBeNull();
    expect(result.sales!.spend).toBeCloseTo(1000);
    expect(result.acquisition).toBeNull();
  });

  it('classifies row with undefined campaign_name as sales', () => {
    const row = makeRow({ spend: '500' });
    const result = splitAndAggregateCampaigns([row]);
    expect(result.sales).not.toBeNull();
    expect(result.acquisition).toBeNull();
  });

  it('splits mixed rows correctly and total equals sum', () => {
    const captRow = makeRow({ campaign_name: 'MF_CAPT', spend: '100', clicks: '50', reach: '500', impressions: '1000' });
    const vendaRow = makeRow({ campaign_name: 'MF_VENDA', spend: '900', clicks: '300', reach: '2000', impressions: '5000' });
    const result = splitAndAggregateCampaigns([captRow, vendaRow]);
    expect(result.acquisition!.spend).toBeCloseTo(100);
    expect(result.sales!.spend).toBeCloseTo(900);
    expect(result.total.spend).toBeCloseTo(1000);
    expect(result.total.clicks).toBe(350);
  });

  it('maps action_types to InsightsSummary fields', () => {
    const row = makeRow({
      campaign_name: 'MF_VENDA',
      spend: '500',
      actions: [
        { action_type: 'purchase', value: '10' },
        { action_type: 'add_to_cart', value: '25' },
        { action_type: 'landing_page_view', value: '300' },
        { action_type: 'view_content', value: '200' },
        { action_type: 'initiate_checkout', value: '15' },
        { action_type: 'messaging_conversation_started_7d', value: '5' },
        { action_type: 'video_play', value: '80' },
      ],
    });
    const result = splitAndAggregateCampaigns([row]);
    expect(result.sales!.purchases).toBe(10);
    expect(result.sales!.addToCart).toBe(25);
    expect(result.sales!.pageViews).toBe(300);
    expect(result.sales!.contentViews).toBe(200);
    expect(result.sales!.checkoutInitiated).toBe(15);
    expect(result.sales!.messagesStarted).toBe(5);
    expect(result.sales!.liveViews).toBe(80);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=campaign-splitter
```

Expected: FAIL — `splitAndAggregateCampaigns` is not defined.

- [ ] **Step 3: Implement `campaign-splitter.ts`**

```typescript
// src/modules/ai/utils/campaign-splitter.ts
import { MetaInsights } from '../../campaign-reports/interfaces/meta-campaign.interface.js';
import { InsightsSummary } from '../interfaces/ai-provider.interface.js';

const ACQUISITION_PATTERN = /\bCAP[T]?\b/i;

function isAcquisition(row: MetaInsights): boolean {
  return ACQUISITION_PATTERN.test(row.campaign_name ?? '');
}

function findAction(actions: MetaInsights['actions'], type: string): number {
  return parseInt(actions?.find(a => a.action_type === type)?.value ?? '0', 10);
}

function aggregateRows(rows: MetaInsights[]): InsightsSummary {
  let spend = 0, impressions = 0, clicks = 0, reach = 0;
  let purchases = 0, addToCart = 0, pageViews = 0;
  let messagesStarted = 0, contentViews = 0, checkoutInitiated = 0, liveViews = 0;

  for (const row of rows) {
    spend += parseFloat(row.spend ?? '0');
    impressions += parseInt(row.impressions ?? '0', 10);
    clicks += parseInt(row.clicks ?? '0', 10);
    reach += parseInt(row.reach ?? '0', 10);
    purchases += findAction(row.actions, 'purchase');
    addToCart += findAction(row.actions, 'add_to_cart');
    pageViews += findAction(row.actions, 'landing_page_view');
    contentViews += findAction(row.actions, 'view_content');
    checkoutInitiated += findAction(row.actions, 'initiate_checkout');
    messagesStarted += findAction(row.actions, 'messaging_conversation_started_7d');
    liveViews += findAction(row.actions, 'video_play');
  }

  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;

  return {
    spend, reach, impressions, clicks,
    ctr: parseFloat(ctr.toFixed(2)),
    cpm: parseFloat(cpm.toFixed(2)),
    purchases, addToCart, pageViews,
    messagesStarted, contentViews, checkoutInitiated, liveViews,
  };
}

export function splitAndAggregateCampaigns(rows: MetaInsights[]): {
  acquisition: InsightsSummary | null;
  sales: InsightsSummary | null;
  total: InsightsSummary;
} {
  const acquisitionRows = rows.filter(isAcquisition);
  const salesRows = rows.filter(r => !isAcquisition(r));

  return {
    acquisition: acquisitionRows.length > 0 ? aggregateRows(acquisitionRows) : null,
    sales: salesRows.length > 0 ? aggregateRows(salesRows) : null,
    total: aggregateRows(rows),
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=campaign-splitter
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ai/utils/campaign-splitter.ts src/modules/ai/utils/campaign-splitter.spec.ts
git commit -m "feat: add campaign splitter — splits acquisition vs sales rows by CAP/CAPT name"
```

---

## Task 4: Rewrite prompt-builder with profile-aware templates

**Files:**
- Modify: `src/modules/ai/utils/prompt-builder.ts`
- Modify: `src/modules/ai/utils/prompt-builder.spec.ts`

**Interfaces:**
- Consumes: `AiReportPayload` and `ClientProfileType` from Tasks 1 and 2
- Produces: `buildSystemPrompt(profile: ClientProfileType, clientContext: string | null): string`; `buildUserMessage(payload: AiReportPayload): string`

- [ ] **Step 1: Write the failing tests**

Replace the entire `prompt-builder.spec.ts` with:

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=prompt-builder
```

Expected: FAIL — many tests fail because the current functions have wrong signatures and behavior.

- [ ] **Step 3: Implement the new `prompt-builder.ts`**

Replace the entire file:

```typescript
// src/modules/ai/utils/prompt-builder.ts
import { AiReportPayload, InsightsSummary } from '../interfaces/ai-provider.interface.js';
import { ClientProfileType } from '../../clients/enums/client-profile-type.enum.js';

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(value: number): string {
  return value.toLocaleString('pt-BR');
}

function fmtPct(numerator: number, denominator: number): string {
  if (denominator === 0) return 'N/D';
  return `${((numerator / denominator) * 100).toFixed(1).replace('.', ',')}%`;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const PROFILE_CONTEXT: Record<ClientProfileType, string> = {
  [ClientProfileType.SITE_SALES]:
    'O cliente tem e-commerce (Venda por Site). O relatório separa campanhas de captação (aquisição de público) das campanhas de funil de vendas com conversão no site.',
  [ClientProfileType.MESSAGE_SALES]:
    'O cliente trabalha com atendimento por mensagem (WhatsApp/Instagram Direct). O relatório destaca alcance, conversas iniciadas no direct e investimento.',
  [ClientProfileType.LIVE_SALES]:
    'O cliente trabalha com vendas por live. O relatório destaca alcance, visualizações da live e investimento.',
};

export function buildSystemPrompt(
  profile: ClientProfileType,
  clientContext: string | null,
): string {
  const lines = [
    'Você é um gestor de tráfego pago que envia relatórios semanais para seus clientes pelo WhatsApp.',
    '',
    'Regras obrigatórias — nunca quebre nenhuma delas:',
    '- Escreva na primeira pessoa do singular para os próximos passos: "vou realizar", "vou ajustar", "vou otimizar"',
    '- Tom: amigável, direto e profissional — sem exageros, sem palavras em maiúsculas por ênfase',
    '- Proibido: emojis de qualquer tipo',
    '- Proibido: markdown (não use #, *, _, -, listas com hífen ou asterisco)',
    '- Formato: texto puro compatível com WhatsApp (apenas quebras de linha)',
    '- Números: formato brasileiro — R$ 1.234,56 para valores monetários; 10.611 para inteiros',
    '- Foco em resultados positivos: quando métricas caem, enquadre como oportunidade ou ajuste de estratégia, nunca como fracasso. Se todos os indicadores caíram, comece com algo como "Essa semana ajustamos a estratégia para melhores resultados nas próximas semanas"',
    '- Próximos passos: sempre específicos com base nos dados do relatório — nunca genéricos',
    '',
    PROFILE_CONTEXT[profile],
  ];

  if (clientContext) {
    lines.push('', `Contexto estratégico do cliente: ${clientContext}`);
  }

  return lines.join('\n');
}

// ─── User message templates ───────────────────────────────────────────────────

function header(weekNumber: number, since: string, until: string): string[] {
  return [
    'Preencha apenas os trechos marcados com [PREENCHER]. Não altere nada mais — o formato, os números e os rótulos estão corretos.',
    '',
    '---',
    'Olá!',
    '',
    `Feedback Semanal — Semana ${weekNumber}`,
    `${since} a ${until}`,
    '',
    '[PREENCHER: 1-2 frases avaliando o desempenho geral da semana de forma positiva. Se métricas caíram, enquadre como ajuste de estratégia.]',
    '',
  ];
}

function footer(deltas: Record<string, number | null>, clientContext: string | null, previous: InsightsSummary | null): string[] {
  const hasDeltas = Object.keys(deltas).length > 0;
  const lines: string[] = [];

  if (hasDeltas) {
    lines.push('[PREENCHER: 1 frase destacando o comparativo mais relevante com a semana anterior. Foque no positivo.]');
    lines.push('');
  }

  lines.push(
    'Próximos passos:',
    '[PREENCHER: 2-3 frases específicas sobre o que será feito na próxima semana, usando "vou". Baseie-se nos dados e no contexto do cliente.]',
    '',
    'Qualquer dúvida estou à disposição!',
    '---',
    '',
    'Dados de referência para os próximos passos:',
  );

  if (clientContext) lines.push(`Contexto do cliente: ${clientContext}`);
  if (hasDeltas) {
    lines.push(`Variações semana anterior: ${JSON.stringify(deltas)}`);
    if (previous) {
      lines.push(`Principais métricas semana anterior: alcance ${fmtInt(previous.reach)}, investimento R$ ${fmtBRL(previous.spend)}`);
    }
  }

  return lines;
}

function buildSiteSalesMessage(payload: AiReportPayload): string {
  const { period, acquisition, sales, deltas, clientContext, previous } = payload;
  const lines: string[] = header(period.weekNumber, period.since, period.until);

  if (acquisition) {
    lines.push(
      'Campanha de Captação:',
      `Investimento: R$ ${fmtBRL(acquisition.spend)}`,
      `Cliques: ${fmtInt(acquisition.clicks)}`,
      '',
    );
  }

  if (sales) {
    lines.push(
      'Campanhas de Venda:',
      `Investimento: R$ ${fmtBRL(sales.spend)}`,
      '',
      'Funil de Vendas:',
      `Cliques no anúncio: ${fmtInt(sales.clicks)}`,
      `↓ ${fmtPct(sales.pageViews, sales.clicks)}`,
      `Visitas à página: ${fmtInt(sales.pageViews)}`,
      `↓ ${fmtPct(sales.contentViews, sales.pageViews)}`,
      `Visualizações de conteúdo: ${fmtInt(sales.contentViews)}`,
      `↓ ${fmtPct(sales.addToCart, sales.contentViews)}`,
      `Carrinho: ${fmtInt(sales.addToCart)}`,
      `↓ ${fmtPct(sales.checkoutInitiated, sales.addToCart)}`,
      `Finalização de compra: ${fmtInt(sales.checkoutInitiated)}`,
      `↓ ${fmtPct(sales.purchases, sales.checkoutInitiated)}`,
      `Compras: ${fmtInt(sales.purchases)}`,
      '',
      `Conversão geral (clique → compra): ${fmtPct(sales.purchases, sales.clicks)}`,
      '',
    );
  }

  lines.push(...footer(deltas, clientContext, previous));
  return lines.join('\n');
}

function buildMessageSalesMessage(payload: AiReportPayload): string {
  const { period, current, deltas, clientContext, previous } = payload;
  const lines: string[] = header(period.weekNumber, period.since, period.until);

  lines.push(
    `Investimento: R$ ${fmtBRL(current.spend)}`,
    `Alcance: ${fmtInt(current.reach)} pessoas impactadas`,
    `Conversas iniciadas: ${fmtInt(current.messagesStarted)} novos contatos no direct`,
    `Cliques nos anúncios: ${fmtInt(current.clicks)}`,
    '',
  );

  lines.push(...footer(deltas, clientContext, previous));
  return lines.join('\n');
}

function buildLiveSalesMessage(payload: AiReportPayload): string {
  const { period, current, deltas, clientContext, previous } = payload;
  const lines: string[] = header(period.weekNumber, period.since, period.until);

  lines.push(
    `Investimento: R$ ${fmtBRL(current.spend)}`,
    `Alcance: ${fmtInt(current.reach)} pessoas impactadas`,
    `Visualizações da live: ${fmtInt(current.liveViews)}`,
    `Cliques nos anúncios: ${fmtInt(current.clicks)}`,
    `Compras: ${fmtInt(current.purchases)}`,
    '',
  );

  lines.push(...footer(deltas, clientContext, previous));
  return lines.join('\n');
}

export function buildUserMessage(payload: AiReportPayload): string {
  switch (payload.clientProfile) {
    case ClientProfileType.MESSAGE_SALES:
      return buildMessageSalesMessage(payload);
    case ClientProfileType.LIVE_SALES:
      return buildLiveSalesMessage(payload);
    default:
      return buildSiteSalesMessage(payload);
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=prompt-builder
```

Expected: all tests PASS.

- [ ] **Step 5: Update adapters to use new `buildSystemPrompt` signature**

Both adapters call `buildSystemPrompt(payload.clientContext)` — update to the new two-argument signature.

In `src/modules/ai/adapters/openai.adapter.ts`, change:
```typescript
{ role: 'system', content: buildSystemPrompt(payload.clientContext) },
```
to:
```typescript
{ role: 'system', content: buildSystemPrompt(payload.clientProfile, payload.clientContext) },
```

In `src/modules/ai/adapters/gemini.adapter.ts`, change:
```typescript
const result = await model.generateContent([
  buildSystemPrompt(payload.clientContext),
  buildUserMessage(payload),
]);
```
to:
```typescript
const result = await model.generateContent([
  buildSystemPrompt(payload.clientProfile, payload.clientContext),
  buildUserMessage(payload),
]);
```

- [ ] **Step 6: Update adapter specs' `mockPayload` to match new interface**

Both adapter spec files (`openai.adapter.spec.ts` and `gemini.adapter.spec.ts`) use a `mockPayload` missing the new required fields. Replace the `mockPayload` constant in each file with:

```typescript
import { ClientProfileType } from '../enums/client-profile-type.enum.js';

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
```

- [ ] **Step 7: Run all AI-module tests**

```bash
npx jest --testPathPattern=src/modules/ai
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/ai/utils/prompt-builder.ts src/modules/ai/utils/prompt-builder.spec.ts \
        src/modules/ai/adapters/openai.adapter.ts src/modules/ai/adapters/openai.adapter.spec.ts \
        src/modules/ai/adapters/gemini.adapter.ts src/modules/ai/adapters/gemini.adapter.spec.ts
git commit -m "feat: rewrite prompt-builder with profile-aware system prompt and per-profile message templates"
```

---

## Task 5: Wire ReportDispatchesService

**Files:**
- Modify: `src/modules/report-dispatches/report-dispatches.service.ts`
- Modify: `src/modules/report-dispatches/report-dispatches.service.spec.ts`

**Interfaces:**
- Consumes: `splitAndAggregateCampaigns` from Task 3; `ClientProfileType` from Task 1; extended `InsightsSummary` from Task 2; new `buildSystemPrompt` signature from Task 4

**Changes summary:**
1. Replace `aggregateInsights(rows)` with `splitAndAggregateCampaigns(rows)` — use `.total` for snapshot, pass `.acquisition` and `.sales` to payload
2. Load `client.profileType` alongside `client.aiStrategyContext`
3. Update `toInsightsSummary` to map 4 new action types
4. Update `computeDeltas` keys to include new `InsightsSummary` fields
5. Update the `AiReportPayload` construction to include `acquisition`, `sales`, `clientProfile`

- [ ] **Step 1: Update the failing tests**

In `report-dispatches.service.spec.ts`, update these sections:

**a) Update `buildService` mock** — `clientsService.findOne` must return `profileType`:

```typescript
{ provide: ClientsService, useValue: { findOne: jest.fn().mockResolvedValue({ aiStrategyContext: null, profileType: null }), ...overrides.clientsService } },
```

**b) Update the `toInsightsSummary` test** — add new fields to expected result and add a test for the new action types:

```typescript
it('maps MetaInsights string fields to numeric InsightsSummary', async () => {
  const { service } = await buildService();
  const insights = {
    impressions: '1000', clicks: '50', spend: '100.50',
    reach: '500', cpm: '10.05', cpc: '2.01', ctr: '5.00',
    date_start: '2026-07-27', date_stop: '2026-08-02',
    actions: [
      { action_type: 'purchase', value: '3' },
      { action_type: 'add_to_cart', value: '10' },
      { action_type: 'landing_page_view', value: '80' },
      { action_type: 'view_content', value: '60' },
      { action_type: 'initiate_checkout', value: '5' },
      { action_type: 'messaging_conversation_started_7d', value: '2' },
      { action_type: 'video_play', value: '15' },
    ],
  } as any;

  const result = (service as any).toInsightsSummary(insights);

  expect(result).toEqual({
    spend: 100.50, reach: 500, impressions: 1000, clicks: 50,
    ctr: 5.00, cpm: 10.05, purchases: 3, addToCart: 10, pageViews: 80,
    contentViews: 60, checkoutInitiated: 5, messagesStarted: 2, liveViews: 15,
  });
});

it('returns 0 for action types not present', async () => {
  const { service } = await buildService();
  const insights = {
    impressions: '100', clicks: '5', spend: '10', reach: '50',
    cpm: '1', cpc: '2', ctr: '5',
    date_start: '2026-07-27', date_stop: '2026-08-02',
  } as any;
  const result = (service as any).toInsightsSummary(insights);
  expect(result.purchases).toBe(0);
  expect(result.addToCart).toBe(0);
  expect(result.pageViews).toBe(0);
  expect(result.contentViews).toBe(0);
  expect(result.checkoutInitiated).toBe(0);
  expect(result.messagesStarted).toBe(0);
  expect(result.liveViews).toBe(0);
});
```

**c) Update `computeDeltas` tests** — the `current` and `previous` objects need the new fields:

```typescript
it('returns empty object when previous is null', async () => {
  const { service } = await buildService();
  const current = {
    spend: 100, reach: 500, impressions: 1000, clicks: 50, ctr: 5, cpm: 10,
    purchases: 3, addToCart: 10, pageViews: 80,
    contentViews: 60, checkoutInitiated: 5, messagesStarted: 2, liveViews: 15,
  };
  expect((service as any).computeDeltas(current, null)).toEqual({});
});

it('computes relative deltas correctly', async () => {
  const { service } = await buildService();
  const base = { spend: 100, reach: 500, impressions: 1000, clicks: 50, ctr: 5, cpm: 10, purchases: 3, addToCart: 10, pageViews: 80, contentViews: 60, checkoutInitiated: 5, messagesStarted: 2, liveViews: 15 };
  const current  = { ...base, spend: 110, reach: 565 };
  const previous = { ...base };
  const deltas = (service as any).computeDeltas(current, previous);
  expect(deltas.reach).toBeCloseTo(0.13, 2);
  expect(deltas.spend).toBeCloseTo(0.10, 2);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=report-dispatches
```

Expected: FAIL on `toInsightsSummary` and `computeDeltas` tests.

- [ ] **Step 3: Update `toInsightsSummary` in the service**

Replace the method body:

```typescript
private toInsightsSummary(insights: MetaInsights): InsightsSummary {
  const findAction = (type: string) =>
    parseInt(insights.actions?.find(a => a.action_type === type)?.value ?? '0', 10);

  return {
    spend: parseFloat(insights.spend ?? '0'),
    reach: parseInt(insights.reach ?? '0', 10),
    impressions: parseInt(insights.impressions ?? '0', 10),
    clicks: parseInt(insights.clicks ?? '0', 10),
    ctr: parseFloat(insights.ctr ?? '0'),
    cpm: parseFloat(insights.cpm ?? '0'),
    purchases: findAction('purchase'),
    addToCart: findAction('add_to_cart'),
    pageViews: findAction('landing_page_view'),
    contentViews: findAction('view_content'),
    checkoutInitiated: findAction('initiate_checkout'),
    messagesStarted: findAction('messaging_conversation_started_7d'),
    liveViews: findAction('video_play'),
  };
}
```

- [ ] **Step 4: Update `computeDeltas` key list**

```typescript
const keys: (keyof InsightsSummary)[] = [
  'spend', 'reach', 'impressions', 'clicks', 'ctr', 'cpm',
  'purchases', 'addToCart', 'pageViews',
  'contentViews', 'checkoutInitiated', 'messagesStarted', 'liveViews',
];
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=report-dispatches
```

Expected: all tests PASS.

- [ ] **Step 6: Update `buildAndSend` to use the splitter and new payload**

Add the import at the top of `report-dispatches.service.ts`:

```typescript
import { splitAndAggregateCampaigns } from '../ai/utils/campaign-splitter.js';
import { ClientProfileType } from '../clients/enums/client-profile-type.enum.js';
```

Replace the `buildAndSend` private method's data-gathering section. Find this block:

```typescript
try {
  const result = await this.campaignReportsService.getInsights(account.adAccountId, { ... });
  const rows = (result as PaginatedResult<MetaInsights>).data ?? [];
  rawInsights = this.aggregateInsights(rows);
} catch (err) {
  ...
}
```

Replace with:

```typescript
let acquisition: InsightsSummary | null = null;
let sales: InsightsSummary | null = null;

try {
  const result = await this.campaignReportsService.getInsights(account.adAccountId, {
    adAccountId: account.adAccountId,
    level: MetaInsightsLevel.ACCOUNT,
    since,
    until,
  } as any);
  const rows = (result as PaginatedResult<MetaInsights>).data ?? [];
  const split = splitAndAggregateCampaigns(rows);
  rawInsights = split.total;
  acquisition = split.acquisition;
  sales = split.sales;
} catch (err) {
  this.logger.error(`Erro ao buscar insights para conta ${account.adAccountId}`, err);
}
```

Then update the `AiReportPayload` construction and the `clientContext` loading block. Find:

```typescript
let clientContext: string | null = null;
try {
  const client = await this.clientsService.findOne(clientId);
  clientContext = client.aiStrategyContext ?? null;
} catch {
  // cliente não encontrado; continua sem contexto
}

const payload: AiReportPayload = {
  period: { since, until, weekNumber: this.getISOWeekNumber(weekStart) },
  current,
  previous,
  deltas,
  clientContext,
};
```

Replace with:

```typescript
let clientContext: string | null = null;
let clientProfile: ClientProfileType = ClientProfileType.SITE_SALES;
try {
  const client = await this.clientsService.findOne(clientId);
  clientContext = client.aiStrategyContext ?? null;
  clientProfile = client.profileType ?? ClientProfileType.SITE_SALES;
} catch {
  // cliente não encontrado; continua sem contexto
}

const payload: AiReportPayload = {
  period: { since, until, weekNumber: this.getISOWeekNumber(weekStart) },
  current,
  previous,
  deltas,
  acquisition,
  sales,
  clientProfile,
  clientContext,
};
```

- [ ] **Step 7: Remove the now-unused `aggregateInsights` method**

Delete the entire `private aggregateInsights(rows: MetaInsights[]): MetaInsights` method from the service — its logic is now in `campaign-splitter.ts`.

- [ ] **Step 8: Run the full test suite**

```bash
npm run test
```

Expected: all tests PASS. No TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add src/modules/report-dispatches/report-dispatches.service.ts \
        src/modules/report-dispatches/report-dispatches.service.spec.ts
git commit -m "feat: wire campaign splitter and client profile into report dispatch flow"
```
