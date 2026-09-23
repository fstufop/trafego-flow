# Profile-Aware Report Dispatches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diferenciar o relatório semanal por perfil de cliente: Venda por Mensagem exibe métricas por adset; Live exibe resultados de captação e alcance das 2 lives mais recentes; alertas de adsets confirmados para todos os perfis.

**Architecture:** Novos tipos são adicionados a `AiReportPayload` (campos opcionais por perfil). `CampaignReportsService` ganha dois novos métodos de busca especializada. `ReportDispatchesService.buildAndSend` faz branch por `clientProfile` para popular esses campos. `prompt-builder.ts` reformula os dois builders com fallback para o comportamento atual quando os dados novos estiverem ausentes.

**Tech Stack:** NestJS 11, TypeScript 5.7, Jest 30, Meta Graph API (level=adset e level=ad)

**Spec:** `docs/superpowers/specs/2026-09-22-profile-aware-reports-design.md`

## Global Constraints

- Nenhum campo novo é obrigatório: todos os campos de perfil em `AiReportPayload` são opcionais (`?`). Código existente que constrói o payload sem esses campos continua compilando sem erros.
- Todos os novos métodos de fetch são best-effort: erros são logados e retornam `undefined`, nunca derrubam o relatório.
- Os novos métodos em `MetaAdsService` e `CampaignReportsService` devem ser adicionados também às interfaces `IMetaAdsService` e `ICampaignReportsService`.
- Padrão de teste existente: `jest.fn()` no mock, `beforeEach(() => jest.clearAllMocks())`, asserções diretas.
- Rodar `npm run test` ao final de cada tarefa antes do commit. Rodar `npm run lint` ao final de cada tarefa antes do commit.
- Comando para um arquivo específico: `npx jest --testPathPattern=<filename>`.

## Review Focus

1. **Adset sem `start_time`**: Meta API pode omitir `start_time` se o adset nunca foi publicado. `startDate` deve aparecer como `"–"`, não quebrar.
2. **Conta sem lives nos últimos 60 dias**: `getLiveReportData` deve retornar `[]` silenciosamente, não lançar exceção.
3. **Campanha com data inválida no nome**: regex bate em `99_99_99` que `new Date()` aceita como inválida — filtrar `isNaN(liveDate.getTime())`.
4. **Adset com 0 mensagens**: `costPerMessage` deve ser `null`, exibido como `"–"` no template.
5. **Menos de 2 lives identificadas**: prompt-builder deve renderizar 1 live normalmente sem crash.

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/modules/ai/interfaces/ai-provider.interface.ts` | Modificar | Novos tipos `AdsetMessageRow`, `AdReachRow`, `LiveReportData`; campos opcionais em `AiReportPayload` |
| `src/modules/campaign-reports/interfaces/meta-campaign.interface.ts` | Modificar | Adicionar `start_time?` a `MetaAdset` |
| `src/modules/campaign-reports/interfaces/meta-ads-service.interface.ts` | Modificar | Declarar `fetchAdsetMessageInsights` e `fetchAdInsightsByPeriod` |
| `src/modules/campaign-reports/interfaces/campaign-reports-service.interface.ts` | Modificar | Declarar `getAdsetMessageRows` e `getLiveReportData` |
| `src/modules/campaign-reports/meta-ads.service.ts` | Modificar | Implementar os dois novos métodos; adicionar `start_time` ao `fetchAdsets` |
| `src/modules/campaign-reports/utils/live-date.util.ts` | Criar | Parsing de datas DD_MM_AA em nomes de campanha |
| `src/modules/campaign-reports/utils/live-date.util.spec.ts` | Criar | Testes do util |
| `src/modules/campaign-reports/campaign-reports.service.ts` | Modificar | `getAdsetMessageRows`, `getLiveReportData`, helper `formatAdsetDate` |
| `src/modules/campaign-reports/campaign-reports.service.spec.ts` | Modificar | Testes dos novos métodos |
| `src/modules/report-dispatches/report-dispatches.service.ts` | Modificar | Branch por perfil em `buildAndSend` |
| `src/modules/report-dispatches/report-dispatches.service.spec.ts` | Modificar | Testes do branch por perfil |
| `src/modules/ai/utils/prompt-builder.ts` | Modificar | Reformular `buildMessageSalesMessage` e `buildLiveSalesMessage` |
| `src/modules/ai/utils/prompt-builder.spec.ts` | Modificar | Testes dos novos templates |
| `src/modules/adset-alerts/adset-alerts.service.ts` | Modificar | Comentário explícito confirmando todos os perfis |

---

### Task 1: Extend type definitions

**Files:**
- Modify: `src/modules/ai/interfaces/ai-provider.interface.ts`
- Modify: `src/modules/campaign-reports/interfaces/meta-campaign.interface.ts`
- Modify: `src/modules/campaign-reports/interfaces/meta-ads-service.interface.ts`
- Modify: `src/modules/campaign-reports/interfaces/campaign-reports-service.interface.ts`

**Interfaces:**
- Produces: tipos `AdsetMessageRow`, `AdReachRow`, `LiveReportData`; campos `adsetRows?` e `liveData?` em `AiReportPayload`; `start_time?` em `MetaAdset`; assinaturas `fetchAdsetMessageInsights`, `fetchAdInsightsByPeriod`, `getAdsetMessageRows`, `getLiveReportData`

- [ ] **Step 1: Adicionar novos tipos a `ai-provider.interface.ts`**

Abrir `src/modules/ai/interfaces/ai-provider.interface.ts`. Logo após `export interface InsightsSummary { ... }` e antes de `export interface AiReportPayload`, inserir:

```ts
export interface AdsetMessageRow {
  adsetName: string;
  messagesStarted: number;
  costPerMessage: number | null;
  startDate: string; // 'DD/MM/AA'
}

export interface AdReachRow {
  adName: string;
  reach: number;
}

export interface LiveReportData {
  liveDate: string;        // 'DD/MM/AAAA' para exibição
  captationSpend: number;
  captationReach: number;
  captationClicks: number;
  adReaches: AdReachRow[]; // ordenado por reach desc
}
```

- [ ] **Step 2: Adicionar campos opcionais a `AiReportPayload`**

No final de `AiReportPayload`, antes do `}` de fechamento, adicionar:

```ts
  adsetRows?: AdsetMessageRow[];  // MESSAGE_SALES
  liveData?: LiveReportData[];    // LIVE_SALES, até 2 entradas
```

- [ ] **Step 3: Adicionar `start_time?` a `MetaAdset`**

Em `src/modules/campaign-reports/interfaces/meta-campaign.interface.ts`, localizar `export interface MetaAdset` e adicionar o campo:

```ts
export interface MetaAdset {
  id: string;
  name: string;
  updated_time: string;
  effective_status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED' | 'IN_PROCESS' | 'WITH_ISSUES';
  start_time?: string; // ISO 8601, ex: "2026-08-01T10:00:00+0000"
}
```

- [ ] **Step 4: Declarar novos métodos em `IMetaAdsService`**

Em `src/modules/campaign-reports/interfaces/meta-ads-service.interface.ts`, adicionar ao final da interface (antes do `}`):

```ts
  fetchAdsetMessageInsights(adAccountId: string, accessToken: string, since: string, until: string): Promise<MetaInsights[]>;
  fetchAdInsightsByPeriod(adAccountId: string, accessToken: string, since: string, until: string): Promise<MetaInsights[]>;
```

- [ ] **Step 5: Declarar novos métodos em `ICampaignReportsService`**

Em `src/modules/campaign-reports/interfaces/campaign-reports-service.interface.ts`, adicionar os imports necessários no topo (importar `AdsetMessageRow` e `LiveReportData` de `ai-provider.interface.ts`) e ao final da interface:

```ts
  getAdsetMessageRows(adAccountId: string, since: string, until: string): Promise<AdsetMessageRow[]>;
  getLiveReportData(adAccountId: string): Promise<LiveReportData[]>;
```

O import a adicionar ao topo do arquivo:

```ts
import { AdsetMessageRow, LiveReportData } from '../../ai/interfaces/ai-provider.interface.js';
```

- [ ] **Step 6: Verificar compilação**

```bash
npm run build 2>&1 | head -30
```

Esperado: sem erros de tipo. Se houver, corrigir antes de continuar.

- [ ] **Step 7: Commit**

```bash
git add src/modules/ai/interfaces/ai-provider.interface.ts \
        src/modules/campaign-reports/interfaces/meta-campaign.interface.ts \
        src/modules/campaign-reports/interfaces/meta-ads-service.interface.ts \
        src/modules/campaign-reports/interfaces/campaign-reports-service.interface.ts
git commit -m "feat: extend AiReportPayload and MetaAdset types for profile-aware reports"
```

---

### Task 2: Extend MetaAdsService

**Files:**
- Modify: `src/modules/campaign-reports/meta-ads.service.ts`

**Interfaces:**
- Consumes: `MetaInsights`, `MetaAdset` (com `start_time?`), `MetaApiPaginatedResponse` de `meta-campaign.interface.ts`
- Produces: `fetchAdsets` retorna `MetaAdset[]` com `start_time` populado; `fetchAdsetMessageInsights(adAccountId, accessToken, since, until): Promise<MetaInsights[]>`; `fetchAdInsightsByPeriod(adAccountId, accessToken, since, until): Promise<MetaInsights[]>`

- [ ] **Step 1: Atualizar `fetchAdsets` para incluir `start_time`**

Localizar a linha com `fields: 'id,name,updated_time,effective_status'` dentro de `fetchAdsets` e alterar para:

```ts
fields: 'id,name,updated_time,effective_status,start_time',
```

- [ ] **Step 2: Implementar `fetchAdsetMessageInsights`**

Adicionar o método após `fetchAdsetInsights` no arquivo:

```ts
async fetchAdsetMessageInsights(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<MetaInsights[]> {
  const url = `${this.baseUrl}/${adAccountId}/insights`;
  const response = await firstValueFrom(
    this.httpService.get<MetaApiPaginatedResponse<MetaInsights>>(url, {
      params: {
        fields: 'adset_id,adset_name,spend,actions',
        level: 'adset',
        time_range: JSON.stringify({ since, until }),
        access_token: accessToken,
      },
    }),
  ).catch((err: MetaErrorResponse) => this.handleError(err, adAccountId));
  return response.data.data;
}
```

- [ ] **Step 3: Implementar `fetchAdInsightsByPeriod`**

Adicionar o método após `fetchAdsetMessageInsights`:

```ts
async fetchAdInsightsByPeriod(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<MetaInsights[]> {
  const url = `${this.baseUrl}/${adAccountId}/insights`;
  const response = await firstValueFrom(
    this.httpService.get<MetaApiPaginatedResponse<MetaInsights>>(url, {
      params: {
        fields: 'ad_id,ad_name,campaign_name,reach',
        level: 'ad',
        time_range: JSON.stringify({ since, until }),
        access_token: accessToken,
      },
    }),
  ).catch((err: MetaErrorResponse) => this.handleError(err, adAccountId));
  return response.data.data;
}
```

- [ ] **Step 4: Verificar compilação**

```bash
npm run build 2>&1 | head -30
```

Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/modules/campaign-reports/meta-ads.service.ts
git commit -m "feat: add fetchAdsetMessageInsights and fetchAdInsightsByPeriod to MetaAdsService"
```

---

### Task 3: Create live-date.util.ts with tests

**Files:**
- Create: `src/modules/campaign-reports/utils/live-date.util.ts`
- Create: `src/modules/campaign-reports/utils/live-date.util.spec.ts`

**Interfaces:**
- Produces: `parseLiveCampaigns(campaigns: {id: string; name: string}[]): ParsedLiveCampaign[]`; `getLatestLiveDates(parsed: ParsedLiveCampaign[], count: number): Date[]`; `formatDisplayDate(date: Date): string`; `formatIsoDate(date: Date): string`; `LIVE_DATE_PATTERN: RegExp`; `ACQUISITION_PATTERN: RegExp`

- [ ] **Step 1: Escrever os testes (failing)**

Criar `src/modules/campaign-reports/utils/live-date.util.spec.ts`:

```ts
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
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
npx jest --testPathPattern=live-date.util.spec -v 2>&1 | tail -20
```

Esperado: FAIL — "Cannot find module './live-date.util.js'"

- [ ] **Step 3: Implementar `live-date.util.ts`**

Criar `src/modules/campaign-reports/utils/live-date.util.ts`:

```ts
export const LIVE_DATE_PATTERN = /(\d{2})_(\d{2})_(\d{2})/;
export const ACQUISITION_PATTERN = /(^|_)CAP[T]?(?:_|$)/i;

export interface ParsedLiveCampaign {
  campaignId: string;
  campaignName: string;
  liveDate: Date;
  liveDateStr: string; // 'DD_MM_AA'
  isAcquisition: boolean;
}

export function parseLiveCampaigns(
  campaigns: { id: string; name: string }[],
): ParsedLiveCampaign[] {
  return campaigns
    .map((c) => {
      const match = LIVE_DATE_PATTERN.exec(c.name);
      if (!match) return null;
      const [, dd, mm, yy] = match;
      const liveDate = new Date(
        2000 + parseInt(yy, 10),
        parseInt(mm, 10) - 1,
        parseInt(dd, 10),
      );
      if (isNaN(liveDate.getTime())) return null;
      return {
        campaignId: c.id,
        campaignName: c.name,
        liveDate,
        liveDateStr: `${dd}_${mm}_${yy}`,
        isAcquisition: ACQUISITION_PATTERN.test(c.name),
      };
    })
    .filter((c): c is ParsedLiveCampaign => c !== null);
}

export function getLatestLiveDates(
  parsed: ParsedLiveCampaign[],
  count: number,
): Date[] {
  const seen = new Map<string, Date>();
  for (const c of parsed) {
    if (!seen.has(c.liveDateStr)) seen.set(c.liveDateStr, c.liveDate);
  }
  return [...seen.values()]
    .sort((a, b) => b.getTime() - a.getTime())
    .slice(0, count);
}

export function formatDisplayDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

export function formatIsoDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${yyyy}-${mm}-${dd}`;
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

```bash
npx jest --testPathPattern=live-date.util.spec -v 2>&1 | tail -20
```

Esperado: PASS — todos os testes verdes.

- [ ] **Step 5: Lint**

```bash
npm run lint 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/campaign-reports/utils/live-date.util.ts \
        src/modules/campaign-reports/utils/live-date.util.spec.ts
git commit -m "feat: add live-date utility for parsing DD_MM_AA campaign name dates"
```

---

### Task 4: Add `getAdsetMessageRows` to CampaignReportsService

**Files:**
- Modify: `src/modules/campaign-reports/campaign-reports.service.ts`
- Modify: `src/modules/campaign-reports/campaign-reports.service.spec.ts`

**Interfaces:**
- Consumes: `MetaAdsService.fetchAdsetMessageInsights(adAccountId, token, since, until): Promise<MetaInsights[]>`; `MetaAdsService.fetchAdsets(adAccountId, token): Promise<MetaAdset[]>`; `AdsetMessageRow` de `ai-provider.interface.ts`
- Produces: `CampaignReportsService.getAdsetMessageRows(adAccountId, since, until): Promise<AdsetMessageRow[]>`

- [ ] **Step 1: Escrever os testes (failing)**

Abrir `src/modules/campaign-reports/campaign-reports.service.spec.ts`. Adicionar ao mock `mockMetaAdsService`:

```ts
fetchAdsetMessageInsights: jest.fn(),
fetchAdInsightsByPeriod: jest.fn(),
```

Adicionar o bloco de testes no final do describe principal:

```ts
describe('getAdsetMessageRows', () => {
  const adAccountId = 'act_123456789';
  const since = '2026-09-15';
  const until = '2026-09-21';

  beforeEach(() => {
    mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
    mockCrypto.decrypt.mockReturnValue('plaintext-token');
  });

  it('retorna rows ordenados por messagesStarted desc', async () => {
    mockMetaAdsService.fetchAdsetMessageInsights.mockResolvedValue([
      {
        adset_id: 'adset_1',
        adset_name: 'Adset A',
        spend: '100.00',
        actions: [{ action_type: 'messaging_conversation_started_7d', value: '10' }],
      },
      {
        adset_id: 'adset_2',
        adset_name: 'Adset B',
        spend: '200.00',
        actions: [{ action_type: 'messaging_conversation_started_7d', value: '5' }],
      },
    ]);
    mockMetaAdsService.fetchAdsets.mockResolvedValue([
      { id: 'adset_1', name: 'Adset A', start_time: '2026-08-01T10:00:00+0000', updated_time: '2026-08-01', effective_status: 'ACTIVE' },
      { id: 'adset_2', name: 'Adset B', start_time: '2026-08-15T10:00:00+0000', updated_time: '2026-08-15', effective_status: 'ACTIVE' },
    ]);

    const result = await service.getAdsetMessageRows(adAccountId, since, until);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ adsetName: 'Adset A', messagesStarted: 10, costPerMessage: 10, startDate: '01/08/26' });
    expect(result[1]).toEqual({ adsetName: 'Adset B', messagesStarted: 5, costPerMessage: 40, startDate: '15/08/26' });
  });

  it('define costPerMessage como null quando messagesStarted é 0', async () => {
    mockMetaAdsService.fetchAdsetMessageInsights.mockResolvedValue([
      { adset_id: 'adset_1', adset_name: 'Adset A', spend: '50.00', actions: [] },
    ]);
    mockMetaAdsService.fetchAdsets.mockResolvedValue([
      { id: 'adset_1', name: 'Adset A', start_time: '2026-08-01T00:00:00+0000', updated_time: '2026-08-01', effective_status: 'ACTIVE' },
    ]);

    const result = await service.getAdsetMessageRows(adAccountId, since, until);

    expect(result[0].costPerMessage).toBeNull();
  });

  it('define startDate como "–" quando start_time está ausente', async () => {
    mockMetaAdsService.fetchAdsetMessageInsights.mockResolvedValue([
      { adset_id: 'adset_1', adset_name: 'Adset A', spend: '50.00', actions: [] },
    ]);
    mockMetaAdsService.fetchAdsets.mockResolvedValue([
      { id: 'adset_1', name: 'Adset A', updated_time: '2026-08-01', effective_status: 'ACTIVE' },
    ]);

    const result = await service.getAdsetMessageRows(adAccountId, since, until);

    expect(result[0].startDate).toBe('–');
  });

  it('lança UnprocessableEntityException para conta inativa', async () => {
    mockAdAccountsService.findByAdAccountId.mockResolvedValue({ ...mockAccount, isActive: false });

    await expect(service.getAdsetMessageRows(adAccountId, since, until))
      .rejects.toThrow(UnprocessableEntityException);
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
npx jest --testPathPattern=campaign-reports.service.spec -v 2>&1 | grep -E "PASS|FAIL|getAdsetMessageRows"
```

Esperado: FAIL — "service.getAdsetMessageRows is not a function"

- [ ] **Step 3: Implementar `getAdsetMessageRows` em `CampaignReportsService`**

Adicionar o import no topo do arquivo (se não existir):

```ts
import { AdsetMessageRow, LiveReportData } from '../ai/interfaces/ai-provider.interface.js';
```

Adicionar o método no final da classe, antes do `}` de fechamento:

```ts
async getAdsetMessageRows(
  adAccountId: string,
  since: string,
  until: string,
): Promise<AdsetMessageRow[]> {
  const account = await this.adAccountsService.findByAdAccountId(adAccountId);
  if (!account.isActive) {
    throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);
  }
  const token = this.crypto.decrypt(account.accessToken);

  const [insightRows, adsets] = await Promise.all([
    this.metaAdsService.fetchAdsetMessageInsights(adAccountId, token, since, until),
    this.metaAdsService.fetchAdsets(adAccountId, token),
  ]);

  const startTimeById = new Map(adsets.map((a) => [a.id, a.start_time]));

  const rows: AdsetMessageRow[] = insightRows.map((row) => {
    const messagesStarted = parseInt(
      row.actions?.find((a) => a.action_type === 'messaging_conversation_started_7d')?.value ?? '0',
      10,
    );
    const spend = parseFloat(row.spend ?? '0');
    const costPerMessage = messagesStarted > 0 ? spend / messagesStarted : null;
    const rawStart = startTimeById.get(row.adset_id ?? '') ?? null;
    const startDate = rawStart ? this.formatAdsetDate(rawStart) : '–';
    return {
      adsetName: row.adset_name ?? row.adset_id ?? '',
      messagesStarted,
      costPerMessage,
      startDate,
    };
  });

  return rows.sort((a, b) => b.messagesStarted - a.messagesStarted);
}

private formatAdsetDate(isoString: string): string {
  const match = isoString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '–';
  const [, year, month, day] = match;
  return `${day}/${month}/${year.slice(2)}`;
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

```bash
npx jest --testPathPattern=campaign-reports.service.spec -v 2>&1 | grep -E "PASS|FAIL|✓|✗|getAdsetMessageRows"
```

Esperado: PASS em todos os testes de `getAdsetMessageRows`.

- [ ] **Step 5: Lint e commit**

```bash
npm run lint 2>&1 | head -10
git add src/modules/campaign-reports/campaign-reports.service.ts \
        src/modules/campaign-reports/campaign-reports.service.spec.ts
git commit -m "feat: add getAdsetMessageRows to CampaignReportsService"
```

---

### Task 5: Add `getLiveReportData` to CampaignReportsService

**Files:**
- Modify: `src/modules/campaign-reports/campaign-reports.service.ts`
- Modify: `src/modules/campaign-reports/campaign-reports.service.spec.ts`

**Interfaces:**
- Consumes: `MetaAdsService.fetchInsights(adAccountId, token, {since, until, level: CAMPAIGN}): Promise<MetaApiPaginatedResponse<MetaInsights>>`; `MetaAdsService.fetchAdInsightsByPeriod(adAccountId, token, since, until): Promise<MetaInsights[]>`; utilitários `parseLiveCampaigns`, `getLatestLiveDates`, `formatDisplayDate`, `formatIsoDate` de `live-date.util.ts`; `ACQUISITION_PATTERN` de `live-date.util.ts`; `LiveReportData` de `ai-provider.interface.ts`
- Produces: `CampaignReportsService.getLiveReportData(adAccountId): Promise<LiveReportData[]>`

- [ ] **Step 1: Escrever os testes (failing)**

Adicionar em `campaign-reports.service.spec.ts`, dentro do describe principal:

```ts
describe('getLiveReportData', () => {
  const adAccountId = 'act_123456789';

  beforeEach(() => {
    mockAdAccountsService.findByAdAccountId.mockResolvedValue(mockAccount);
    mockCrypto.decrypt.mockReturnValue('plaintext-token');
  });

  it('retorna LiveReportData para as 2 lives mais recentes', async () => {
    mockMetaAdsService.fetchInsights.mockResolvedValue({
      data: [
        { campaign_id: '1', campaign_name: 'LIVE_01_09_25_CAP', spend: '500', reach: '10000', clicks: '200', actions: [] },
        { campaign_id: '2', campaign_name: 'LIVE_01_09_25_VENDAS', spend: '300', reach: '5000', clicks: '100', actions: [] },
        { campaign_id: '3', campaign_name: 'LIVE_15_08_25_CAP', spend: '400', reach: '8000', clicks: '150', actions: [] },
        { campaign_id: '4', campaign_name: 'LIVE_01_07_25_CAP', spend: '200', reach: '4000', clicks: '80', actions: [] },
      ],
      paging: {},
    });
    mockMetaAdsService.fetchAdInsightsByPeriod
      .mockResolvedValueOnce([
        { ad_id: 'ad_1', ad_name: 'Anuncio A', campaign_name: 'LIVE_01_09_25_CAP', reach: '3000' },
        { ad_id: 'ad_2', ad_name: 'Anuncio B', campaign_name: 'LIVE_01_09_25_CAP', reach: '2000' },
      ])
      .mockResolvedValueOnce([
        { ad_id: 'ad_3', ad_name: 'Anuncio C', campaign_name: 'LIVE_15_08_25_CAP', reach: '4000' },
      ]);

    const result = await service.getLiveReportData(adAccountId);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      captationSpend: 500,
      captationReach: 10000,
      captationClicks: 200,
    });
    expect(result[0].adReaches).toEqual([
      { adName: 'Anuncio A', reach: 3000 },
      { adName: 'Anuncio B', reach: 2000 },
    ]);
    expect(result[1].captationSpend).toBe(400);
  });

  it('retorna [] quando não há campanhas com data no nome', async () => {
    mockMetaAdsService.fetchInsights.mockResolvedValue({
      data: [{ campaign_id: '1', campaign_name: 'CAMPANHA_SEM_DATA', spend: '100', reach: '1000', clicks: '10', actions: [] }],
      paging: {},
    });

    const result = await service.getLiveReportData(adAccountId);
    expect(result).toEqual([]);
    expect(mockMetaAdsService.fetchAdInsightsByPeriod).not.toHaveBeenCalled();
  });

  it('retorna 1 live quando só há 1 data identificada', async () => {
    mockMetaAdsService.fetchInsights.mockResolvedValue({
      data: [{ campaign_id: '1', campaign_name: 'LIVE_01_09_25_CAP', spend: '500', reach: '10000', clicks: '200', actions: [] }],
      paging: {},
    });
    mockMetaAdsService.fetchAdInsightsByPeriod.mockResolvedValue([]);

    const result = await service.getLiveReportData(adAccountId);
    expect(result).toHaveLength(1);
  });

  it('lança UnprocessableEntityException para conta inativa', async () => {
    mockAdAccountsService.findByAdAccountId.mockResolvedValue({ ...mockAccount, isActive: false });
    await expect(service.getLiveReportData(adAccountId)).rejects.toThrow(UnprocessableEntityException);
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
npx jest --testPathPattern=campaign-reports.service.spec -v 2>&1 | grep -E "PASS|FAIL|getLiveReportData"
```

Esperado: FAIL — "service.getLiveReportData is not a function"

- [ ] **Step 3: Adicionar imports em `campaign-reports.service.ts`**

No topo do arquivo, adicionar:

```ts
import {
  parseLiveCampaigns,
  getLatestLiveDates,
  formatDisplayDate,
  formatIsoDate,
  ACQUISITION_PATTERN,
} from './utils/live-date.util.js';
```

- [ ] **Step 4: Implementar `getLiveReportData`**

Adicionar o método após `getAdsetMessageRows` na classe:

```ts
async getLiveReportData(adAccountId: string): Promise<LiveReportData[]> {
  const account = await this.adAccountsService.findByAdAccountId(adAccountId);
  if (!account.isActive) {
    throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);
  }
  const token = this.crypto.decrypt(account.accessToken);

  const today = new Date();
  const sixtyDaysAgo = new Date(today);
  sixtyDaysAgo.setDate(today.getDate() - 60);
  const since60 = formatIsoDate(sixtyDaysAgo);
  const todayStr = formatIsoDate(today);

  const insightResult = await this.metaAdsService.fetchInsights(adAccountId, token, {
    since: since60,
    until: todayStr,
    level: MetaInsightsLevel.CAMPAIGN,
  });

  const campaigns = insightResult.data
    .map((r) => ({ id: r.campaign_id ?? '', name: r.campaign_name ?? '' }))
    .filter((c) => c.id && c.name);

  const parsed = parseLiveCampaigns(campaigns);
  const latestDates = getLatestLiveDates(parsed, 2);

  if (latestDates.length === 0) return [];

  const results: LiveReportData[] = [];

  for (const liveDate of latestDates) {
    const liveDateIso = formatIsoDate(liveDate);
    const liveDateDisplay = formatDisplayDate(liveDate);
    const dd = String(liveDate.getDate()).padStart(2, '0');
    const mm = String(liveDate.getMonth() + 1).padStart(2, '0');
    const yy = String(liveDate.getFullYear()).slice(2);
    const liveDateStr = `${dd}_${mm}_${yy}`;

    const captationRows = insightResult.data.filter((r) => {
      const name = r.campaign_name ?? '';
      return name.includes(liveDateStr) && ACQUISITION_PATTERN.test(name);
    });

    let captationSpend = 0;
    let captationReach = 0;
    let captationClicks = 0;
    for (const row of captationRows) {
      captationSpend += parseFloat(row.spend ?? '0');
      captationReach += parseInt(row.reach ?? '0', 10);
      captationClicks += parseInt(row.clicks ?? '0', 10);
    }

    const adRows = await this.metaAdsService.fetchAdInsightsByPeriod(
      adAccountId,
      token,
      liveDateIso,
      todayStr,
    );

    const adReaches = adRows
      .filter((r) => {
        const name = r.campaign_name ?? '';
        return name.includes(liveDateStr) && ACQUISITION_PATTERN.test(name);
      })
      .map((r) => ({
        adName: r.ad_name ?? r.ad_id ?? '',
        reach: parseInt(r.reach ?? '0', 10),
      }))
      .filter((r) => r.adName && r.reach > 0)
      .sort((a, b) => b.reach - a.reach);

    results.push({ liveDate: liveDateDisplay, captationSpend, captationReach, captationClicks, adReaches });
  }

  return results;
}
```

- [ ] **Step 5: Rodar os testes para confirmar que passam**

```bash
npx jest --testPathPattern=campaign-reports.service.spec -v 2>&1 | grep -E "PASS|FAIL|✓|✗|getLiveReportData"
```

Esperado: PASS em todos os testes de `getLiveReportData`.

- [ ] **Step 6: Rodar suite completa de campaign-reports**

```bash
npx jest --testPathPattern=campaign-reports.service.spec 2>&1 | tail -10
```

Esperado: todos os testes anteriores continuam passando.

- [ ] **Step 7: Lint e commit**

```bash
npm run lint 2>&1 | head -10
git add src/modules/campaign-reports/campaign-reports.service.ts \
        src/modules/campaign-reports/campaign-reports.service.spec.ts
git commit -m "feat: add getLiveReportData to CampaignReportsService"
```

---

### Task 6: Update ReportDispatchesService.buildAndSend

**Files:**
- Modify: `src/modules/report-dispatches/report-dispatches.service.ts`
- Modify: `src/modules/report-dispatches/report-dispatches.service.spec.ts`

**Interfaces:**
- Consumes: `CampaignReportsService.getAdsetMessageRows(adAccountId, since, until): Promise<AdsetMessageRow[]>`; `CampaignReportsService.getLiveReportData(adAccountId): Promise<LiveReportData[]>`; `ClientProfileType.MESSAGE_SALES`, `ClientProfileType.LIVE_SALES`; `AdsetMessageRow`, `LiveReportData` de `ai-provider.interface.ts`
- Produces: payload passado a `aiService.generateReport` inclui `adsetRows` quando `MESSAGE_SALES` e `liveData` quando `LIVE_SALES`

- [ ] **Step 1: Adicionar imports em `report-dispatches.service.ts`**

Verificar que `AdsetMessageRow` e `LiveReportData` estão importados de `ai-provider.interface.ts`. Se não estiver, adicionar ao import existente:

```ts
import { InsightsSummary, AiReportPayload, AdsetMessageRow, LiveReportData } from '../ai/interfaces/ai-provider.interface.js';
```

- [ ] **Step 2: Adicionar mock dos novos métodos no `buildService` do spec**

Em `report-dispatches.service.spec.ts`, dentro de `buildService`, alterar o mock de `CampaignReportsService`:

```ts
{ provide: CampaignReportsService, useValue: {
  getInsights: jest.fn().mockResolvedValue({ data: [] }),
  getAdsetMessageRows: jest.fn().mockResolvedValue([]),
  getLiveReportData: jest.fn().mockResolvedValue([]),
  ...overrides.campaignReportsService,
}},
```

- [ ] **Step 3: Escrever testes do branch por perfil (failing)**

Adicionar no describe principal de `report-dispatches.service.spec.ts`:

```ts
describe('buildAndSend — branch por clientProfile', () => {
  it('chama getAdsetMessageRows e inclui adsetRows no payload para MESSAGE_SALES', async () => {
    const adsetRows: AdsetMessageRow[] = [
      { adsetName: 'Conjunto A', messagesStarted: 10, costPerMessage: 5, startDate: '01/08/26' },
    ];
    const { service } = await buildService({
      clientsService: { findOne: jest.fn().mockResolvedValue({ aiStrategyContext: null, profileType: 'message_sales' }) },
      campaignReportsService: {
        getInsights: jest.fn().mockResolvedValue({ data: [] }),
        getAdsetMessageRows: jest.fn().mockResolvedValue(adsetRows),
        getLiveReportData: jest.fn().mockResolvedValue([]),
      },
    });

    const generateReport = jest.fn().mockResolvedValue('texto');
    (service as any).aiService = { generateReport };

    await (service as any).buildAndSend(
      'client-1',
      { adAccountId: 'act_123', accountName: 'Conta' },
      [{ groupJid: 'jid@g.us' }],
      new Date('2026-09-14'),
    );

    const payload = generateReport.mock.calls[0]?.[0];
    expect(payload?.adsetRows).toEqual(adsetRows);
    expect(payload?.liveData).toBeUndefined();
  });

  it('chama getLiveReportData e inclui liveData no payload para LIVE_SALES', async () => {
    const liveData: LiveReportData[] = [
      { liveDate: '01/09/2026', captationSpend: 500, captationReach: 10000, captationClicks: 200, adReaches: [] },
    ];
    const { service } = await buildService({
      clientsService: { findOne: jest.fn().mockResolvedValue({ aiStrategyContext: null, profileType: 'live_sales' }) },
      campaignReportsService: {
        getInsights: jest.fn().mockResolvedValue({ data: [] }),
        getAdsetMessageRows: jest.fn().mockResolvedValue([]),
        getLiveReportData: jest.fn().mockResolvedValue(liveData),
      },
    });

    const generateReport = jest.fn().mockResolvedValue('texto');
    (service as any).aiService = { generateReport };

    await (service as any).buildAndSend(
      'client-1',
      { adAccountId: 'act_123', accountName: 'Conta' },
      [{ groupJid: 'jid@g.us' }],
      new Date('2026-09-14'),
    );

    const payload = generateReport.mock.calls[0]?.[0];
    expect(payload?.liveData).toEqual(liveData);
    expect(payload?.adsetRows).toBeUndefined();
  });

  it('não chama getAdsetMessageRows nem getLiveReportData para SITE_SALES', async () => {
    const mockGetAdsetRows = jest.fn().mockResolvedValue([]);
    const mockGetLiveData = jest.fn().mockResolvedValue([]);
    const { service } = await buildService({
      clientsService: { findOne: jest.fn().mockResolvedValue({ aiStrategyContext: null, profileType: 'site_sales' }) },
      campaignReportsService: {
        getInsights: jest.fn().mockResolvedValue({ data: [] }),
        getAdsetMessageRows: mockGetAdsetRows,
        getLiveReportData: mockGetLiveData,
      },
    });

    await (service as any).buildAndSend(
      'client-1',
      { adAccountId: 'act_123', accountName: 'Conta' },
      [{ groupJid: 'jid@g.us' }],
      new Date('2026-09-14'),
    );

    expect(mockGetAdsetRows).not.toHaveBeenCalled();
    expect(mockGetLiveData).not.toHaveBeenCalled();
  });

  it('continua sem adsetRows quando getAdsetMessageRows lança erro', async () => {
    const { service } = await buildService({
      clientsService: { findOne: jest.fn().mockResolvedValue({ aiStrategyContext: null, profileType: 'message_sales' }) },
      campaignReportsService: {
        getInsights: jest.fn().mockResolvedValue({ data: [] }),
        getAdsetMessageRows: jest.fn().mockRejectedValue(new Error('API timeout')),
        getLiveReportData: jest.fn().mockResolvedValue([]),
      },
    });

    const generateReport = jest.fn().mockResolvedValue('texto');
    (service as any).aiService = { generateReport };

    // Não deve lançar; deve continuar e gerar relatório com fallback
    await expect(
      (service as any).buildAndSend(
        'client-1',
        { adAccountId: 'act_123', accountName: 'Conta' },
        [{ groupJid: 'jid@g.us' }],
        new Date('2026-09-14'),
      ),
    ).resolves.not.toThrow();

    const payload = generateReport.mock.calls[0]?.[0];
    expect(payload?.adsetRows).toBeUndefined();
  });
});
```

- [ ] **Step 4: Rodar os testes para confirmar que falham**

```bash
npx jest --testPathPattern=report-dispatches.service.spec -v 2>&1 | grep -E "PASS|FAIL|branch por"
```

Esperado: FAIL.

- [ ] **Step 5: Implementar o branch por perfil em `buildAndSend`**

Em `report-dispatches.service.ts`, localizar o bloco de fetch do clientProfile (linhas ~172-180):

```ts
let clientContext: string | null = null;
let clientProfile: ClientProfileType = ClientProfileType.SITE_SALES;
try {
  const client = await this.clientsService.findOne(clientId);
  clientContext = client.aiStrategyContext ?? null;
  clientProfile = client.profileType ?? ClientProfileType.SITE_SALES;
} catch {
  // cliente não encontrado; continua sem contexto
}
```

Imediatamente após esse bloco e antes de `const payload: AiReportPayload`, inserir:

```ts
let adsetRows: AdsetMessageRow[] | undefined;
let liveData: LiveReportData[] | undefined;

if (clientProfile === ClientProfileType.MESSAGE_SALES) {
  adsetRows = await this.campaignReportsService
    .getAdsetMessageRows(account.adAccountId, since, until)
    .catch((err) => {
      this.logger.error(`Erro ao buscar adset message rows para ${account.adAccountId}`, err);
      return undefined;
    });
}

if (clientProfile === ClientProfileType.LIVE_SALES) {
  liveData = await this.campaignReportsService
    .getLiveReportData(account.adAccountId)
    .catch((err) => {
      this.logger.error(`Erro ao buscar live report data para ${account.adAccountId}`, err);
      return undefined;
    });
}
```

Depois, na construção do `payload`, adicionar os dois campos:

```ts
const payload: AiReportPayload = {
  period: { since, until, weekNumber: this.getISOWeekNumber(weekStart) },
  current,
  previous,
  deltas,
  acquisition,
  sales,
  clientProfile,
  clientContext,
  adsetRows,
  liveData,
};
```

- [ ] **Step 6: Rodar os testes para confirmar que passam**

```bash
npx jest --testPathPattern=report-dispatches.service.spec -v 2>&1 | tail -15
```

Esperado: PASS em todos os testes, incluindo os novos.

- [ ] **Step 7: Lint e commit**

```bash
npm run lint 2>&1 | head -10
git add src/modules/report-dispatches/report-dispatches.service.ts \
        src/modules/report-dispatches/report-dispatches.service.spec.ts
git commit -m "feat: add profile-aware data fetching to ReportDispatchesService.buildAndSend"
```

---

### Task 7: Update prompt-builder.ts

**Files:**
- Modify: `src/modules/ai/utils/prompt-builder.ts`
- Modify: `src/modules/ai/utils/prompt-builder.spec.ts`

**Interfaces:**
- Consumes: `AiReportPayload.adsetRows?: AdsetMessageRow[]`; `AiReportPayload.liveData?: LiveReportData[]`
- Produces: `buildUserMessage` com templates diferenciados por perfil, com fallback quando campos opcionais ausentes

- [ ] **Step 1: Escrever os testes do MESSAGE_SALES (failing)**

Adicionar em `prompt-builder.spec.ts` os seguintes blocos de teste:

```ts
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

describe('buildUserMessage — LIVE_SALES', () => {
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
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
npx jest --testPathPattern=prompt-builder.spec -v 2>&1 | grep -E "PASS|FAIL|MESSAGE_SALES|LIVE_SALES"
```

Esperado: FAIL nos novos testes.

- [ ] **Step 3: Reformular `buildMessageSalesMessage` em `prompt-builder.ts`**

Localizar a função `buildMessageSalesMessage` e substituí-la:

```ts
function buildMessageSalesMessage(payload: AiReportPayload): string {
  const { period, current, deltas, clientContext, previous, adsetRows } = payload;
  const lines: string[] = header(period.weekNumber, period.since, period.until);

  if (adsetRows && adsetRows.length > 0) {
    lines.push('Conjuntos de anuncio:');
    lines.push('');
    for (const row of adsetRows) {
      const cpm = row.costPerMessage !== null ? `R$ ${fmtBRL(row.costPerMessage)}` : '–';
      lines.push(row.adsetName);
      lines.push(`Mensagens recebidas: ${fmtInt(row.messagesStarted)}`);
      lines.push(`Custo por mensagem: ${cpm}`);
      lines.push(`Rodando desde: ${row.startDate}`);
      lines.push('');
    }
  } else {
    lines.push(`Investimento: R$ ${fmtBRL(current.spend)}`);
    if (current.reach > 0) lines.push(`Alcance: ${fmtInt(current.reach)} pessoas impactadas`);
    if (current.messagesStarted > 0) lines.push(`Conversas iniciadas: ${fmtInt(current.messagesStarted)} novos contatos no direct`);
    if (current.clicks > 0) lines.push(`Cliques nos anuncios: ${fmtInt(current.clicks)}`);
    lines.push('');
  }

  lines.push(...footer(deltas, clientContext, previous));
  return lines.join('\n');
}
```

- [ ] **Step 4: Reformular `buildLiveSalesMessage` em `prompt-builder.ts`**

Localizar a função `buildLiveSalesMessage` e substituí-la:

```ts
function buildLiveSalesMessage(payload: AiReportPayload): string {
  const { period, current, deltas, clientContext, previous, liveData } = payload;
  const lines: string[] = header(period.weekNumber, period.since, period.until);

  if (liveData && liveData.length > 0) {
    for (const live of liveData) {
      lines.push(`Live de ${live.liveDate}`);
      lines.push('');
      lines.push('Captacao:');
      lines.push(`Investimento: R$ ${fmtBRL(live.captationSpend)}`);
      if (live.captationReach > 0) lines.push(`Alcance: ${fmtInt(live.captationReach)} pessoas`);
      if (live.captationClicks > 0) lines.push(`Cliques: ${fmtInt(live.captationClicks)}`);
      if (live.adReaches.length > 0) {
        lines.push('');
        lines.push('Alcance por anuncio:');
        for (const ad of live.adReaches) {
          lines.push(`${ad.adName}: ${fmtInt(ad.reach)} pessoas`);
        }
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  } else {
    lines.push(`Investimento: R$ ${fmtBRL(current.spend)}`);
    if (current.reach > 0) lines.push(`Alcance: ${fmtInt(current.reach)} pessoas impactadas`);
    if (current.liveViews > 0) lines.push(`Visualizacoes da live: ${fmtInt(current.liveViews)}`);
    if (current.clicks > 0) lines.push(`Cliques nos anuncios: ${fmtInt(current.clicks)}`);
    if (current.purchases > 0) lines.push(`Compras: ${fmtInt(current.purchases)}`);
    lines.push('');
  }

  lines.push(...footer(deltas, clientContext, previous));
  return lines.join('\n');
}
```

- [ ] **Step 5: Rodar os testes para confirmar que passam**

```bash
npx jest --testPathPattern=prompt-builder.spec -v 2>&1 | tail -20
```

Esperado: PASS em todos os testes, incluindo os pré-existentes.

- [ ] **Step 6: Lint e commit**

```bash
npm run lint 2>&1 | head -10
git add src/modules/ai/utils/prompt-builder.ts \
        src/modules/ai/utils/prompt-builder.spec.ts
git commit -m "feat: reformulate MESSAGE_SALES and LIVE_SALES prompt builders with per-adset and per-live templates"
```

---

### Task 8: Confirm adset-alerts runs for all profiles

**Files:**
- Modify: `src/modules/adset-alerts/adset-alerts.service.ts`

- [ ] **Step 1: Adicionar comentário explícito em `runForJob`**

Localizar o bloco em `adset-alerts.service.ts` (linhas ~57-60):

```ts
const allClients = await this.clientsService.findAll();
const clients = job.clientId
  ? allClients.filter((c) => c.id === job.clientId)
  : allClients;
```

Adicionar comentário acima:

```ts
// Intencional: roda para todos os perfis (SITE_SALES, MESSAGE_SALES, LIVE_SALES).
// Não filtrar por profileType aqui.
const allClients = await this.clientsService.findAll();
const clients = job.clientId
  ? allClients.filter((c) => c.id === job.clientId)
  : allClients;
```

- [ ] **Step 2: Rodar suite completa**

```bash
npm run test 2>&1 | tail -20
```

Esperado: todos os testes passando.

- [ ] **Step 3: Lint final**

```bash
npm run lint 2>&1 | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/adset-alerts/adset-alerts.service.ts
git commit -m "docs: clarify adset-alerts runs for all client profiles"
```

---

## Self-Review

**Spec coverage:**
- ✅ MESSAGE_SALES: adset rows com mensagens, custo/msg, data início → Tasks 2, 4, 7
- ✅ LIVE_SALES: 2 lives, captação por live, alcance por anúncio → Tasks 3, 5, 7
- ✅ Adset insights para todos os perfis → Task 8
- ✅ Fallbacks em erros de fetch → Task 6
- ✅ `start_time` adicionado aos adsets → Tasks 1, 2

**Placeholder scan:** Nenhum TBD ou TODO encontrado. Todos os code blocks têm implementação concreta.

**Type consistency:** 
- `AdsetMessageRow` definido em Task 1, usado em Tasks 4, 6, 7 com mesmo nome.
- `LiveReportData` definido em Task 1, usado em Tasks 5, 6, 7 com mesmo nome.
- `fetchAdsetMessageInsights` declarado em Task 1, implementado em Task 2, consumido em Task 4.
- `fetchAdInsightsByPeriod` declarado em Task 1, implementado em Task 2, consumido em Task 5.

**Review Focus — testes adicionados:**
1. **Adset sem `start_time`** → Task 4, Step 1: "define startDate como '–' quando start_time está ausente"
2. **0 lives nos últimos 60 dias** → Task 5, Step 1: "retorna [] quando não há campanhas com data no nome"
3. **Data inválida no nome** → Task 3, Step 1: "descarta datas inválidas (99_99_99)"
4. **0 mensagens no adset** → Task 4, Step 1: "define costPerMessage como null quando messagesStarted é 0"
5. **Menos de 2 lives** → Task 5, Step 1: "retorna 1 live quando só há 1 data identificada"; Task 7, Step 1: "renderiza 1 live normalmente quando liveData tem 1 entrada"
