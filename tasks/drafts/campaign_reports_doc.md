# Documentação: Campaign Reports (Meta Marketing API)

**Data:** 2026-06-17
**Tipo:** Módulo Existente (atualizado)
**Arquivos analisados:**
- `src/modules/campaign-reports/campaign-reports.module.ts`
- `src/modules/campaign-reports/campaign-reports.controller.ts`
- `src/modules/campaign-reports/campaign-reports.service.ts`
- `src/modules/campaign-reports/meta-ads.service.ts`
- `src/modules/campaign-reports/dto/get-insights-query.dto.ts`
- `src/modules/campaign-reports/interfaces/meta-campaign.interface.ts`
- `src/modules/campaign-reports/interfaces/meta-ads-service.interface.ts`
- `src/modules/campaign-reports/interfaces/campaign-reports-service.interface.ts`
- `src/modules/ad-accounts/ad-accounts.module.ts`
- `src/modules/ad-accounts/ad-accounts.controller.ts`
- `src/modules/ad-accounts/ad-accounts.service.ts`
- `src/modules/ad-accounts/entities/ad-account.entity.ts`
- `src/modules/ad-accounts/dto/create-ad-account.dto.ts`
- `src/modules/ad-accounts/dto/update-ad-account.dto.ts`
- `src/modules/ad-accounts/interfaces/ad-accounts-service.interface.ts`
- `src/modules/ad-accounts/ad-accounts-token-monitor.service.ts`
- `src/config/meta-ads.config.ts`
- `src/common/exceptions/oauth-token-expired.exception.ts`
- `src/common/guards/api-key.guard.ts`

---

## Visão Geral

Este conjunto de módulos permite que a plataforma busque e exponha relatórios de performance de campanhas de anúncios de cada cliente (tenant) a partir da **Meta Marketing API**. O módulo `AdAccounts` gerencia o cadastro e rotação segura de credenciais (User Access Tokens com permissão `ads_read`) por cliente. O módulo `CampaignReports` consome essas credenciais para buscar campanhas e métricas on-demand — com suporte a breakdowns temporais, demográficos e paginação por cursor — usando Redis como camada de cache para respeitar o rate limit da Marketing API.

> **Distinção crítica de token:** Os tokens gerenciados aqui são **User Access Tokens** (ou System User Tokens) com permissão `ads_read`. São tokens distintos dos Page Access Tokens usados pelo módulo de mensagens (Instagram/WhatsApp) — não são intercambiáveis.

---

## Contexto Multi-tenant

| Dado | Isolamento | Mecanismo |
|------|-----------|-----------|
| `AdAccountEntity` | Por `clientId` | FK para `clients.id` |
| `accessToken` | Por conta de anúncio | AES-256-GCM, nunca exposto na API |
| Campanhas e insights | Por `adAccountId`, implicitamente por `clientId` | `findByAdAccountId` resolve o `clientId` |
| Configurações da API | Global | `ConfigService` (`meta.graphApiUrl`, `meta-ads.apiVersion`) |

> **Nota de segurança:** O `adAccountId` é globalmente único na Meta, e a constraint `UNIQUE` no banco impede duplicatas. A autenticação é feita por `x-api-key` global (Master API Key), o que significa que qualquer chamante com a chave pode acessar qualquer `adAccountId`. Não há isolamento por API key de tenant.

---

## Fluxo de Dados

### Cadastro de Ad Account (CRUD)

```
POST /api/v1/ad-accounts
    ↓ ApiKeyGuard → valida x-api-key contra MASTER_API_KEY
AdAccountsController.create(@Body() CreateAdAccountDto)
    ↓ ValidationPipe: IsUUID(clientId), Matches(/^act_\d+$/, adAccountId), IsNotEmpty(accessToken)
AdAccountsService.create(dto)
    ↓ AesCryptoService.encrypt(dto.accessToken)  ← AES-256-GCM, IV aleatório por token
    ↓ Repository.save(AdAccountEntity)  →  PostgreSQL: tabela ad_accounts
    ↓ Cache.set("ad-account:id:{id}", entity, TTL global)
    ↓ Cache.set("ad-account:act:{adAccountId}", entity, TTL global)
← AdAccountEntity (201) — campo accessToken excluído via @Exclude() + ClassSerializerInterceptor
```

### Consulta de Campanhas (com paginação por cursor)

```
GET /api/v1/campaign-reports/campaigns?adAccountId=act_123[&cursor=abc]
    ↓ ApiKeyGuard
CampaignReportsController.listCampaigns(@Query adAccountId, @Query cursor?)
CampaignReportsService.listCampaigns(adAccountId, cursor?)
    ↓ buildCacheKey:
        sem cursor → "meta:campaigns:act_123"
        com cursor → "meta:campaigns:act_123:cursor:abc"
    ↓ Cache.get(cacheKey)
        → HIT: retorna PaginatedResult<MetaCampaign> sem bater na Meta API
        → MISS:
            ↓ AdAccountsService.findByAdAccountId("act_123")
            ↓ [verifica isActive → lança 422 se inativo]
            ↓ AesCryptoService.decrypt(entity.accessToken)
            ↓ MetaAdsService.fetchCampaigns("act_123", token, cursor?)
                ↓ GET graph.facebook.com/v21.0/act_123/campaigns[?after=cursor]
                    → OAuthException code 190 → OAuthTokenExpiredException (401)
                    → outro erro → loga + relança
            ↓ Cache.set(cacheKey, { data, paging: { next: cursors.after } }, TTL_MS)
← PaginatedResult<MetaCampaign>: { data: MetaCampaign[], paging: { next?: string } }
```

### Consulta de Insights por Conta

```
GET /api/v1/campaign-reports/insights?adAccountId=act_123&datePreset=last_30d
    [&level=campaign&timeIncrement=1&breakdowns=age,gender&cursor=xyz]
    ↓ ApiKeyGuard
CampaignReportsController.getInsights(@Query() GetInsightsQueryDto)
CampaignReportsService.getInsights(adAccountId, query)
    ↓ buildInsightsCacheKey(
          "meta:insights:act_123:campaign:last_30d",
          cursor?,
          timeIncrement?,  ← adiciona ":ti:1"
          breakdowns?,     ← ordena + adiciona ":bd:age,gender"
      )
        Exemplos:
          base:             "meta:insights:act_123:campaign:last_30d"
          +timeIncrement:   "meta:insights:act_123:campaign:last_30d:ti:1"
          +breakdowns:      "meta:insights:act_123:campaign:last_30d:bd:age,gender"
          +ambos:           "meta:insights:act_123:campaign:last_30d:ti:1:bd:age,gender"
          +cursor:          "meta:insights:act_123:campaign:last_30d:ti:1:bd:age,gender:cursor:xyz"
    ↓ Cache.get(cacheKey)
        → HIT: retorna PaginatedResult<MetaInsights>
        → MISS:
            ↓ AdAccountsService.findByAdAccountId("act_123")
            ↓ [verifica isActive → 422]
            ↓ AesCryptoService.decrypt(entity.accessToken)
            ↓ MetaAdsService.fetchInsights("act_123", token, { datePreset, level, timeIncrement, breakdowns }, cursor?)
                ↓ GET /act_123/insights
                    params: { fields, date_preset, level, access_token,
                              time_increment? (se timeIncrement),
                              breakdowns? (se breakdowns),
                              after? (se cursor) }
            ↓ Cache.set(cacheKey, result, INSIGHTS_TTL_MS)
← PaginatedResult<MetaInsights>: { data: MetaInsights[], paging: { next?: string } }
```

### Consulta de Insights por Campanha

```
GET /api/v1/campaign-reports/insights/:campaignId
    ?adAccountId=act_123&datePreset=last_7d[&timeIncrement=1&breakdowns=gender,age]
    ↓ ApiKeyGuard
CampaignReportsService.getCampaignInsights(campaignId, adAccountId, datePreset, timeIncrement?, breakdowns?)
    ↓ buildInsightsCacheKey(
          "meta:insights:campaign:111:last_7d",
          undefined,  ← sem cursor neste endpoint
          timeIncrement?,
          breakdowns?,
      )
    ↓ Cache.get(cacheKey)
    → MISS:
        ↓ AdAccountsService.findByAdAccountId(adAccountId)
        ↓ [verifica isActive → 422]
        ↓ MetaAdsService.fetchCampaignInsights(campaignId, token, { datePreset, timeIncrement, breakdowns })

        SEM timeIncrement e SEM breakdowns:
            ↓ Meta retorna { data: [MetaInsights] }
            ↓ extrai data[0] → lança 404 se vazio
            ↓ Cache.set(cacheKey, MetaInsights, TTL)
            ← MetaInsights (objeto simples)

        COM timeIncrement OU breakdowns:
            ↓ Meta retorna múltiplos registros (um por período ou por segmento)
            ↓ preserva resposta paginada completa
            ↓ Cache.set(cacheKey, { data: [], paging: { next? } }, TTL)
            ← PaginatedResult<MetaInsights>
```

---

## Regras de Negócio Identificadas

### RN-01: Formato obrigatório do adAccountId
**Onde no código:** `create-ad-account.dto.ts:12`
**Descrição:** O `adAccountId` deve seguir o formato `act_{numeric_id}` exatamente como a Meta exige nas chamadas de API. Um valor inválido é rejeitado com 400 na borda do sistema.
**Condição:** Aplica-se apenas no cadastro (`CreateAdAccountDto`). `GetInsightsQueryDto` não tem essa validação — inconsistência conhecida (ver Dívida Técnica).

### RN-02: Token armazenado sempre criptografado
**Onde no código:** `ad-accounts.service.ts` — `create` e `update`
**Descrição:** O `accessToken` é cifrado com AES-256-GCM antes de qualquer escrita no banco. A chave de cifragem (`ENCRYPTION_KEY`) tem 64 caracteres hexadecimais (256 bits). O token nunca aparece em logs, respostas HTTP ou cache Redis em texto claro — somente descriptografado temporariamente durante a chamada à Meta API.
**Condição:** Todo `create` e `update` que inclua novo `accessToken`.

### RN-03: Conta inativa bloqueia consultas de relatório
**Onde no código:** `campaign-reports.service.ts` — `listCampaigns`, `getInsights`, `getCampaignInsights`
**Descrição:** Antes de buscar dados na Meta API, o service verifica `account.isActive`. Se `false`, lança `422 Unprocessable Entity`.
**Condição:** Executa apenas em cache miss — se a conta for desativada após um cache hit, o dado antigo ainda é retornado por até o TTL configurado.

### RN-04: TTL de insights configurável por variável de ambiente
**Onde no código:** `campaign-reports.service.ts:32-34` via `ConfigService.get('meta-ads.insightsCacheTtlSeconds')`
**Descrição:** O TTL das chaves de métricas e campanhas é lido de `INSIGHTS_CACHE_TTL_SECONDS` (default: 300s, min: 30s, max: 3600s). O valor é multiplicado por 1000 antes de ser passado ao `cache.set`. Credenciais de ad accounts usam o TTL global (`CACHE_TTL_SECONDS`).
**Condição:** Aplica-se a todas as chaves `meta:campaigns:*` e `meta:insights:*`.

### RN-05: Token expirado sinalizado como 401, não 500
**Onde no código:** `meta-ads.service.ts` — `handleError`
**Descrição:** Quando a Meta retorna `OAuthException` com `code: 190` (token expirado ou inválido), o sistema lança `OAuthTokenExpiredException extends UnauthorizedException`. O NestJS converte isso em `401 Unauthorized`, sinalizando ao consumidor que o token precisa ser rotacionado via `PATCH /ad-accounts/:id`.
**Condição:** Qualquer chamada à Marketing API com token inválido.

### RN-06: Tipo de retorno de `getCampaignInsights` varia conforme parâmetros
**Onde no código:** `campaign-reports.service.ts:138-146`, `meta-ads.service.ts:94-102`
**Descrição:** Sem `timeIncrement` e sem `breakdowns`, a Meta retorna um único objeto de métricas (período agregado) — o serviço retorna `MetaInsights` diretamente e lança 404 se o array estiver vazio. Com qualquer um dos dois, a Meta retorna múltiplos registros (um por período ou segmento) — o serviço retorna `PaginatedResult<MetaInsights>`. O tipo de retorno muda entre um objeto simples e uma lista paginada.
**Condição:** Discriminado por `timeIncrement || breakdowns`.

### RN-07: Cache key de breakdowns normaliza ordem dos campos
**Onde no código:** `campaign-reports.service.ts:44-47` — `buildInsightsCacheKey`
**Descrição:** O parâmetro `breakdowns` é uma string separada por vírgula (ex: `"gender,age"` ou `"age,gender"`). Antes de gerar a cache key, o service divide por vírgula, remove espaços, ordena alfabeticamente e rejoina. Isso garante que `"gender,age"` e `"age,gender"` produzam a mesma chave de cache, evitando entradas duplicadas.
**Condição:** Sempre que `breakdowns` estiver presente.

### RN-08: Insights de campanha sem dados retornam 404 (apenas sem breakdowns)
**Onde no código:** `meta-ads.service.ts:98-101`
**Descrição:** Quando uma campanha não tem dados para o `datePreset` solicitado e `timeIncrement`/`breakdowns` não foram usados, a Meta retorna `{ data: [] }`. O sistema lança 404 com mensagem descritiva. Com breakdowns ou timeIncrement, array vazio é retornado normalmente (comportamento esperado para segmentos sem atividade).
**Condição:** Apenas em `fetchCampaignInsights` sem timeIncrement e sem breakdowns.

### RN-09: Soft delete preserva histórico e bloqueia re-cadastro
**Onde no código:** `ad-accounts.service.ts` — `remove`
**Descrição:** A remoção usa `softRemove` — popula `deletedAt` sem apagar a linha. A constraint `UNIQUE` em `adAccountId` permanece ativa para registros soft-deleted, impedindo re-cadastro do mesmo `adAccountId`. Contas soft-deleted não aparecem em `findAll` (filtra por `isActive: true`).

### RN-10: Monitoramento diário de tokens próximos da expiração
**Onde no código:** `ad-accounts-token-monitor.service.ts`
**Descrição:** Um cron job executa diariamente às 08h (America/Sao_Paulo) e loga um `WARN` para toda ad account com `tokenExpiresAt` nos próximos N dias (default: 7, configurável em código). Não realiza ação automática — serve como alerta operacional para que o time rotacione os tokens antes da expiração.
**Condição:** Aplica-se apenas a contas com `tokenExpiresAt` não nulo.

---

## Endpoints Expostos

### Módulo: Ad Accounts (`/api/v1/ad-accounts`)

| Método | Path | Guard | Body/Query | Resposta | Descrição |
|--------|------|-------|------------|----------|-----------|
| `POST` | `/ad-accounts` | `ApiKeyGuard` | `CreateAdAccountDto` | `AdAccountEntity` (201) | Cadastra nova ad account com token criptografado |
| `GET` | `/ad-accounts?clientId={uuid}` | `ApiKeyGuard` | `clientId: UUID` (query) | `AdAccountEntity[]` (200) | Lista contas ativas de um cliente |
| `GET` | `/ad-accounts/expiring` | `ApiKeyGuard` | `clientId: UUID`, `daysAhead?: number` (query) | `AdAccountEntity[]` (200) | Lista contas com token expirando em N dias |
| `GET` | `/ad-accounts/:id` | `ApiKeyGuard` | `id: UUID` (param) | `AdAccountEntity` (200) | Busca conta por ID interno |
| `PATCH` | `/ad-accounts/:id` | `ApiKeyGuard` | `UpdateAdAccountDto` | `AdAccountEntity` (200) | Atualiza token, nome ou status |
| `DELETE` | `/ad-accounts/:id` | `ApiKeyGuard` | `id: UUID` (param) | `void` (204) | Soft delete da conta |

> **Nota de rota:** `/expiring` deve ser declarado antes de `/:id` no controller para evitar que o NestJS interprete "expiring" como UUID.

### Módulo: Campaign Reports (`/api/v1/campaign-reports`)

| Método | Path | Guard | Query | Resposta | Cache |
|--------|------|-------|-------|----------|-------|
| `GET` | `/campaign-reports/campaigns` | `ApiKeyGuard` | `adAccountId*`, `cursor?` | `PaginatedResult<MetaCampaign>` (200) | TTL configurável |
| `GET` | `/campaign-reports/insights` | `ApiKeyGuard` | `GetInsightsQueryDto` (ver abaixo) | `PaginatedResult<MetaInsights>` (200) | TTL configurável |
| `GET` | `/campaign-reports/insights/:campaignId` | `ApiKeyGuard` | `adAccountId*`, `datePreset?`, `timeIncrement?`, `breakdowns?` | `MetaInsights` ou `PaginatedResult<MetaInsights>` (200) | TTL configurável |

#### `GetInsightsQueryDto` — parâmetros disponíveis

| Parâmetro | Tipo | Obrigatório | Default | Descrição |
|-----------|------|-------------|---------|-----------|
| `adAccountId` | `string` | Sim | — | ID da conta Meta (ex: `act_123456789`) |
| `datePreset` | `MetaDatePreset` | Não | `last_30d` | Período pré-definido |
| `level` | `MetaInsightsLevel` | Não | `campaign` | Nível de granularidade |
| `cursor` | `string` | Não | — | Cursor de paginação retornado em `paging.next` |
| `timeIncrement` | `MetaTimeIncrement` | Não | — | Granularidade temporal: `1` (diário), `7` (semanal), `monthly`, `all_days` |
| `breakdowns` | `string` | Não | — | Dimensões separadas por vírgula (ver enums abaixo) |

---

## Enums de Query

### `MetaDatePreset`
| Valor | Descrição |
|-------|-----------|
| `today` | Hoje |
| `yesterday` | Ontem |
| `last_7d` | Últimos 7 dias |
| `last_14d` | Últimos 14 dias |
| `last_30d` | Últimos 30 dias |
| `this_month` | Mês atual |
| `last_month` | Mês anterior |

### `MetaInsightsLevel`
`account` | `campaign` | `adset` | `ad`

### `MetaTimeIncrement`
| Valor | Descrição |
|-------|-----------|
| `1` | Diário — um objeto por dia |
| `7` | Semanal — um objeto por semana |
| `monthly` | Mensal — um objeto por mês |
| `all_days` | Período total — único objeto agregado |

### `MetaBreakdown` (valores aceitos em `breakdowns`)
| Valor | Descrição |
|-------|-----------|
| `age` | Faixa etária (ex: `18-24`, `25-34`) |
| `gender` | Gênero (`male`, `female`, `unknown`) |
| `country` | País (código ISO 2 letras) |
| `region` | Região/Estado |
| `publisher_platform` | Plataforma (facebook, instagram, messenger) |
| `device_platform` | Dispositivo (mobile, desktop) |

> **Limite da API Meta:** Não é possível combinar `age` com `gender` (e vice-versa) em certos níveis. Consulte a documentação da Marketing API para restrições de combinação de breakdowns.

---

## Tipos da Meta Marketing API

### `MetaCampaign`
```typescript
{
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';
  objective: string;
  created_time: string;  // ISO 8601
}
```

### `MetaInsights` — campos retornados
```typescript
{
  // Campos base (sempre presentes)
  impressions: string;   // Impressões
  clicks: string;        // Cliques totais
  spend: string;         // Valor gasto (moeda da conta)
  reach: string;         // Alcance único
  cpm: string;           // Custo por mil impressões
  cpc: string;           // Custo por clique
  ctr: string;           // Taxa de clique (%)
  date_start: string;    // Data início do período
  date_stop: string;     // Data fim do período

  // Identificadores (presentes conforme level)
  campaign_id?: string;
  campaign_name?: string;

  // Ações e conversões
  actions?: MetaAction[];             // Ex: link_click, purchase, lead
  cost_per_action_type?: MetaAction[]; // Custo por ação

  // Frequência e cliques únicos
  frequency?: string;                // Média de impressões por usuário único
  unique_clicks?: string;            // Cliques de usuários únicos
  cost_per_unique_click?: string;    // CPM de cliques únicos

  // ROAS (retorno sobre investimento em anúncio)
  purchase_roas?: MetaAction[];      // Ex: [{ action_type: "omni_purchase", value: "3.45" }]

  // Métricas de vídeo
  video_play_actions?: MetaAction[];        // Reproduções iniciadas
  video_p25_watched_actions?: MetaAction[]; // 25% do vídeo assistido
  video_p50_watched_actions?: MetaAction[]; // 50% do vídeo assistido
  video_p75_watched_actions?: MetaAction[]; // 75% do vídeo assistido
  video_p100_watched_actions?: MetaAction[]; // Vídeo completado

  // Campos de breakdown (presentes quando breakdowns foram solicitados)
  age?: string;                  // "18-24", "25-34", etc.
  gender?: string;               // "male", "female", "unknown"
  country?: string;              // "BR", "US", etc.
  region?: string;               // "São Paulo", etc.
  publisher_platform?: string;   // "facebook", "instagram"
  device_platform?: string;      // "mobile", "desktop"
}
```

### `MetaAction`
```typescript
{ action_type: string; value: string }
```
> Todos os campos numéricos da Meta são retornados como `string`. Conversão para `number` é responsabilidade do consumidor.

### `PaginatedResult<T>`
```typescript
{ data: T[]; paging: { next?: string } }
```
Retornado por `listCampaigns`, `getInsights` e `getCampaignInsights` quando `timeIncrement` ou `breakdowns` são usados. O campo `paging.next` contém o cursor para a próxima página — passe-o como `cursor` na próxima requisição.

---

## Entidade PostgreSQL: `ad_accounts`

| Campo | Tipo PostgreSQL | Tipo TypeScript | Nullable | Descrição |
|-------|----------------|-----------------|----------|-----------|
| `id` | `uuid` (PK) | `string` | Não | Identificador interno (uuid_generate_v4) |
| `createdAt` | `timestamp` | `Date` | Não | Criação automática |
| `updatedAt` | `timestamp` | `Date` | Não | Atualização automática |
| `deletedAt` | `timestamp` | `Date \| null` | Sim | Soft delete |
| `client_id` | `uuid` (FK) | `string` | Não | Referência a `clients.id` |
| `ad_account_id` | `varchar` (UNIQUE) | `string` | Não | ID da conta na Meta (ex: `act_123456789`) |
| `account_name` | `varchar` | `string \| null` | Sim | Label legível (não usado pela Meta API) |
| `access_token` | `text` | `string` | Não | User Token cifrado (AES-256-GCM + base64) |
| `token_expires_at` | `timestamptz` | `Date \| null` | Sim | Expiração do token (`null` = permanente) |
| `isActive` | `boolean` | `boolean` | Não | Default `true`; `false` bloqueia consultas |

> A constraint `UNIQUE` em `ad_account_id` é global — o mesmo `adAccountId` não pode ser cadastrado para dois clientes diferentes. Permanece ativa mesmo para registros soft-deleted.

---

## Estratégia de Cache Redis

| Chave | TTL | Invalidação | Descrição |
|-------|-----|------------|-----------|
| `ad-account:id:{uuid}` | `CACHE_TTL_SECONDS` (global) | update / delete | Credencial por ID interno |
| `ad-account:act:{adAccountId}` | `CACHE_TTL_SECONDS` (global) | update / delete | Credencial por adAccountId (hot path) |
| `meta:campaigns:{adAccountId}` | `INSIGHTS_CACHE_TTL_SECONDS` | Não invalidado | Lista de campanhas (sem cursor) |
| `meta:campaigns:{adAccountId}:cursor:{cursor}` | `INSIGHTS_CACHE_TTL_SECONDS` | Não invalidado | Lista de campanhas (página N) |
| `meta:insights:{adAccountId}:{level}:{datePreset}` | `INSIGHTS_CACHE_TTL_SECONDS` | Não invalidado | Insights por conta (base) |
| `meta:insights:{...}:ti:{timeIncrement}` | `INSIGHTS_CACHE_TTL_SECONDS` | Não invalidado | + granularidade temporal |
| `meta:insights:{...}:bd:{sorted_breakdowns}` | `INSIGHTS_CACHE_TTL_SECONDS` | Não invalidado | + breakdowns demográficos |
| `meta:insights:{...}:cursor:{cursor}` | `INSIGHTS_CACHE_TTL_SECONDS` | Não invalidado | + paginação |
| `meta:insights:campaign:{campaignId}:{datePreset}` | `INSIGHTS_CACHE_TTL_SECONDS` | Não invalidado | Insights por campanha (base) |
| `meta:insights:campaign:{...}:ti:{timeIncrement}` | `INSIGHTS_CACHE_TTL_SECONDS` | Não invalidado | + granularidade temporal |
| `meta:insights:campaign:{...}:bd:{sorted_breakdowns}` | `INSIGHTS_CACHE_TTL_SECONDS` | Não invalidado | + breakdowns demográficos |

**Regra de composição da chave:** Os sufixos sempre seguem a ordem: `:ti:` → `:bd:` → `:cursor:`. Breakdowns são sempre ordenados alfabeticamente antes de concatenados (ex: `gender,age` → `age,gender`).

**Stale cache após rotação de token:** `PATCH /ad-accounts/:id` invalida as chaves de credencial imediatamente. As chaves de insights permanecem vivas por até `INSIGHTS_CACHE_TTL_SECONDS` — os dados do período anterior serão servidos do cache, o que é seguro pois os insights em si não mudam com a rotação do token.

---

## Critérios de Aceitação (extraídos do código)

```gherkin
Feature: Ad Accounts

  Scenario: Cadastrar conta com sucesso
    Given clientId válido e User Token com permissão ads_read
    When POST /api/v1/ad-accounts com { clientId, adAccountId: "act_123", accessToken }
    Then retorna 201 com AdAccountEntity
    And accessToken não está presente no body da resposta
    And Redis contém "ad-account:id:{id}" e "ad-account:act:act_123"

  Scenario: adAccountId duplicado
    Given já existe conta "act_123" no banco
    When POST com mesmo adAccountId
    Then retorna 409 Conflict

  Scenario: Rotação de token
    When PATCH /api/v1/ad-accounts/{id} com { accessToken: "novo-token" }
    Then retorna 200 com entidade atualizada
    And cache "ad-account:id:{id}" e "ad-account:act:{adAccountId}" são deletados do Redis

Feature: Campaign Reports — Consultas básicas

  Scenario: Listar campanhas com cache hit
    Given Redis contém "meta:campaigns:act_123"
    When GET /campaign-reports/campaigns?adAccountId=act_123
    Then retorna 200 sem chamar a Meta Marketing API

  Scenario: Listar campanhas com paginação
    Given Meta retorna paging.cursors.after = "next_cursor_abc"
    When GET /campaign-reports/campaigns?adAccountId=act_123
    Then retorna { data: [...], paging: { next: "next_cursor_abc" } }
    When GET /campaign-reports/campaigns?adAccountId=act_123&cursor=next_cursor_abc
    Then chama Meta API com ?after=next_cursor_abc

  Scenario: Conta inativa
    Given AdAccountEntity com isActive: false
    When GET /campaign-reports/campaigns?adAccountId=act_123 (sem cache)
    Then retorna 422 Unprocessable Entity

  Scenario: Token expirado
    Given accessToken retorna OAuthException code 190
    When qualquer endpoint de campaign-reports é chamado
    Then retorna 401 Unauthorized

Feature: Campaign Reports — Breakdowns e timeIncrement

  Scenario: Insights com granularidade diária
    When GET /campaign-reports/insights?adAccountId=act_123&datePreset=last_7d&timeIncrement=1
    Then chama Meta API com time_increment=1
    And retorna PaginatedResult com um objeto por dia
    And cache key contém ":ti:1"

  Scenario: Insights com breakdown demográfico
    When GET /campaign-reports/insights?adAccountId=act_123&datePreset=last_30d&breakdowns=gender,age
    Then chama Meta API com breakdowns=gender,age
    And retorna PaginatedResult com campos age e gender em cada objeto
    And cache key contém ":bd:age,gender" (ordem alfabética)

  Scenario: Normalização de ordem dos breakdowns
    Given chamadas com breakdowns="gender,age" e breakdowns="age,gender"
    Then ambas consultam a mesma chave de cache (":bd:age,gender")

  Scenario: Insights de campanha sem breakdowns
    When GET /campaign-reports/insights/111?adAccountId=act_123&datePreset=last_7d
    Then retorna MetaInsights (objeto simples, não array)

  Scenario: Insights de campanha com timeIncrement
    When GET /campaign-reports/insights/111?adAccountId=act_123&datePreset=last_7d&timeIncrement=1
    Then retorna PaginatedResult<MetaInsights> (array com um objeto por dia)

  Scenario: Campanha sem dados no período (sem breakdowns)
    Given campaignId "999" sem atividade no período "last_7d"
    When GET /campaign-reports/insights/999?adAccountId=act_123&datePreset=last_7d
    Then retorna 404 Not Found

  Scenario: Campanha sem dados com timeIncrement
    Given campaignId "999" sem atividade no período
    When GET /campaign-reports/insights/999?adAccountId=act_123&datePreset=last_7d&timeIncrement=1
    Then retorna PaginatedResult com data: [] (não lança 404)
```

---

## Variáveis de Ambiente Necessárias

| Variável | Obrigatório | Default | Descrição |
|----------|-------------|---------|-----------|
| `MASTER_API_KEY` | **Sim** | — | API Key do `ApiKeyGuard` (header `x-api-key`) |
| `ENCRYPTION_KEY` | **Sim** | — | 64 hex chars (256-bit) para AES-256-GCM |
| `DATABASE_URL` | **Sim** | — | URL do PostgreSQL (ex: `postgresql://user:pass@host:5432/db`) |
| `REDIS_URL` | **Sim** | — | URL do Redis (ex: `redis://localhost:6379`) |
| `META_GRAPH_API_URL` | Não | `https://graph.facebook.com` | Base URL da Meta API |
| `META_ADS_API_VERSION` | Não | `v21.0` | Versão da Marketing API |
| `INSIGHTS_CACHE_TTL_SECONDS` | Não | `300` | TTL em segundos para cache de métricas (30–3600) |
| `CACHE_TTL_SECONDS` | Não | `3600` | TTL global do cache (usado para credenciais) |
| `META_APP_SECRET` | **Sim** | — | Segredo do app Meta (verificação de webhook) |
| `META_VERIFY_TOKEN` | **Sim** | — | Token de verificação do webhook Meta |

---

## Dependências Externas

### APIs externas
- **Meta Marketing API** — `graph.facebook.com/{version}/{adAccountId}/campaigns` e `/insights`
  - Autenticação: `access_token` como query param (não Bearer header)
  - Rate limit: ~200 chamadas/hora por User Token (Tier 1)
  - Paginação: cursor-based via `paging.cursors.after`
  - Formato das métricas: todos os campos numéricos são retornados como `string`

### Módulos NestJS
- `@nestjs/axios` (HttpModule) — chamadas HTTP à Meta API
- `@nestjs/cache-manager` + `@keyv/redis` — cache Redis global
- `@nestjs/typeorm` — acesso ao PostgreSQL
- `@nestjs/schedule` — cron job de monitoramento de tokens
- `@nestjs/config` / `@nestjs/swagger` — configuração e documentação

### Módulos internos importados
- `CryptoModule` (`AesCryptoService`) — cifra/decifra tokens
- `AdAccountsModule` — importado por `CampaignReportsModule` para resolver credenciais

---

## Pontos de Atenção / Dívida Técnica

### 1. `adAccountId` sem validação de formato em `GetInsightsQueryDto`
O endpoint `GET /campaign-reports/insights?adAccountId=invalido` aceita qualquer string. A requisição chegará ao banco e falhará com 404, mas seria mais correto retornar 400. O `CreateAdAccountDto` já tem `@Matches(/^act_\d+$/)` — inconsistência de tratamento na borda.

### 2. Não há invalidação de cache de insights ao rotacionar token
Ao fazer `PATCH /ad-accounts/:id` com novo token, as chaves `meta:insights:*` e `meta:campaigns:*` não são invalidadas. Os dados retornados do cache foram obtidos com o token anterior. Não é problema funcional (os insights em si não mudam), mas pode confundir em debugging.

### 3. Stale cache não respeita desativação de conta
Se uma conta for desativada enquanto há dados em cache, requests de insights continuarão sendo respondidos com os dados cacheados por até `INSIGHTS_CACHE_TTL_SECONDS`. O check de `isActive` só executa em cache miss.

### 4. Monitoramento de token não toma ação automática
O cron job (`ad-accounts-token-monitor.service.ts`) apenas loga avisos — não envia e-mail, não notifica via webhook, não desativa a conta. Para produção, avaliar integração com sistema de alertas (PagerDuty, Slack, e-mail) quando tokens estiverem a menos de 7 dias da expiração.

### 5. Paginação não implementada em `getCampaignInsights`
O endpoint `/insights/:campaignId` não aceita parâmetro `cursor` — se o resultado tiver mais de 25 registros (provável com `timeIncrement=1` em períodos longos), apenas a primeira página é retornada silenciosamente.

### 6. `breakdowns` aceita string livre sem validação dos valores
O campo `breakdowns` em `GetInsightsQueryDto` usa `@IsString()` sem validar os valores individuais. Uma string inválida como `breakdowns=foo,bar` será enviada à Meta API e retornará erro 400 da Meta, que será propagado como erro genérico (não 400 do próprio serviço). Melhorar com `@Matches(/^(age|gender|country|region|publisher_platform|device_platform)(,(age|gender|country|region|publisher_platform|device_platform))*$/)`.
