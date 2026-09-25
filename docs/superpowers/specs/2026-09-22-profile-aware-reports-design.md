# Profile-Aware Report Dispatches — Design Spec

**Data:** 2026-09-22  
**Autor:** Filipe Teodoro

---

## Contexto

O job de relatório semanal (`ReportDispatchesService`) hoje busca insights no nível `CAMPAIGN` e monta um relatório igual para todos os perfis de cliente. Precisamos diferenciá-lo por perfil:

- **Venda por Mensagem (`MESSAGE_SALES`)** — relatório por conjunto de anúncio: mensagens recebidas, custo por mensagem, data de início.
- **Live (`LIVE_SALES`)** — resultado da campanha de captação + alcance por anúncio das últimas duas lives (identificadas pela data `DD_MM_AA` no nome da campanha).
- **Insights de Adsets** — confirmar (e tornar explícito) que o job de alertas diários roda para todos os perfis, sem filtro.

---

## Novos tipos de dados

### `ai-provider.interface.ts`

```ts
export interface AdsetMessageRow {
  adsetName: string;
  messagesStarted: number;
  costPerMessage: number | null; // null quando messagesStarted === 0
  startDate: string;             // 'DD/MM/AA' vindo de adset.start_time
}

export interface AdReachRow {
  adName: string;
  reach: number;
}

export interface LiveReportData {
  liveDate: string;          // 'DD/MM/AAAA' formatado para exibição
  captationSpend: number;
  captationReach: number;
  captationClicks: number;
  adReaches: AdReachRow[];   // alcance por anúncio da campanha de captação
}
```

### Campos opcionais em `AiReportPayload`

```ts
adsetRows?: AdsetMessageRow[]; // MESSAGE_SALES
liveData?: LiveReportData[];   // LIVE_SALES, até 2 entradas
```

---

## Mudanças por camada

### 1. `MetaAdset` — `meta-campaign.interface.ts`

Adicionar campo:

```ts
start_time?: string; // ISO 8601, ex: "2026-08-01T10:00:00+0000"
```

### 2. `MetaAdsService` — `meta-ads.service.ts`

**`fetchAdsets`** — incluir `start_time` nos fields requisitados:

```
fields: 'id,name,updated_time,effective_status,start_time'
```

**Novo método `fetchAdsetMessageInsights`**:

```ts
async fetchAdsetMessageInsights(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<MetaInsights[]>
```

Parâmetros para o Graph API:
- `fields`: `adset_id,adset_name,spend,actions`
- `level`: `adset`
- `time_range`: `{ since, until }`

Retorna a lista completa de linhas (sem paginação adicional — o volume de adsets por conta é baixo).

**Novo método `fetchAdInsightsByPeriod`**:

```ts
async fetchAdInsightsByPeriod(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<MetaInsights[]>
```

Parâmetros:
- `fields`: `ad_id,ad_name,reach`
- `level`: `ad`
- `time_range`: `{ since, until }`

### 3. `CampaignReportsService` — `campaign-reports.service.ts`

**Novo método `getAdsetMessageRows`**:

```ts
async getAdsetMessageRows(
  adAccountId: string,
  since: string,
  until: string,
): Promise<AdsetMessageRow[]>
```

Fluxo:
1. Resolve token e conta via `adAccountsService`.
2. Chama `fetchAdsetMessageInsights`.
3. Chama `fetchAdsets` para obter `start_time` por `adset_id`.
4. Para cada linha de insight:
   - `messagesStarted` = `actions.messaging_conversation_started_7d` (0 se ausente)
   - `spend` = `parseFloat(row.spend ?? '0')`
   - `costPerMessage` = `messagesStarted > 0 ? spend / messagesStarted : null`
   - `startDate` = `start_time` do adset formatado como `DD/MM/AA`
5. Retorna array ordenado por `messagesStarted` desc.

**Novo método `getLiveReportData`**:

```ts
async getLiveReportData(adAccountId: string): Promise<LiveReportData[]>
```

Fluxo:
1. Busca insights no nível `CAMPAIGN` com `date_preset=last_60_days` para obter nomes de campanhas ativas recentemente.
2. Aplica regex `/(\d{2})_(\d{2})_(\d{2})/` nos `campaign_name` para extrair datas `DD_MM_AA`.
3. Converte para `Date`: `new Date(2000 + yy, mm - 1, dd)`.
4. Deduplica e ordena desc → pega as 2 mais recentes.
5. Para cada data:
   a. Identifica campanhas de captação: `campaign_name` contém a data E corresponde a `ACQUISITION_PATTERN` (`/(^|_)CAP[T]?(?:_|$)/i` — padrão existente em `campaign-splitter.ts`).
   b. Agrega insights dessas campanhas (`spend`, `reach`, `clicks`).
   c. Busca ad-level insights via `fetchAdInsightsByPeriod` com `since=live_date, until=today`.
   d. Filtra anúncios de campanhas de captação daquela data; mapeia para `AdReachRow[]` ordenado por `reach` desc.
6. Retorna array com até 2 entradas, ordenado mais recente primeiro.

### 4. `ReportDispatchesService` — `report-dispatches.service.ts`

No método `buildAndSend`, após determinar `clientProfile`, adicionar:

```ts
let adsetRows: AdsetMessageRow[] | undefined;
let liveData: LiveReportData[] | undefined;

if (clientProfile === ClientProfileType.MESSAGE_SALES) {
  adsetRows = await this.campaignReportsService
    .getAdsetMessageRows(account.adAccountId, since, until)
    .catch(err => {
      this.logger.error(`Erro ao buscar adset message rows para ${account.adAccountId}`, err);
      return undefined;
    });
}

if (clientProfile === ClientProfileType.LIVE_SALES) {
  liveData = await this.campaignReportsService
    .getLiveReportData(account.adAccountId)
    .catch(err => {
      this.logger.error(`Erro ao buscar live report data para ${account.adAccountId}`, err);
      return undefined;
    });
}
```

Incluir no `payload`:

```ts
const payload: AiReportPayload = {
  // ... campos existentes ...
  adsetRows,
  liveData,
};
```

### 5. `prompt-builder.ts`

**`buildMessageSalesMessage`** — substitui métricas agregadas atuais por tabela por adset:

```
Conjunto de anúncio | Mensagens | Custo por msg | Rodando desde
[adset.adsetName]   |    NNN    |   R$ N,NN     |  DD/MM/AA
...
```

Fallback: se `adsetRows` ausente ou vazio, usa comportamento atual (métricas agregadas).

**`buildLiveSalesMessage`** — substitui seção única por duas seções de live:

```
Live de DD/MM/AAAA
Captação: investimento R$ N, alcance N pessoas, N cliques

Alcance por anúncio:
[ad_name]: N pessoas
...

---

Live de DD/MM/AAAA
...
```

Fallback: se `liveData` ausente, usa comportamento atual.

### 6. `adset-alerts.service.ts`

Sem mudança funcional. O método `runForJob` já executa:

```ts
const allClients = await this.clientsService.findAll();
const clients = job.clientId
  ? allClients.filter(c => c.id === job.clientId)
  : allClients;
```

Não há filtro por `profileType`. **Adicionar comentário explícito** confirmando a intenção de incluir todos os perfis.

---

## Tratamento de erros e edge cases

| Cenário | Comportamento |
|---|---|
| `getAdsetMessageRows` falha | `adsetRows = undefined`; relatório usa fallback de métricas agregadas |
| `getLiveReportData` falha | `liveData = undefined`; relatório usa fallback atual |
| Menos de 2 lives encontradas | `liveData` com 1 entrada (ou 0) — prompt-builder renderiza o que tiver |
| Adset sem `start_time` | `startDate` exibido como `–` |
| Adset com 0 mensagens | `costPerMessage = null`, exibido como `–` |
| Nenhum anúncio de captação identificado para a live | `adReaches = []`; seção de alcance omitida |

---

## Testes

| Arquivo | O que cobrir |
|---|---|
| `campaign-reports.service.spec.ts` | `getAdsetMessageRows`: adset com mensagens, sem mensagens, start_time ausente; `getLiveReportData`: 0/1/2 lives encontradas, campanha captação ausente |
| `prompt-builder.spec.ts` | `buildMessageSalesMessage` com e sem `adsetRows`; `buildLiveSalesMessage` com 0/1/2 lives |
| `report-dispatches.service.spec.ts` | `buildAndSend` por perfil: MESSAGE_SALES inclui adsetRows no payload, LIVE_SALES inclui liveData, SITE_SALES não chama os novos métodos |

---

## Arquivos tocados

| Arquivo | Mudança |
|---|---|
| `campaign-reports/interfaces/meta-campaign.interface.ts` | `start_time?` em `MetaAdset` |
| `campaign-reports/meta-ads.service.ts` | `fetchAdsets` + `start_time`; novos `fetchAdsetMessageInsights`, `fetchAdInsightsByPeriod` |
| `campaign-reports/campaign-reports.service.ts` | Novos `getAdsetMessageRows`, `getLiveReportData` |
| `ai/interfaces/ai-provider.interface.ts` | Novos tipos `AdsetMessageRow`, `AdReachRow`, `LiveReportData`; campos opcionais em `AiReportPayload` |
| `report-dispatches/report-dispatches.service.ts` | Branch por perfil em `buildAndSend` |
| `ai/utils/prompt-builder.ts` | Reformulação de `buildMessageSalesMessage` e `buildLiveSalesMessage` |
| `adset-alerts/adset-alerts.service.ts` | Comentário explícito (sem mudança funcional) |
