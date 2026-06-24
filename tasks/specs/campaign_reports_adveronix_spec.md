# Spec: Campaign Reports — Breakdowns e Campos Adicionais (Adveronix Parity)

**Data:** 2026-06-16

## 1. Objetivo

Expandir os endpoints de insights do módulo `campaign-reports` para cobrir as funcionalidades que o Adveronix oferece via Meta Marketing API e que ainda não estão expostos na plataforma:

- **Breakdown temporal** (`time_increment`): permite ver métricas dia a dia, semana a semana ou mês a mês em vez de apenas o total do período.
- **Breakdowns demográficos e de plataforma** (`breakdowns`): segmenta os resultados por idade, gênero, país, região, plataforma de publicação ou dispositivo.
- **ROAS** (`purchase_roas`): retorno sobre o gasto em anúncios — métrica essencial para e-commerce.
- **Campos de vídeo e frequência**: métricas adicionais já disponíveis na Marketing API mas não incluídas nos `INSIGHTS_FIELDS` atuais.

Todos os dados são próprios do cliente autenticado. Nenhuma entidade nova. Nenhuma migration.

---

## 2. Contexto Multi-tenant

| Dado | Isolamento |
|------|-----------|
| Insights por breakdown | Por `adAccountId` — cada cliente só acessa suas próprias contas |
| Cache de insights com breakdown | Por `adAccountId` + parâmetros da query — stateless |
| Campos adicionais (ROAS, vídeo) | Global — fazem parte do mesmo `INSIGHTS_FIELDS` para todos |

---

## 3. Descrição Funcional

- `GET /campaign-reports/insights` passa a aceitar `timeIncrement` e `breakdowns` como query params opcionais.
- `GET /campaign-reports/insights/:campaignId` passa a aceitar os mesmos parâmetros e **muda o tipo de resposta** de `MetaInsights` para `PaginatedResult<MetaInsights>` quando `timeIncrement` ou `breakdowns` são fornecidos. Para manter compatibilidade, sem esses params continua retornando o objeto único (comportamento atual).
- `MetaInsightsParams` (interface interna) é expandida para incluir `timeIncrement?` e `breakdowns?`.
- `INSIGHTS_FIELDS` em `MetaAdsService` é expandido com: `purchase_roas`, `frequency`, `unique_clicks`, `cost_per_unique_click`, `video_play_actions`, `video_p25_watched_actions`, `video_p50_watched_actions`, `video_p75_watched_actions`, `video_p100_watched_actions`.
- `MetaInsights` (interface) ganha os novos campos opcionais correspondentes.
- A chave de cache inclui `timeIncrement` e `breakdowns` (ordenados) quando presentes — evita colisão com cache de "total do período".

---

## 4. Estrutura de Arquivos

### Novos arquivos
Nenhum.

### Arquivos modificados

```
src/modules/campaign-reports/
  dto/get-insights-query.dto.ts         ← novos enums MetaTimeIncrement e MetaBreakdown; novos campos no DTO
  interfaces/meta-campaign.interface.ts ← MetaInsights ganha novos campos; MetaInsightsParams ganha timeIncrement e breakdowns
  interfaces/meta-ads-service.interface.ts ← assinatura de fetchCampaignInsights muda para retornar PaginatedResult quando com breakdowns
  meta-ads.service.ts                   ← INSIGHTS_FIELDS expandido; params repassados para a Meta API
  campaign-reports.service.ts           ← cache key inclui novos params; getCampaignInsights adaptado
  campaign-reports.controller.ts        ← getCampaignInsights retorna tipo union; Swagger atualizado
  campaign-reports.service.spec.ts      ← novos cenários de teste
  meta-ads.service.spec.ts              ← novos cenários de teste
```

---

## 5. Contrato de API

### 5.1 GET /campaign-reports/insights (modificado)

| Campo | Valor |
|-------|-------|
| Método | `GET` |
| Path | `/api/v1/campaign-reports/insights` |
| Auth | `x-api-key` |
| Query | `GetInsightsQueryDto` expandido (ver seção 9) |
| Resposta | `PaginatedResult<MetaInsights>` (200) |

**Novos query params:**

| Param | Tipo | Obrigatório | Padrão | Valores |
|-------|------|-------------|--------|---------|
| `timeIncrement` | enum | Não | — (total do período) | `1`, `7`, `monthly`, `all_days` |
| `breakdowns` | string | Não | — | `age`, `gender`, `country`, `region`, `publisher_platform`, `device_platform` (separados por vírgula; máx 2 combinados) |

**Exemplo — insights diários com breakdown por idade e gênero:**
```
GET /api/v1/campaign-reports/insights
  ?adAccountId=act_123456789
  &datePreset=last_7d
  &level=campaign
  &timeIncrement=1
  &breakdowns=age,gender
```

**Resposta:**
```json
{
  "data": [
    {
      "campaign_id": "23843210000",
      "campaign_name": "Campanha Verão",
      "impressions": "2100",
      "clicks": "87",
      "spend": "45.20",
      "reach": "1800",
      "cpm": "21.52",
      "cpc": "0.52",
      "ctr": "4.14",
      "frequency": "1.17",
      "unique_clicks": "83",
      "cost_per_unique_click": "0.54",
      "purchase_roas": [{ "action_type": "omni_purchase", "value": "3.21" }],
      "video_play_actions": [{ "action_type": "video_view", "value": "412" }],
      "video_p25_watched_actions": [{ "action_type": "video_view", "value": "310" }],
      "video_p50_watched_actions": [{ "action_type": "video_view", "value": "198" }],
      "video_p75_watched_actions": [{ "action_type": "video_view", "value": "120" }],
      "video_p100_watched_actions": [{ "action_type": "video_view", "value": "55" }],
      "age": "25-34",
      "gender": "female",
      "date_start": "2026-06-10",
      "date_stop": "2026-06-10"
    }
  ],
  "paging": { "next": "cursor_opcional" }
}
```

> **Nota sobre breakdowns da Meta:** A API da Meta limita combinações de breakdowns. Não é possível combinar `age`+`gender`+`country` simultaneamente — o máximo são 2 dimensões. O limite não é validado no backend (a Meta retorna 400 com mensagem clara se inválido).

---

### 5.2 GET /campaign-reports/insights/:campaignId (modificado)

| Campo | Valor |
|-------|-------|
| Método | `GET` |
| Path | `/api/v1/campaign-reports/insights/:campaignId` |
| Auth | `x-api-key` |
| Query | `adAccountId` (obrigatório) + `datePreset` + **`timeIncrement?`** + **`breakdowns?`** |
| Resposta sem breakdowns/timeIncrement | `MetaInsights` (200) — comportamento atual mantido |
| Resposta com breakdowns ou timeIncrement | `PaginatedResult<MetaInsights>` (200) — múltiplos registros |

> Esta mudança é **não-breaking** para callers que não usam os novos params: o shape de resposta sem params continua sendo o objeto único atual. A mudança de tipo só ocorre quando os novos params são passados.

---

## 6. Entidade (PostgreSQL)

Sem alterações. Nenhuma migration necessária.

---

## 7. Cache (Redis)

### Chave de cache — `getInsights`

```
sem breakdowns e sem timeIncrement (retrocompatível):
  meta:insights:{adAccountId}:{level}:{datePreset}

com timeIncrement (sem breakdowns):
  meta:insights:{adAccountId}:{level}:{datePreset}:ti:{timeIncrement}

com breakdowns (sem timeIncrement):
  meta:insights:{adAccountId}:{level}:{datePreset}:bd:{breakdown_a},{breakdown_b}

com ambos:
  meta:insights:{adAccountId}:{level}:{datePreset}:ti:{timeIncrement}:bd:{breakdown_a},{breakdown_b}

com cursor (qualquer combinação dos acima):
  {chave_acima}:cursor:{cursor}
```

**Regra de ordenação dos breakdowns na chave:** os valores são ordenados alfabeticamente antes de montar a chave — `breakdowns=gender,age` gera a mesma chave que `breakdowns=age,gender`.

### Chave de cache — `getCampaignInsights`

```
sem breakdowns e sem timeIncrement (retrocompatível):
  meta:insights:campaign:{campaignId}:{datePreset}

com timeIncrement:
  meta:insights:campaign:{campaignId}:{datePreset}:ti:{timeIncrement}

com breakdowns:
  meta:insights:campaign:{campaignId}:{datePreset}:bd:{sorted_breakdowns}

com ambos:
  meta:insights:campaign:{campaignId}:{datePreset}:ti:{timeIncrement}:bd:{sorted_breakdowns}
```

**TTL:** `INSIGHTS_CACHE_TTL_SECONDS` (via `ConfigService`) — igual ao comportamento atual.

---

## 8. Interface do Service

### `MetaInsightsParams` (expansão)

```typescript
export interface MetaInsightsParams {
  datePreset: MetaDatePreset;
  level?: MetaInsightsLevel;
  timeIncrement?: MetaTimeIncrement;  // novo
  breakdowns?: string;                // novo — string CSV já normalizada: "age,gender"
}
```

### `IMetaAdsService` (sem mudança de assinatura — params encapsulados em `MetaInsightsParams`)

```typescript
interface IMetaAdsService {
  fetchCampaigns(adAccountId: string, accessToken: string, cursor?: string): Promise<MetaApiPaginatedResponse<MetaCampaign>>;
  fetchInsights(adAccountId: string, accessToken: string, params: MetaInsightsParams, cursor?: string): Promise<MetaApiPaginatedResponse<MetaInsights>>;
  fetchCampaignInsights(campaignId: string, accessToken: string, params: MetaInsightsParams): Promise<MetaInsights | MetaApiPaginatedResponse<MetaInsights>>;
}
```

> `fetchCampaignInsights` retorna `MetaInsights` (single) quando sem breakdowns/timeIncrement; retorna `MetaApiPaginatedResponse<MetaInsights>` quando com eles. O `CampaignReportsService` distingue os casos e serializa corretamente.

### `ICampaignReportsService` (expansão)

```typescript
interface ICampaignReportsService {
  listCampaigns(adAccountId: string, cursor?: string): Promise<PaginatedResult<MetaCampaign>>;
  getInsights(adAccountId: string, query: GetInsightsQueryDto): Promise<PaginatedResult<MetaInsights>>;
  getCampaignInsights(
    campaignId: string,
    adAccountId: string,
    datePreset: MetaDatePreset,
    timeIncrement?: MetaTimeIncrement,
    breakdowns?: string,
  ): Promise<MetaInsights | PaginatedResult<MetaInsights>>;
}
```

---

## 9. DTOs e Validações

### `MetaTimeIncrement` (novo enum — em `get-insights-query.dto.ts`)

```typescript
export enum MetaTimeIncrement {
  DAILY = '1',
  WEEKLY = '7',
  MONTHLY = 'monthly',
  ALL_DAYS = 'all_days',
}
```

### `MetaBreakdown` (novo enum — em `get-insights-query.dto.ts`)

```typescript
export enum MetaBreakdown {
  AGE = 'age',
  GENDER = 'gender',
  COUNTRY = 'country',
  REGION = 'region',
  PUBLISHER_PLATFORM = 'publisher_platform',
  DEVICE_PLATFORM = 'device_platform',
}
```

### `GetInsightsQueryDto` (campos adicionados)

```typescript
class GetInsightsQueryDto {
  // ... campos existentes (adAccountId, datePreset, level, cursor) ...

  @ApiPropertyOptional({
    enum: MetaTimeIncrement,
    description: 'Granularidade temporal: 1=diário, 7=semanal, monthly, all_days',
  })
  @IsOptional()
  @IsEnum(MetaTimeIncrement)
  timeIncrement?: MetaTimeIncrement;

  @ApiPropertyOptional({
    description: 'Breakdowns separados por vírgula: age, gender, country, region, publisher_platform, device_platform',
    example: 'age,gender',
  })
  @IsOptional()
  @IsString()
  breakdowns?: string;
}
```

> `breakdowns` chega como string livre porque a validação individual de cada valor seria complexa com `class-validator` para strings CSV. A Meta API retorna erro 400 descritivo se um breakdown inválido for enviado. Documentar isso nos erros comuns.

### `MetaInsights` (novos campos — todos opcionais)

```typescript
export interface MetaInsights {
  // ... campos existentes ...

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
}
```

---

## 10. Critérios de Aceitação (BDD)

```gherkin
Feature: Breakdown temporal em insights

  Scenario: Insights diários de uma conta
    Given conta "act_123" com campanhas ativas nos últimos 7 dias
    When GET /campaign-reports/insights?adAccountId=act_123&datePreset=last_7d&timeIncrement=1
    Then retorna 200 com PaginatedResult contendo múltiplos itens (um por dia)
    And cada item tem date_start == date_stop (intervalo de 1 dia)
    And o resultado é cacheado em "meta:insights:act_123:campaign:last_7d:ti:1"

  Scenario: Cache hit com timeIncrement
    Given cache "meta:insights:act_123:campaign:last_7d:ti:1" populado
    When GET /campaign-reports/insights?adAccountId=act_123&datePreset=last_7d&timeIncrement=1
    Then retorna 200 sem chamar a Meta API

  Scenario: timeIncrement não afeta o cache sem timeIncrement
    Given cache "meta:insights:act_123:campaign:last_30d" populado (total do período)
    When GET /campaign-reports/insights?adAccountId=act_123&datePreset=last_30d&timeIncrement=1
    Then o cache consultado é "meta:insights:act_123:campaign:last_30d:ti:1" (diferente)
    And chama a Meta API (cache miss)

Feature: Breakdowns demográficos em insights

  Scenario: Insights segmentados por idade e gênero
    When GET /campaign-reports/insights?adAccountId=act_123&breakdowns=age,gender
    Then retorna 200 com PaginatedResult onde cada item contém campos "age" e "gender"
    And o cache key contém "bd:age,gender" (ordenado alfabeticamente)

  Scenario: Ordem dos breakdowns na query não afeta o cache
    Given cache "meta:insights:act_123:campaign:last_30d:bd:age,gender" populado
    When GET /campaign-reports/insights?adAccountId=act_123&breakdowns=gender,age
    Then retorna 200 sem chamar a Meta API (mesma cache key)

  Scenario: Breakdown inválido repassado à Meta API
    When GET /campaign-reports/insights?adAccountId=act_123&breakdowns=invalid_dimension
    Then a Meta API retorna erro 400
    And o backend repassa o erro (não captura como 500)

Feature: Breakdown em insights de campanha específica

  Scenario: Insights diários de campanha específica
    When GET /campaign-reports/insights/23843?adAccountId=act_123&timeIncrement=1
    Then retorna 200 com PaginatedResult<MetaInsights> (não objeto único)
    And cada item representa um dia distinto

  Scenario: Sem timeIncrement e sem breakdowns — comportamento atual mantido
    When GET /campaign-reports/insights/23843?adAccountId=act_123&datePreset=last_7d
    Then retorna 200 com MetaInsights (objeto único, não array)

Feature: Campos adicionais de insights (ROAS e vídeo)

  Scenario: ROAS presente na resposta quando a campanha tem conversões
    Given campanha com eventos de compra registrados
    When GET /campaign-reports/insights?adAccountId=act_123
    Then resposta contém campo "purchase_roas": [{ "action_type": "omni_purchase", "value": "3.21" }]

  Scenario: Campos de vídeo presentes para campanhas com criativos em vídeo
    When GET /campaign-reports/insights?adAccountId=act_123
    Then resposta pode conter "video_play_actions", "video_p25_watched_actions" etc.
    And campos ausentes quando a campanha não tem vídeo (a Meta não os retorna)

  Scenario: Campos opcionais ausentes não quebram a deserialização
    Given campanha sem vídeo e sem conversões
    When GET /campaign-reports/insights?adAccountId=act_123
    Then retorna 200 com os campos opcionais simplesmente ausentes (undefined)
    And não retorna null nem string vazia para esses campos
```

---

## 11. Definition of Done

### Breakdowns e timeIncrement
- [ ] `MetaTimeIncrement` e `MetaBreakdown` enums adicionados a `get-insights-query.dto.ts`
- [ ] `GetInsightsQueryDto` possui `timeIncrement?` e `breakdowns?` com decorators Swagger
- [ ] `MetaInsightsParams` possui `timeIncrement?` e `breakdowns?`
- [ ] `MetaAdsService.fetchInsights` repassa `time_increment` e `breakdowns` à Meta API quando presentes
- [ ] `MetaAdsService.fetchCampaignInsights` repassa os mesmos params; retorna `MetaApiPaginatedResponse<MetaInsights>` quando com breakdowns/timeIncrement, `MetaInsights` único quando sem
- [ ] `CampaignReportsService.getInsights` inclui `timeIncrement` e `breakdowns` (normalizados/ordenados) na cache key
- [ ] `CampaignReportsService.getCampaignInsights` suporta os novos params; serializa resposta corretamente de acordo com presença ou ausência dos params
- [ ] `CampaignReportsController.getCampaignInsights` aceita os novos query params e repassa ao service
- [ ] Swagger documenta os novos params em ambos os endpoints de insights

### Campos adicionais
- [ ] `INSIGHTS_FIELDS` em `meta-ads.service.ts` inclui: `purchase_roas`, `frequency`, `unique_clicks`, `cost_per_unique_click`, `video_play_actions`, `video_p25_watched_actions`, `video_p50_watched_actions`, `video_p75_watched_actions`, `video_p100_watched_actions`
- [ ] `MetaInsights` interface possui os novos campos como opcionais (`?`)
- [ ] Campos de breakdown (`age`, `gender`, `country`, `region`, `publisher_platform`, `device_platform`) adicionados como opcionais em `MetaInsights`

### Testes
- [ ] `meta-ads.service.spec.ts`: cenários de `fetchInsights` com `timeIncrement` e `breakdowns` — verificar que os params chegam no HTTP call
- [ ] `meta-ads.service.spec.ts`: cenários de `fetchCampaignInsights` com e sem breakdowns — verificar o tipo de retorno correto
- [ ] `campaign-reports.service.spec.ts`: cache key com `timeIncrement`, cache key com `breakdowns` (verificar ordenação), cache key com ambos
- [ ] `campaign-reports.service.spec.ts`: `getCampaignInsights` retorna objeto único sem params, `PaginatedResult` com params
- [ ] Todos os testes existentes continuam passando (retrocompatibilidade)
