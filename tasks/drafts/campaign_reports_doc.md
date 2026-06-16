# Documentação: Campaign Reports (Meta Marketing API)

**Data:** 2026-06-16
**Tipo:** Módulo Novo
**Arquivos analisados:**
- `src/modules/ad-accounts/ad-accounts.module.ts`
- `src/modules/ad-accounts/ad-accounts.controller.ts`
- `src/modules/ad-accounts/ad-accounts.service.ts`
- `src/modules/ad-accounts/entities/ad-account.entity.ts`
- `src/modules/ad-accounts/dto/create-ad-account.dto.ts`
- `src/modules/ad-accounts/dto/update-ad-account.dto.ts`
- `src/modules/ad-accounts/interfaces/ad-accounts-service.interface.ts`
- `src/modules/campaign-reports/campaign-reports.module.ts`
- `src/modules/campaign-reports/campaign-reports.controller.ts`
- `src/modules/campaign-reports/campaign-reports.service.ts`
- `src/modules/campaign-reports/meta-ads.service.ts`
- `src/modules/campaign-reports/dto/get-insights-query.dto.ts`
- `src/modules/campaign-reports/interfaces/meta-campaign.interface.ts`
- `src/modules/campaign-reports/interfaces/meta-ads-service.interface.ts`
- `src/modules/campaign-reports/interfaces/campaign-reports-service.interface.ts`
- `src/config/meta-ads.config.ts`
- `src/database/migrations/1779944000000-CreateAdAccountsTable.ts`
- `src/common/exceptions/oauth-token-expired.exception.ts`

---

## Visão Geral

Este conjunto de dois módulos permite que a plataforma busque e exponha relatórios de performance de campanhas de anúncios de cada cliente (tenant) a partir da **Meta Marketing API**. O módulo `AdAccounts` gerencia o cadastro e rotação segura de credenciais (User Access Tokens com permissão `ads_read`) por cliente. O módulo `CampaignReports` consome essas credenciais para buscar campanhas e métricas on-demand, usando Redis como camada de cache para respeitar o rate limit da Marketing API (~200 chamadas/hora por token).

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
    ↓ ValidationPipe: IsUUID(clientId), Matches(/^act_\d+$/ adAccountId), IsNotEmpty(accessToken)
AdAccountsService.create(dto)
    ↓ AesCryptoService.encrypt(dto.accessToken)  ← AES-256-GCM, IV aleatório por token
    ↓ Repository.save(AdAccountEntity)  →  PostgreSQL: tabela ad_accounts
    ↓ Cache.set("ad-account:id:{id}", entity, TTL global)
    ↓ Cache.set("ad-account:act:{adAccountId}", entity, TTL global)
← AdAccountEntity (201) — campo accessToken excluído via @Exclude() + ClassSerializerInterceptor
```

### Consulta de Campanhas e Insights

```
GET /api/v1/campaign-reports/campaigns?adAccountId=act_123
    ↓ ApiKeyGuard
CampaignReportsController.listCampaigns(@Query adAccountId)
CampaignReportsService.listCampaigns(adAccountId)
    ↓ Cache.get("meta:campaigns:act_123")
        → HIT (TTL 300s): retorna MetaCampaign[] sem bater na Meta API
        → MISS:
            ↓ AdAccountsService.findByAdAccountId("act_123")
                ↓ Cache.get("ad-account:act:act_123") → HIT ou
                ↓ Repository.findOne({ where: { adAccountId } }) → MISS
            ↓ [verifica isActive → lança 422 se inativo]
            ↓ AesCryptoService.decrypt(entity.accessToken)
            ↓ MetaAdsService.fetchCampaigns("act_123", plainTextToken)
                ↓ GET graph.facebook.com/v21.0/act_123/campaigns
                    → OAuthException code 190 → OAuthTokenExpiredException (401)
                    → Outro erro → loga + relança
            ↓ Cache.set("meta:campaigns:act_123", result, 300_000ms)
← MetaCampaign[] (200)
```

---

## Regras de Negócio Identificadas

### RN-01: Formato obrigatório do adAccountId
**Onde no código:** `create-ad-account.dto.ts:12`
**Descrição:** O `adAccountId` deve seguir o formato `act_{numeric_id}` exatamente como a Meta exige nas chamadas de API. Um valor inválido (ex: `"123456"` sem prefixo `act_`) é rejeitado com 400 na borda do sistema.
**Condição:** Aplica-se apenas no cadastro (`CreateAdAccountDto`). O `GetInsightsQueryDto` não tem essa validação — inconsistência conhecida (ver Dívida Técnica).

### RN-02: Token armazenado sempre criptografado
**Onde no código:** `ad-accounts.service.ts:28` e `ad-accounts.service.ts:79`
**Descrição:** O `accessToken` é cifrado com AES-256-GCM antes de qualquer escrita no banco. A chave de cifragem (`ENCRYPTION_KEY`) é uma variável de ambiente com 64 caracteres hexadecimais (256 bits). O token nunca aparece em logs, respostas HTTP ou no cache Redis em texto claro — apenas na operação de descriptografia dentro do service antes de chamar a Meta API.
**Condição:** Todo `create` e `update` que inclua novo `accessToken`.

### RN-03: Conta inativa bloqueia consultas de relatório
**Onde no código:** `campaign-reports.service.ts:28`, `46`, `68`
**Descrição:** Antes de buscar dados na Meta API, o service verifica `account.isActive`. Se `false`, lança `422 Unprocessable Entity`. Isso permite desativar uma conta sem apagá-la, útil quando o token expira e o cliente ainda não renovou.
**Condição:** Aplica-se em `listCampaigns`, `getInsights` e `getCampaignInsights`. **Não se aplica** quando o resultado vem do cache Redis — se a conta for desativada após um cache hit, o dado antigo ainda será retornado por até 300s.

### RN-04: Cache com TTL duplo (credenciais vs. métricas)
**Onde no código:** `ad-accounts.service.ts:32-33` e `campaign-reports.service.ts:10`
**Descrição:** Credenciais ficam cacheadas com o TTL global do `CacheModule` (padrão: `CACHE_TTL_SECONDS`, default 3600s). Métricas e listas de campanhas têm TTL fixo de 300s (`INSIGHTS_TTL_MS`), independente da configuração global. Isso protege o rate limit da Marketing API (~200 req/hora por token de usuário Tier 1).
**Condição:** O TTL de 300s é hardcoded e não configurável por variável de ambiente.

### RN-05: Token expirado sinalizado como 401, não 500
**Onde no código:** `meta-ads.service.ts:93-94`, `common/exceptions/oauth-token-expired.exception.ts`
**Descrição:** Quando a Meta retorna `OAuthException` com `code: 190` (token expirado ou inválido), o sistema lança `OAuthTokenExpiredException extends UnauthorizedException`. O NestJS converte isso em `401 Unauthorized`, sinalizando ao consumidor da API que o token precisa ser rotacionado via `PATCH /ad-accounts/:id`.
**Condição:** Qualquer chamada à Marketing API com token inválido.

### RN-06: Soft delete preserva histórico
**Onde no código:** `ad-accounts.service.ts:89`
**Descrição:** A remoção de uma ad account usa `softRemove` — popula `deletedAt` sem apagar a linha do banco. A constraint `UNIQUE` em `adAccountId` permanece ativa mesmo para registros soft-deleted, o que impede re-cadastro do mesmo `adAccountId`. O campo `findAll` filtra por `isActive: true`, logo contas deletadas não aparecem nas listagens.

### RN-07: Insights de campanha sem dados retornam 404
**Onde no código:** `meta-ads.service.ts:79-81`
**Descrição:** Quando uma campanha não tem dados para o `datePreset` solicitado, a Meta retorna `{ data: [] }`. O sistema lança `404 Not Found` com mensagem indicando o `campaignId` e o período, em vez de retornar `undefined` silenciosamente.
**Condição:** Aplica-se apenas em `fetchCampaignInsights` (busca por campanha específica). `fetchInsights` (busca por conta) retorna array vazio normalmente.

### RN-08: Cache invalidado imediatamente em update/delete
**Onde no código:** `ad-accounts.service.ts:83-84` e `91-92`
**Descrição:** Ao atualizar ou remover uma ad account, ambas as chaves de cache (`ad-account:id:{id}` e `ad-account:act:{adAccountId}`) são invalidadas imediatamente. As chaves de insights e campanhas **não são invalidadas** — o novo token só será usado após os 300s de TTL expirarem ou reinício do servidor.

---

## Endpoints Expostos

### Módulo: Ad Accounts (`/api/v1/ad-accounts`)

| Método | Path | Guard | Body/Query | Resposta | Descrição |
|--------|------|-------|------------|----------|-----------|
| `POST` | `/ad-accounts` | `ApiKeyGuard` | `CreateAdAccountDto` | `AdAccountEntity` (201) | Cadastra nova ad account com token criptografado |
| `GET` | `/ad-accounts?clientId={uuid}` | `ApiKeyGuard` | `clientId: UUID` (query) | `AdAccountEntity[]` (200) | Lista contas ativas de um cliente |
| `GET` | `/ad-accounts/:id` | `ApiKeyGuard` | `id: UUID` (param) | `AdAccountEntity` (200) | Busca conta por ID interno |
| `PATCH` | `/ad-accounts/:id` | `ApiKeyGuard` | `UpdateAdAccountDto` | `AdAccountEntity` (200) | Atualiza token, nome ou status |
| `DELETE` | `/ad-accounts/:id` | `ApiKeyGuard` | `id: UUID` (param) | `void` (204) | Soft delete da conta |

### Módulo: Campaign Reports (`/api/v1/campaign-reports`)

| Método | Path | Guard | Query | Resposta | Cache |
|--------|------|-------|-------|----------|-------|
| `GET` | `/campaign-reports/campaigns` | `ApiKeyGuard` | `adAccountId` (obrigatório) | `MetaCampaign[]` (200) | TTL 300s |
| `GET` | `/campaign-reports/insights` | `ApiKeyGuard` | `GetInsightsQueryDto` | `MetaInsights[]` (200) | TTL 300s |
| `GET` | `/campaign-reports/insights/:campaignId` | `ApiKeyGuard` | `adAccountId`, `datePreset` | `MetaInsights` (200) | TTL 300s |

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

> A constraint `UNIQUE` em `ad_account_id` é global — um mesmo `adAccountId` não pode ser cadastrado para dois clientes diferentes. Isso é intencional: cada conta de anúncio Meta pertence a um único Business Manager.

---

## Tipos da Meta Marketing API

### `MetaCampaign`
```typescript
{ id, name, status: 'ACTIVE'|'PAUSED'|'DELETED'|'ARCHIVED', objective, created_time }
```

### `MetaInsights`
```typescript
{
  campaign_id?, campaign_name?,
  impressions, clicks, spend, reach, cpm, cpc, ctr,  // todos retornados como string pela Meta
  actions?, cost_per_action_type?,
  date_start, date_stop
}
```

> A Meta retorna todos os campos numéricos como `string`. Conversão para `number` (se necessária) é responsabilidade do consumidor.

### Enums disponíveis

**`MetaDatePreset`:** `today` | `yesterday` | `last_7d` | `last_14d` | `last_30d` | `this_month` | `last_month`

**`MetaInsightsLevel`:** `account` | `campaign` | `adset` | `ad`

---

## Estratégia de Cache Redis

| Chave | TTL | Invalidação | Descrição |
|-------|-----|------------|-----------|
| `ad-account:id:{uuid}` | TTL global (CACHE_TTL_SECONDS) | update / delete | Credencial por ID interno |
| `ad-account:act:{adAccountId}` | TTL global (CACHE_TTL_SECONDS) | update / delete | Credencial por adAccountId (hot path do CampaignReports) |
| `meta:campaigns:{adAccountId}` | 300s (fixo) | Não invalidado | Lista de campanhas da conta |
| `meta:insights:{adAccountId}:{level}:{datePreset}` | 300s (fixo) | Não invalidado | Insights por conta + período + nível |
| `meta:insights:campaign:{campaignId}:{datePreset}` | 300s (fixo) | Não invalidado | Insights por campanha + período |

**Comportamento de stale cache após rotação de token:** Ao rodar `PATCH /ad-accounts/:id` com novo `accessToken`, as chaves de credencial são invalidadas imediatamente. Porém as chaves de insights ainda apontam para dados obtidos com o token antigo — elas expiram naturalmente em até 300s. Não há risco funcional, apenas dados ligeiramente desatualizados no intervalo.

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
    Given já existe conta "act_123" no banco (mesmo deletedAt != null)
    When POST com mesmo adAccountId
    Then retorna 409 Conflict

  Scenario: Formato inválido de adAccountId
    When POST com adAccountId "123456789" (sem prefixo act_)
    Then retorna 400 Bad Request com detalhe do campo adAccountId

  Scenario: Rotação de token
    When PATCH /api/v1/ad-accounts/{id} com { accessToken: "novo-token" }
    Then retorna 200 com entidade atualizada
    And cache "ad-account:id:{id}" e "ad-account:act:{adAccountId}" são deletados do Redis

Feature: Campaign Reports

  Scenario: Listar campanhas com cache hit
    Given Redis contém "meta:campaigns:act_123"
    When GET /api/v1/campaign-reports/campaigns?adAccountId=act_123
    Then retorna 200 sem chamar a Meta Marketing API

  Scenario: Listar campanhas sem cache
    Given Redis não contém "meta:campaigns:act_123"
    And AdAccountEntity ativa com adAccountId "act_123"
    When GET /api/v1/campaign-reports/campaigns?adAccountId=act_123
    Then decripta o token → chama Meta API → popula cache com TTL 300s → retorna 200

  Scenario: Conta inativa
    Given AdAccountEntity com isActive: false
    When GET /api/v1/campaign-reports/campaigns?adAccountId=act_123
    Then retorna 422 Unprocessable Entity (exceto se cache hit — stale data por até 300s)

  Scenario: Token expirado
    Given accessToken retorna OAuthException code 190 da Meta API
    When qualquer endpoint de campaign-reports é chamado
    Then retorna 401 Unauthorized com mensagem descritiva

  Scenario: Campanha sem dados no período
    Given campaignId "999" sem atividade no período "last_7d"
    When GET /api/v1/campaign-reports/insights/999?adAccountId=act_123&datePreset=last_7d
    Then retorna 404 Not Found
```

---

## Variáveis de Ambiente Necessárias

| Variável | Obrigatório | Default | Descrição |
|----------|-------------|---------|-----------|
| `META_GRAPH_API_URL` | Não | `https://graph.facebook.com` | Base URL da Meta API (compartilhada com módulo de mensagens) |
| `META_ADS_API_VERSION` | Não | `v21.0` | Versão da Marketing API |
| `ENCRYPTION_KEY` | **Sim** | — | 64 hex chars (256-bit) para AES-256-GCM |
| `MASTER_API_KEY` | **Sim** | — | API Key do `ApiKeyGuard` |
| `REDIS_URL` | **Sim** | — | URL do Redis para cache |
| `DATABASE_URL` | **Sim** | — | URL do PostgreSQL |

---

## Dependências Externas

### APIs externas
- **Meta Marketing API** — `graph.facebook.com/{version}/{adAccountId}/campaigns` e `/insights`
  - Autenticação: `access_token` como query param (não Bearer header)
  - Rate limit: ~200 chamadas/hora por User Token (Tier 1)
  - Paginação: cursor-based, retorna até 25 itens por página (apenas página 1 implementada)
  - Formato das métricas: todos os campos numéricos são retornados como `string`

### Módulos NestJS
- `@nestjs/axios` (HttpModule) — chamadas HTTP à Meta API
- `@nestjs/cache-manager` + `@keyv/redis` — cache Redis global
- `@nestjs/typeorm` — acesso ao PostgreSQL
- `@nestjs/config` / `@nestjs/swagger` — configuração e documentação

### Módulos internos importados
- `CryptoModule` (`AesCryptoService`) — cifra/decifra tokens
- `AdAccountsModule` — importado por `CampaignReportsModule` para resolver credenciais

---

## Pontos de Atenção / Dívida Técnica

### 1. Paginação não implementada (limitação conhecida)
`MetaAdsService.fetchCampaigns` e `fetchInsights` retornam apenas a **primeira página** da resposta da Meta (até 25 itens). Clientes com mais de 25 campanhas verão dados incompletos. A interface `MetaApiPaginatedResponse` já possui o campo `paging.next` tipado, preparando para implementação futura. Priorizar quando houver cliente com volume alto de campanhas.

### 2. `adAccountId` sem validação de formato em `GetInsightsQueryDto`
O endpoint `GET /campaign-reports/insights?adAccountId=invalido` aceita qualquer string no `adAccountId` (sem `@Matches(/^act_\d+$/)`). A requisição chegará ao banco e falhará com 404, mas seria mais correto retornar 400. O `CreateAdAccountDto` já tem essa validação — inconsistência de tratamento.

### 3. TTL de insights é hardcoded
`INSIGHTS_TTL_MS = 300 * 1000` está fixo no código. Se um cliente precisar de dados mais frescos (ex: monitoramento em tempo real), não há como configurar isso sem alterar o código. Candidato a virar uma variável de ambiente `INSIGHTS_CACHE_TTL_SECONDS`.

### 4. Stale cache após desativação de conta
Se uma conta for desativada (`isActive: false`) enquanto há dados em cache, os próximos requests para métricas (até expirar o TTL de 300s) ainda retornarão os dados cacheados — o check de `isActive` não é executado no cache hit. Comportamento aceitável para a fase atual, mas vale documentar para o suporte.

### 5. `OAuthTokenExpiredException` herdada pelo módulo webhook sem tratamento HTTP
O módulo webhook (`instagram-graph.service.ts`) ainda lança `OAuthTokenExpiredException`, que agora estende `UnauthorizedException`. No contexto de webhook, essa exceção é capturada pelo `catch` em `instagram-webhook.service.ts:35` e logada como warning — não vira resposta HTTP. O comportamento é correto, mas é um efeito colateral do refactor que merece um comentário no código.

### 6. Sem expiração automática de token
`tokenExpiresAt` é armazenado mas **nenhum processo verifica ou age sobre ele**. Não há job/cron que alerte ou desative contas com tokens próximos do vencimento. Um User Token de longa duração tem validade de ~60 dias — sem monitoramento, o operador só descobrirá o problema quando os relatórios começarem a retornar 401.
