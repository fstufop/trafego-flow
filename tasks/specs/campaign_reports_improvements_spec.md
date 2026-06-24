# Spec: Campaign Reports — Melhorias e Dívidas Técnicas

## 1. Objetivo

Eliminar três dívidas técnicas identificadas na documentação do módulo `campaign-reports`:

1. **Paginação** — Clientes com >25 campanhas veem dados incompletos porque `MetaAdsService` retorna apenas a primeira página da Marketing API. A solução expõe cursor-based pagination nos endpoints de relatório.
2. **Monitoramento de expiração de token** — `tokenExpiresAt` é armazenado mas nenhum mecanismo alerta sobre tokens prestes a vencer. Sem monitoramento, o operador só descobre o problema ao receber 401 em produção. A solução adiciona um endpoint de saúde de tokens e um job agendado.
3. **TTL de insights hardcoded** — `INSIGHTS_TTL_MS = 300 * 1000` está fixo no código, impedindo tuning sem redeploy. A solução torna o valor configurável via variável de ambiente.

## 2. Contexto Multi-tenant

| Dado | Isolamento |
|------|-----------|
| Verificação de tokens expirando | Por `clientId` — cada cliente só vê suas próprias contas |
| TTL de cache de insights | Global — único valor para toda a plataforma |
| Paginação (cursor) | Stateless — o cursor é opaco e fornecido pelo caller |

## 3. Descrição Funcional

### 3.1 — Paginação cursor-based (`campaign-reports`)
- Os endpoints `GET /campaign-reports/campaigns` e `GET /campaign-reports/insights` aceitam parâmetro opcional `cursor` (string opaca retornada pela Meta API).
- A resposta muda de array para objeto `{ data: T[], paging: { next?: string } }`.
- O `MetaAdsService` repassa o cursor quando fornecido; a lógica de "buscar todas as páginas" fica a cargo do caller (front-end ou job futuro).
- Cache por `adAccountId:cursor` para não poluir o cache de "primeira página" com cursores intermediários.

### 3.2 — Monitoramento de expiração de token (`ad-accounts`)
- Novo endpoint `GET /ad-accounts/expiring?clientId={uuid}&daysAhead=7` lista contas cujo `tokenExpiresAt` está dentro do intervalo `[agora, agora + daysAhead]`.
- Job agendado (cron diário às 08:00 BRT) percorre **todas** as contas ativas com `tokenExpiresAt` definido e loga `[WARN]` para as que vencem em ≤7 dias.
- Contas com `tokenExpiresAt = null` (token permanente) são ignoradas.
- Sem envio de e-mail/webhook nesta fase — apenas logging estruturado e endpoint de consulta.

### 3.3 — TTL de insights configurável (`campaign-reports`)
- Nova variável de ambiente `INSIGHTS_CACHE_TTL_SECONDS` (default `300`).
- Adicionada a `meta-ads.config.ts` e ao `validationSchema` de `configuration.ts`.
- `CampaignReportsService` lê o valor via `ConfigService` no construtor — substitui a constante `INSIGHTS_TTL_MS`.

## 4. Estrutura de Arquivos

### Novos arquivos
```
src/modules/ad-accounts/
  ad-accounts-token-monitor.service.ts   ← job agendado + lógica de expiração
  ad-accounts-token-monitor.service.spec.ts
```

### Arquivos modificados
```
src/modules/campaign-reports/
  meta-ads.service.ts              ← suporte a cursor nos métodos fetchCampaigns/fetchInsights
  campaign-reports.service.ts      ← TTL via ConfigService; cache key inclui cursor
  campaign-reports.controller.ts   ← aceita ?cursor=; retorna PaginatedResponse
  campaign-reports.module.ts       ← registra AdAccountsTokenMonitorService? Não — ficará em AdAccountsModule

src/modules/ad-accounts/
  ad-accounts.controller.ts        ← novo endpoint GET /ad-accounts/expiring
  ad-accounts.service.ts           ← novo método findExpiring(clientId, daysAhead)
  ad-accounts.module.ts            ← registra AdAccountsTokenMonitorService + ScheduleModule
  interfaces/ad-accounts-service.interface.ts  ← adiciona findExpiring

src/modules/campaign-reports/interfaces/
  meta-campaign.interface.ts       ← adiciona PaginatedResult<T>

src/config/
  meta-ads.config.ts               ← adiciona insightsCacheTtlSeconds
  configuration.ts                 ← INSIGHTS_CACHE_TTL_SECONDS no validationSchema

.env.example                       ← INSIGHTS_CACHE_TTL_SECONDS=300
```

### Instalação de dependência
```bash
npm install @nestjs/schedule
```
Importar `ScheduleModule.forRoot()` em `AppModule`.

## 5. Contrato de API

### 5.1 Paginação — GET /campaign-reports/campaigns

| Campo    | Valor |
|----------|-------|
| Método   | `GET` |
| Path     | `/api/v1/campaign-reports/campaigns` |
| Auth     | `x-api-key` |
| Query    | `adAccountId: string` (obrigatório), `cursor?: string` (opcional) |
| Resposta | `PaginatedResult<MetaCampaign>` (200) |

```typescript
interface PaginatedResult<T> {
  data: T[];
  paging: {
    next?: string;   // cursor opaco; ausente quando não há próxima página
  };
}
```

### 5.2 Paginação — GET /campaign-reports/insights

| Campo    | Valor |
|----------|-------|
| Método   | `GET` |
| Path     | `/api/v1/campaign-reports/insights` |
| Auth     | `x-api-key` |
| Query    | `GetInsightsQueryDto` + `cursor?: string` (novo campo) |
| Resposta | `PaginatedResult<MetaInsights>` (200) |

> `GET /campaign-reports/insights/:campaignId` **não muda** — insights por campanha retornam exatamente 1 item (sem paginação).

### 5.3 Token health — GET /ad-accounts/expiring

| Campo    | Valor |
|----------|-------|
| Método   | `GET` |
| Path     | `/api/v1/ad-accounts/expiring` |
| Auth     | `x-api-key` |
| Query    | `clientId: UUID` (obrigatório), `daysAhead?: number` (default `7`, max `90`) |
| Resposta | `AdAccountEntity[]` (200) — lista de contas com token vencendo no período |

> ⚠️ **Rota estática antes de `/:id`** — declarar `/expiring` **antes** da rota `/:id` no controller para evitar que o NestJS interprete "expiring" como UUID.

## 6. Entidade

Sem alterações de schema. `AdAccountEntity` já possui `tokenExpiresAt: Date | null`.

A query do `findExpiring` será:
```sql
WHERE client_id = :clientId
  AND is_active = true
  AND token_expires_at IS NOT NULL
  AND token_expires_at <= NOW() + INTERVAL ':daysAhead days'
  AND deleted_at IS NULL
```

## 7. Cache (Redis)

### Mudanças na estratégia de cache

| Chave (atual) | Chave (nova) | Motivo |
|--------------|--------------|--------|
| `meta:campaigns:{adAccountId}` | `meta:campaigns:{adAccountId}` (sem cursor) — apenas primeira página | Mantém comportamento atual |
| — | `meta:campaigns:{adAccountId}:cursor:{cursor}` | Páginas subsequentes — TTL `INSIGHTS_CACHE_TTL_SECONDS` |
| `meta:insights:{adAccountId}:{level}:{datePreset}` | Idem (sem cursor) | Mantém |
| — | `meta:insights:{adAccountId}:{level}:{datePreset}:cursor:{cursor}` | Páginas com cursor — TTL `INSIGHTS_CACHE_TTL_SECONDS` |

**Regra:** se `cursor` não for fornecido, a chave de cache mantém o formato atual (retrocompatível).

## 8. Interface do Service

### AdAccountsService (adição)
```typescript
interface IAdAccountsService {
  // ... métodos existentes ...
  findExpiring(clientId: string, daysAhead: number): Promise<AdAccountEntity[]>;
}
```

### AdAccountsTokenMonitorService (novo)
```typescript
interface IAdAccountsTokenMonitorService {
  checkExpiringTokens(): Promise<void>;  // chamado pelo cron e exposto para teste manual
}
```

### MetaAdsService (modificação de assinatura)
```typescript
interface IMetaAdsService {
  fetchCampaigns(adAccountId: string, accessToken: string, cursor?: string): Promise<MetaApiPaginatedResponse<MetaCampaign>>;
  fetchInsights(adAccountId: string, accessToken: string, params: MetaInsightsParams, cursor?: string): Promise<MetaApiPaginatedResponse<MetaInsights>>;
  fetchCampaignInsights(campaignId: string, accessToken: string, params: MetaInsightsParams): Promise<MetaInsights>;
}
```

> Note: `MetaAdsService` agora retorna `MetaApiPaginatedResponse<T>` completo (não apenas `.data`). O `CampaignReportsService` extrai `data` e `paging` e repassa ambos para o controller.

## 9. DTOs e Validações

### `GetInsightsQueryDto` (modificação — adicionar cursor)
```typescript
class GetInsightsQueryDto {
  // ... campos existentes ...

  @IsOptional()
  @IsString()
  cursor?: string;
}
```

### `GetExpiringQueryDto` (novo)
```typescript
class GetExpiringQueryDto {
  @IsUUID()
  clientId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  daysAhead?: number = 7;
}
```

### `PaginatedResult<T>` (novo tipo de resposta — não é DTO de input)
```typescript
interface PaginatedResult<T> {
  data: T[];
  paging: { next?: string };
}
```

## 10. Critérios de Aceitação (BDD)

```gherkin
Feature: Paginação cursor-based em Campaign Reports

  Scenario: Primeira página sem cursor
    Given conta "act_123" com 30 campanhas na Meta API
    When GET /api/v1/campaign-reports/campaigns?adAccountId=act_123 (sem cursor)
    Then retorna 200 com { data: [25 campanhas], paging: { next: "cursor_opaco_abc" } }
    And o resultado é cacheado em "meta:campaigns:act_123"

  Scenario: Segunda página com cursor
    Given cursor "cursor_opaco_abc" retornado pela página anterior
    When GET /api/v1/campaign-reports/campaigns?adAccountId=act_123&cursor=cursor_opaco_abc
    Then retorna 200 com { data: [5 campanhas], paging: {} } (sem next — última página)
    And o resultado é cacheado em "meta:campaigns:act_123:cursor:cursor_opaco_abc"

  Scenario: Cache hit com cursor
    Given cache "meta:campaigns:act_123:cursor:cursor_opaco_abc" populado
    When GET /api/v1/campaign-reports/campaigns?adAccountId=act_123&cursor=cursor_opaco_abc
    Then retorna 200 sem chamar a Meta API

  Scenario: Resposta retrocompatível com conta de ≤25 campanhas
    Given conta com 10 campanhas (resposta sem paging.next da Meta)
    When GET /api/v1/campaign-reports/campaigns?adAccountId=act_123
    Then retorna { data: [10 campanhas], paging: {} }

Feature: Monitoramento de expiração de token

  Scenario: Listar tokens próximos do vencimento
    Given clientId "uuid-c1" com 3 contas:
      - act_1: tokenExpiresAt = hoje + 3 dias
      - act_2: tokenExpiresAt = hoje + 10 dias
      - act_3: tokenExpiresAt = null (permanente)
    When GET /api/v1/ad-accounts/expiring?clientId=uuid-c1&daysAhead=7
    Then retorna 200 com [act_1] (apenas quem vence em ≤7 dias e tem data definida)

  Scenario: daysAhead padrão é 7
    When GET /api/v1/ad-accounts/expiring?clientId=uuid-c1 (sem daysAhead)
    Then comporta-se como daysAhead=7

  Scenario: daysAhead inválido
    When GET /api/v1/ad-accounts/expiring?clientId=uuid-c1&daysAhead=200
    Then retorna 400 Bad Request (max é 90)

  Scenario: Job cron executa e loga warning
    Given token com tokenExpiresAt = hoje + 5 dias e isActive = true
    When job AdAccountsTokenMonitorService.checkExpiringTokens() executa (cron diário 08:00)
    Then Logger.warn é chamado com adAccountId e dias restantes
    And nenhum dado é alterado no banco

  Scenario: Tokens permanentes ignorados pelo job
    Given AdAccountEntity com tokenExpiresAt = null
    When checkExpiringTokens() executa
    Then a conta não aparece no log de warning

Feature: TTL de insights configurável

  Scenario: TTL lido de variável de ambiente
    Given INSIGHTS_CACHE_TTL_SECONDS=600
    When GET /campaign-reports/campaigns?adAccountId=act_123 (cache miss)
    Then o cache é populado com TTL de 600_000ms (não 300_000ms)

  Scenario: TTL default quando variável não definida
    Given INSIGHTS_CACHE_TTL_SECONDS não está definida no ambiente
    When qualquer endpoint de campaign-reports popula o cache
    Then o TTL usado é 300_000ms
```

## 11. Definition of Done

### Paginação
- [ ] `MetaAdsService.fetchCampaigns` e `fetchInsights` aceitam `cursor?: string` e retornam `MetaApiPaginatedResponse<T>` completo
- [ ] `CampaignReportsService` repassa cursor e constrói chave de cache com cursor quando presente
- [ ] `CampaignReportsController` aceita `?cursor=` e retorna `PaginatedResult<T>`
- [ ] Endpoints `GET /campaign-reports/campaigns` e `GET /campaign-reports/insights` com novo formato de resposta documentados no Swagger
- [ ] `GET /campaign-reports/insights/:campaignId` não alterado
- [ ] Testes unitários de `MetaAdsService` cobrindo: com cursor, sem cursor, última página (sem `paging.next`)
- [ ] Testes unitários de `CampaignReportsService` cobrindo: cache key com cursor, cache key sem cursor

### Monitoramento de token
- [ ] `AdAccountsService.findExpiring(clientId, daysAhead)` implementado com query TypeORM correta
- [ ] `AdAccountsTokenMonitorService` com `@Cron('0 8 * * *')` chama `findExpiring` de todas as contas ativas e loga warnings
- [ ] Endpoint `GET /ad-accounts/expiring` declarado **antes** de `GET /ad-accounts/:id` no controller
- [ ] `GetExpiringQueryDto` com `@IsUUID` e `@Max(90)` para `daysAhead`
- [ ] `@nestjs/schedule` instalado e `ScheduleModule.forRoot()` registrado em `AppModule`
- [ ] Testes unitários de `AdAccountsService.findExpiring` (mock do repo)
- [ ] Testes unitários de `AdAccountsTokenMonitorService.checkExpiringTokens` (verifica que Logger.warn é chamado)

### TTL configurável
- [ ] `INSIGHTS_CACHE_TTL_SECONDS` adicionado a `meta-ads.config.ts`
- [ ] Joi validation: `Joi.number().min(30).max(3600).default(300)` em `configuration.ts`
- [ ] `CampaignReportsService` injeta `ConfigService` e usa `config.get('meta-ads.insightsCacheTtlSeconds') * 1000` em vez de `INSIGHTS_TTL_MS`
- [ ] Constante `INSIGHTS_TTL_MS` removida
- [ ] `.env.example` atualizado com `INSIGHTS_CACHE_TTL_SECONDS=300`
- [ ] Testes do `CampaignReportsService` passam `ConfigService` mockado com o valor de TTL
