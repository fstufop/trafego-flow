# Plano de Implementação: Campaign Reports — Breakdowns e Campos Adicionais

**Spec:** `tasks/specs/campaign_reports_adveronix_spec.md`
**Data:** 2026-06-16

---

## Análise de Alternativas

### Como encapsular os novos params no MetaAdsService

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| **A (Escolhida)** | `timeIncrement` e `breakdowns` entram em `MetaInsightsParams` — interface já existente | Nenhuma mudança de assinatura pública; params viajem encapsulados; testes existentes não quebram | — |
| B | Adicionar `timeIncrement?` e `breakdowns?` como parâmetros extras em `fetchInsights` e `fetchCampaignInsights` | Assinaturas explícitas | Quebra os testes existentes que verificam exatamente os argumentos da chamada; toda adição futura exigiria mais parâmetros |

**Decisão:** Alternativa A — `MetaInsightsParams` já é o contrato de entrada; adicionando os novos campos nela, todas as assinaturas públicas permanecem inalteradas e os mocks dos testes existentes continuam funcionando sem modificação.

---

### Como construir a cache key com os novos sufixos

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| **A (Escolhida)** | Helper privado `buildInsightsCacheKey(base, opts)` no `CampaignReportsService` | Lógica centralizada; fácil de testar; extensível | Arquivo cresce um pouco |
| B | Ternários inline em cada método | Menos código | Duplicação em `getInsights` e `getCampaignInsights`; difícil de manter |

**Decisão:** Alternativa A — a lógica de composição de chave já vai aparecer em dois métodos (`getInsights` e `getCampaignInsights`); centralizar evita divergência.

---

### Tipo de retorno de `fetchCampaignInsights` com breakdowns

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| **A (Escolhida)** | Union type `Promise<MetaInsights \| MetaApiPaginatedResponse<MetaInsights>>` — decidido em runtime pelo check `params.timeIncrement \|\| params.breakdowns` | Compatível com callers que não passam os novos params; zero breaking change | TypeScript exige narrowing no caller |
| B | Sempre retornar `MetaApiPaginatedResponse<MetaInsights>` e o caller extrai `data[0]` se quiser o single | Tipo uniforme | Breaking change nos testes e callers existentes; semanticamente errado para o caso "sem breakdown" |

**Decisão:** Alternativa A — preserva o contrato atual para callers sem breakdowns e o `CampaignReportsService` faz o narrowing com um type guard simples.

---

## Recursos Reutilizáveis Identificados

| Recurso | Localização | Uso |
|---|---|---|
| `ApiKeyGuard` | `src/common/guards/api-key.guard.ts` | Já aplicado no controller — sem mudança |
| `ValidationPipe` global | `src/main.ts` | `@IsEnum(MetaTimeIncrement)` e `@IsString()` para `breakdowns` já validados automaticamente |
| `makeAxiosResponse` helper | `meta-ads.service.spec.ts:43` | Reutilizar nos novos cenários de teste |
| `mockCampaignsApiResponse` / `mockInsightsApiResponse` | `campaign-reports.service.spec.ts` | Estender com campos de breakdown nos novos cenários |
| `insightsTtlMs` getter | `campaign-reports.service.ts:23` | Já implementado via `ConfigService` — sem mudança |

---

## Diagrama de Fluxo

```
GET /campaign-reports/insights?adAccountId=act_123&timeIncrement=1&breakdowns=age,gender
    ↓ ApiKeyGuard
CampaignReportsController.getInsights(@Query() query: GetInsightsQueryDto)
    ↓ query.timeIncrement = '1', query.breakdowns = 'age,gender'
CampaignReportsService.getInsights(adAccountId, query)
    ↓ buildInsightsCacheKey() → "meta:insights:act_123:campaign:last_30d:ti:1:bd:age,gender"
    ↓ cache.get(key)
        → HIT: retorna PaginatedResult<MetaInsights> direto
        → MISS:
            ↓ AdAccountsService.findByAdAccountId → AdAccountEntity
            ↓ AesCryptoService.decrypt(token)
            ↓ MetaAdsService.fetchInsights(adAccountId, token, {
                datePreset, level,
                timeIncrement: '1',
                breakdowns: 'age,gender'   ← normalizado/ordenado
              }, cursor?)
                ↓ GET /act_123/insights?time_increment=1&breakdowns=age,gender&fields=...
                ← { data: [{age:"25-34", gender:"female", ...}], paging: {} }
            ↓ cache.set(key, { data, paging }, insightsTtlMs)
← PaginatedResult<MetaInsights> (200)
```

---

## Tarefas Sequenciais

### Tarefa 1 — [DTO] Novos enums + campos em GetInsightsQueryDto

**Arquivo:** `src/modules/campaign-reports/dto/get-insights-query.dto.ts`

**O que fazer:**

Adicionar antes da classe `GetInsightsQueryDto`:
```typescript
export enum MetaTimeIncrement {
  DAILY   = '1',
  WEEKLY  = '7',
  MONTHLY = 'monthly',
  ALL_DAYS = 'all_days',
}

export enum MetaBreakdown {
  AGE                = 'age',
  GENDER             = 'gender',
  COUNTRY            = 'country',
  REGION             = 'region',
  PUBLISHER_PLATFORM = 'publisher_platform',
  DEVICE_PLATFORM    = 'device_platform',
}
```

Adicionar ao final da classe `GetInsightsQueryDto`:
```typescript
@ApiPropertyOptional({
  enum: MetaTimeIncrement,
  description: 'Granularidade temporal: 1=diário, 7=semanal, monthly, all_days',
})
@IsOptional()
@IsEnum(MetaTimeIncrement)
timeIncrement?: MetaTimeIncrement;

@ApiPropertyOptional({
  description: 'Breakdowns separados por vírgula. Valores: age, gender, country, region, publisher_platform, device_platform',
  example: 'age,gender',
})
@IsOptional()
@IsString()
breakdowns?: string;
```

**Depende de:** nada
**Testável:** `npm run build`

---

### Tarefa 2 — [Interfaces] MetaInsights + MetaInsightsParams + contratos de service

**Arquivos:**
- `src/modules/campaign-reports/interfaces/meta-campaign.interface.ts`
- `src/modules/campaign-reports/interfaces/meta-ads-service.interface.ts`
- `src/modules/campaign-reports/interfaces/campaign-reports-service.interface.ts`

**O que fazer:**

Em `meta-campaign.interface.ts`, atualizar o import para incluir `MetaTimeIncrement`:
```typescript
import { MetaDatePreset, MetaInsightsLevel, MetaTimeIncrement } from '../dto/get-insights-query.dto.js';
```

Expandir `MetaInsightsParams`:
```typescript
export interface MetaInsightsParams {
  datePreset: MetaDatePreset;
  level?: MetaInsightsLevel;
  timeIncrement?: MetaTimeIncrement;
  breakdowns?: string;
}
```

Expandir `MetaInsights` com os novos campos opcionais:
```typescript
// Campos de frequência e cliques únicos
frequency?: string;
unique_clicks?: string;
cost_per_unique_click?: string;

// ROAS
purchase_roas?: MetaAction[];

// Métricas de vídeo
video_play_actions?: MetaAction[];
video_p25_watched_actions?: MetaAction[];
video_p50_watched_actions?: MetaAction[];
video_p75_watched_actions?: MetaAction[];
video_p100_watched_actions?: MetaAction[];

// Campos de breakdown (presentes quando breakdowns são solicitados)
age?: string;
gender?: string;
country?: string;
region?: string;
publisher_platform?: string;
device_platform?: string;
```

Em `meta-ads-service.interface.ts`, atualizar `fetchCampaignInsights`:
```typescript
fetchCampaignInsights(
  campaignId: string,
  accessToken: string,
  params: MetaInsightsParams,
): Promise<MetaInsights | MetaApiPaginatedResponse<MetaInsights>>;
```

Em `campaign-reports-service.interface.ts`, atualizar `getCampaignInsights`:
```typescript
import { MetaTimeIncrement } from '../dto/get-insights-query.dto.js';

getCampaignInsights(
  campaignId: string,
  adAccountId: string,
  datePreset: MetaDatePreset,
  timeIncrement?: MetaTimeIncrement,
  breakdowns?: string,
): Promise<MetaInsights | PaginatedResult<MetaInsights>>;
```

**Depende de:** Tarefa 1
**Testável:** `npm run build`

---

### Tarefa 3 — [Service] MetaAdsService: INSIGHTS_FIELDS + params + fetchCampaignInsights union

**Arquivo:** `src/modules/campaign-reports/meta-ads.service.ts`

**O que fazer:**

Substituir `INSIGHTS_FIELDS`:
```typescript
const INSIGHTS_FIELDS =
  'campaign_id,campaign_name,impressions,clicks,spend,reach,cpm,cpc,ctr,' +
  'actions,cost_per_action_type,date_start,date_stop,' +
  'purchase_roas,frequency,unique_clicks,cost_per_unique_click,' +
  'video_play_actions,video_p25_watched_actions,video_p50_watched_actions,' +
  'video_p75_watched_actions,video_p100_watched_actions';
```

Em `fetchInsights`, adicionar os novos params ao objeto `params` da requisição:
```typescript
params: {
  fields: INSIGHTS_FIELDS,
  date_preset: params.datePreset,
  level: params.level,
  access_token: accessToken,
  ...(cursor && { after: cursor }),
  ...(params.timeIncrement && { time_increment: params.timeIncrement }),
  ...(params.breakdowns && { breakdowns: params.breakdowns }),
},
```

Reescrever `fetchCampaignInsights` para suportar retorno union:
```typescript
async fetchCampaignInsights(
  campaignId: string,
  accessToken: string,
  params: MetaInsightsParams,
): Promise<MetaInsights | MetaApiPaginatedResponse<MetaInsights>> {
  const url = `${this.baseUrl}/${campaignId}/insights`;
  const response = await firstValueFrom(
    this.httpService.get<MetaApiPaginatedResponse<MetaInsights>>(url, {
      params: {
        fields: INSIGHTS_FIELDS,
        date_preset: params.datePreset,
        access_token: accessToken,
        ...(params.timeIncrement && { time_increment: params.timeIncrement }),
        ...(params.breakdowns && { breakdowns: params.breakdowns }),
      },
    }),
  ).catch((err: MetaErrorResponse) => this.handleError(err, campaignId));

  // Com breakdowns ou timeIncrement: múltiplos registros → retorna response completo
  if (params.timeIncrement || params.breakdowns) {
    return response.data;
  }

  // Comportamento original: single item com guard de array vazio
  const insight = response.data.data[0];
  if (!insight) {
    throw new NotFoundException(
      `No insights found for campaign ${campaignId} on preset ${params.datePreset}`,
    );
  }
  return insight;
}
```

**Depende de:** Tarefa 2
**Testável:** `npm run build`; cobertura em Tarefa 6

---

### Tarefa 4 — [Service] CampaignReportsService: helper de cache key + novos params

**Arquivo:** `src/modules/campaign-reports/campaign-reports.service.ts`

**O que fazer:**

Adicionar helper privado `buildInsightsCacheKey`:
```typescript
private buildInsightsCacheKey(
  base: string,
  cursor?: string,
  timeIncrement?: string,
  breakdowns?: string,
): string {
  let key = base;
  if (timeIncrement) key += `:ti:${timeIncrement}`;
  if (breakdowns) {
    const sorted = breakdowns.split(',').map(s => s.trim()).sort().join(',');
    key += `:bd:${sorted}`;
  }
  if (cursor) key += `:cursor:${cursor}`;
  return key;
}
```

Atualizar `getInsights` para usar o helper e passar os novos params:
```typescript
async getInsights(adAccountId: string, query: GetInsightsQueryDto): Promise<PaginatedResult<MetaInsights>> {
  const level = query.level ?? MetaInsightsLevel.CAMPAIGN;
  const datePreset = query.datePreset ?? MetaDatePreset.LAST_30D;
  const cacheKey = this.buildInsightsCacheKey(
    `meta:insights:${adAccountId}:${level}:${datePreset}`,
    query.cursor,
    query.timeIncrement,
    query.breakdowns,
  );

  const cached = await this.cache.get<PaginatedResult<MetaInsights>>(cacheKey);
  if (cached) return cached;

  // ... (findByAdAccountId + isActive check) ...

  const result = await this.metaAdsService.fetchInsights(
    adAccountId, token,
    { datePreset, level, timeIncrement: query.timeIncrement, breakdowns: query.breakdowns },
    query.cursor,
  );
  // ... (cache.set + return paginated) ...
}
```

Atualizar `getCampaignInsights` para aceitar e usar os novos params:
```typescript
async getCampaignInsights(
  campaignId: string,
  adAccountId: string,
  datePreset: MetaDatePreset,
  timeIncrement?: MetaTimeIncrement,
  breakdowns?: string,
): Promise<MetaInsights | PaginatedResult<MetaInsights>> {
  const cacheKey = this.buildInsightsCacheKey(
    `meta:insights:campaign:${campaignId}:${datePreset}`,
    undefined,
    timeIncrement,
    breakdowns,
  );

  // Cache get com tipo union
  const cached = await this.cache.get<MetaInsights | PaginatedResult<MetaInsights>>(cacheKey);
  if (cached) return cached;

  // ... (findByAdAccountId + isActive check) ...

  const result = await this.metaAdsService.fetchCampaignInsights(
    campaignId, token, { datePreset, timeIncrement, breakdowns },
  );

  // MetaAdsService já faz o narrowing:
  // - com breakdowns/timeIncrement → MetaApiPaginatedResponse<MetaInsights>
  // - sem → MetaInsights (single)
  // Aqui apenas reembalamos se for paginated
  let toCache: MetaInsights | PaginatedResult<MetaInsights>;
  if (timeIncrement || breakdowns) {
    const paginatedResult = result as MetaApiPaginatedResponse<MetaInsights>;
    toCache = {
      data: paginatedResult.data,
      paging: { next: paginatedResult.paging?.cursors?.after },
    };
  } else {
    toCache = result as MetaInsights;
  }

  await this.cache.set(cacheKey, toCache, this.insightsTtlMs);
  return toCache;
}
```

Adicionar import de `MetaApiPaginatedResponse` e `MetaTimeIncrement` no topo do arquivo.

**Depende de:** Tarefa 3
**Testável:** `npm run build`; cobertura em Tarefa 7

---

### Tarefa 5 — [Controller] CampaignReportsController: novos query params

**Arquivo:** `src/modules/campaign-reports/campaign-reports.controller.ts`

**O que fazer:**

Atualizar import para incluir `MetaTimeIncrement`:
```typescript
import { GetInsightsQueryDto, MetaDatePreset, MetaTimeIncrement } from './dto/get-insights-query.dto.js';
```

Atualizar `getCampaignInsights`:
```typescript
@Get('insights/:campaignId')
@ApiOperation({ summary: 'Get insights for a specific campaign' })
@ApiQuery({ name: 'adAccountId', required: true, example: 'act_123456789' })
@ApiQuery({ name: 'datePreset', required: false, enum: MetaDatePreset })
@ApiQuery({ name: 'timeIncrement', required: false, enum: MetaTimeIncrement, description: '1=diário, 7=semanal, monthly, all_days' })
@ApiQuery({ name: 'breakdowns', required: false, description: 'age, gender, country, region, publisher_platform, device_platform (separados por vírgula)' })
getCampaignInsights(
  @Param('campaignId') campaignId: string,
  @Query('adAccountId') adAccountId: string,
  @Query('datePreset') datePreset: MetaDatePreset = MetaDatePreset.LAST_30D,
  @Query('timeIncrement') timeIncrement?: MetaTimeIncrement,
  @Query('breakdowns') breakdowns?: string,
) {
  return this.campaignReportsService.getCampaignInsights(
    campaignId, adAccountId, datePreset, timeIncrement, breakdowns,
  );
}
```

O endpoint `getInsights` não precisa de mudança no controller — os novos params já estão no DTO e o `@Query()` os captura automaticamente.

**Depende de:** Tarefa 4
**Testável:** `npm run start:dev` — Swagger mostra os novos params; `npm run build`

---

### Tarefa 6 — [Testes] MetaAdsService: novos cenários

**Arquivo:** `src/modules/campaign-reports/meta-ads.service.spec.ts`

**O que fazer:**

Em `describe('fetchInsights')`, adicionar:
- `it('should include time_increment param when timeIncrement provided')` — verifica que `params` da requisição HTTP contém `time_increment: '1'`
- `it('should include breakdowns param when breakdowns provided')` — verifica `breakdowns: 'age,gender'`
- `it('should include both time_increment and breakdowns when both provided')`

Em `describe('fetchCampaignInsights')`, adicionar:
- `it('should return single MetaInsights when no timeIncrement or breakdowns')` — comportamento atual
- `it('should return full MetaApiPaginatedResponse when timeIncrement provided')` — mock retorna `{ data: [insight], paging: {} }`; verifica que o retorno é o response completo, não `data[0]`
- `it('should return full MetaApiPaginatedResponse when breakdowns provided')` — idem
- `it('should NOT throw NotFoundException when timeIncrement provided and data is empty')` — com breakdowns/timeIncrement, array vazio é válido (não há o guard de `data[0]`)

**Depende de:** Tarefa 3
**Testável:** `npx jest --testPathPatterns="meta-ads.service"`

---

### Tarefa 7 — [Testes] CampaignReportsService: cache key helper + novos cenários

**Arquivo:** `src/modules/campaign-reports/campaign-reports.service.spec.ts`

**O que fazer:**

Adicionar ao `describe('getInsights')`:
- `it('should include timeIncrement in cache key when provided')` — verifica chave `meta:insights:act_123456789:campaign:last_30d:ti:1`
- `it('should include sorted breakdowns in cache key when provided')` — query com `breakdowns=gender,age`; verifica chave `meta:insights:act_123456789:campaign:last_30d:bd:age,gender`
- `it('should include both timeIncrement and breakdowns in cache key')` — verifica chave completa
- `it('should pass timeIncrement and breakdowns to MetaAdsService.fetchInsights')`

Adicionar `describe('getCampaignInsights')` para os novos cenários:
- `it('should return PaginatedResult when timeIncrement provided')` — mock de `fetchCampaignInsights` retorna `MetaApiPaginatedResponse`; verifica que retorno é `{ data: [...], paging: {...} }`
- `it('should return single MetaInsights when no params provided')` — comportamento atual
- `it('should use timeIncrement in cache key for getCampaignInsights')`
- `it('should use sorted breakdowns in cache key for getCampaignInsights')`

Adicionar `mockMetaAdsService.fetchCampaignInsights` scenarios para o novo retorno union (mock precisa retornar valores diferentes dependendo dos params).

**Depende de:** Tarefa 4
**Testável:** `npx jest --testPathPatterns="campaign-reports.service"`

---

## Grafo de Dependências

```
T1 (DTO — enums + campos)
    ↓
T2 (Interfaces — MetaInsights, MetaInsightsParams, contratos)
    ↓
T3 (MetaAdsService — INSIGHTS_FIELDS, params, union return)
    ↓
T4 (CampaignReportsService — cache key helper, novos params)
    ↓
T5 (Controller — query params + Swagger)

T3 → T6 (Testes MetaAdsService)
T4 → T7 (Testes CampaignReportsService)
```

**Totalmente sequencial** — cada tarefa depende da anterior. T6 e T7 podem rodar em paralelo após T3 e T4 respectivamente.

---

## Estimativa

| Tarefa | Complexidade | Estimativa |
|---|---|---|
| 1 — DTO: enums + campos | Baixa | 15 min |
| 2 — Interfaces: expansão | Baixa | 20 min |
| 3 — MetaAdsService: INSIGHTS_FIELDS + union | Média | 30 min |
| 4 — CampaignReportsService: helper + params | Média | 40 min |
| 5 — Controller: query params | Baixa | 15 min |
| 6 — Testes MetaAdsService | Média | 35 min |
| 7 — Testes CampaignReportsService | Alta | 45 min |
| **Total** | | **~3h20min** |

---

## Riscos e Dependências

### Alto impacto

- **Limite de combinações de breakdowns da Meta API:** A Meta não permite todas as combinações possíveis de breakdowns (ex: `age+gender+country` simultâneos são rejeitados com erro 400). O backend não valida isso — a Meta retorna uma mensagem de erro descritiva que o cliente deve exibir. Documentar esse comportamento na `docs/API.md` ao final.

- **`fetchCampaignInsights` com timeIncrement e array vazio:** Sem breakdowns, array vazio → `NotFoundException`. Com breakdowns/timeIncrement, array vazio é válido (campanha sem dados no breakdown específico) → não deve lançar exceção. A lógica na Tarefa 3 trata isso corretamente, mas o teste da Tarefa 6 precisa cobrir esse cenário explicitamente.

### Médio impacto

- **Sorting de breakdowns na cache key:** `breakdowns=gender,age` e `breakdowns=age,gender` devem gerar a mesma chave. O helper `buildInsightsCacheKey` da Tarefa 4 faz esse sort. O teste da Tarefa 7 deve verificar isso — é a proteção contra regressão mais crítica desta feature.

- **Type narrowing do union return em `getCampaignInsights`:** O TypeScript exige que o caller faça narrowing. A lógica na Tarefa 4 usa `timeIncrement || breakdowns` como discriminante — o mesmo check que o `MetaAdsService` usa internamente. Manter os dois checks sincronizados.

### Baixo impacto

- **Novos campos em `INSIGHTS_FIELDS` são opcionais:** A Meta só retorna os campos de vídeo (`video_p*`) se a campanha tiver criativos em vídeo. A interface já os declara como `?`, então a deserialização é segura. Sem risco de runtime crash.

- **Nenhum módulo novo para instalar:** Todas as dependências já estão presentes. Zero risco de conflito de pacotes.
