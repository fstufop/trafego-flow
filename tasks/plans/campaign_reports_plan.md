# Plano de Implementação: Campaign Reports (Meta Marketing API)

**Spec:** `tasks/specs/campaign_reports_spec.md`
**Data:** 2026-06-16

---

## Análise de Alternativas

### Estrutura do cliente HTTP para a Marketing API

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| **A (Escolhida)** | `MetaAdsService` separado dentro de `campaign-reports/`, puramente HTTP (sem cache, sem DB) | Responsabilidade única; fácil de testar com mock do `HttpService`; mesmo padrão do `InstagramGraphService` | Mais arquivos |
| B | Estender `InstagramGraphService` com métodos de Ads | Menos arquivos | Mistura Page Token (messaging) com User Token (ads); viola SRP; testes acoplados |
| C | Criar um `MetaHttpClient` global em `src/common/` | Reutilizável | Prematura generalização — só há um consumidor por enquanto |

**Decisão:** Alternativa A — espelha exatamente o padrão já estabelecido por `InstagramGraphService` e mantém a separação entre tokens de Página e tokens de Usuário.

### Armazenamento de métricas

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| **A (Escolhida)** | On-demand + cache Redis (TTL 300s), sem persistência | Zero schema extra; simple; suficiente para a fase atual | Sem histórico após expirar o cache |
| B | Persistir snapshots em tabela `campaign_metrics` | Histórico ilimitado | Over-engineering para fase 1; adiciona migration + entity extra |

**Decisão:** Alternativa A — persistência de histórico está explicitamente fora do escopo da spec (seção 15).

---

## Recursos Reutilizáveis Identificados

| Recurso | Localização | Uso |
|---|---|---|
| `ApiKeyGuard` | `src/common/guards/api-key.guard.ts` | Autenticação de todos os endpoints |
| `AesCryptoService` | `src/common/crypto/aes.service.ts` | Criptografar/descriptografar `accessToken` |
| `CryptoModule` | `src/common/crypto/crypto.module.ts` | Importar nos dois novos módulos |
| `BaseEntity` | `src/common/database/base.entity.ts` | `AdAccountEntity` estende esta classe |
| `OAuthTokenExpiredException` | `src/modules/webhook/instagram/exceptions/` | **Mover** para `src/common/exceptions/` e generalizar o construtor de `pageId` para `identifier` |
| `HttpModule` (`@nestjs/axios`) | Já instalado — usado em `WebhookModule` | Importar em `CampaignReportsModule` |
| Padrão de testes | `src/modules/integrations/integrations.service.spec.ts` | mockRepo + mockCache + mockCrypto |
| Padrão de migration | `src/database/migrations/1779922436820-Migration.ts` | SQL manual no `up`/`down` |
| `ConfigService` keys | `meta.graphApiUrl`, `meta.graphApiVersion` | Reutilizar para base URL da Marketing API |

---

## Diagrama de Fluxo

### Ad Accounts (CRUD de credenciais)

```
POST /api/v1/ad-accounts
    ↓ ApiKeyGuard (x-api-key header)
AdAccountsController
    ↓ @Body() CreateAdAccountDto  ←  ValidationPipe (whitelist, transform)
AdAccountsService.create()
    ↓ AesCryptoService.encrypt(accessToken)
    ↓ AdAccountRepository.save()
    ↓ cache.set("ad-account:id:{id}", entity, 3600s)
    ↓ cache.set("ad-account:act:{adAccountId}", entity, 3600s)
    → AdAccountEntity (201) — accessToken excluído via @Exclude()
```

### Campaign Reports (consulta de métricas)

```
GET /api/v1/campaign-reports/campaigns?adAccountId=act_123
    ↓ ApiKeyGuard
CampaignReportsController
    ↓ @Query() adAccountId: string
CampaignReportsService.listCampaigns(adAccountId)
    ↓ cache.get("meta:campaigns:act_123")
        → HIT: retorna MetaCampaign[] diretamente
        → MISS:
            ↓ AdAccountsService.findByAdAccountId("act_123")  →  AdAccountEntity
            ↓ [isActive check → 422 se inativo]
            ↓ AesCryptoService.decrypt(entity.accessToken)
            ↓ MetaAdsService.fetchCampaigns("act_123", decryptedToken)
                ↓ GET graph.facebook.com/v21.0/act_123/campaigns
                    → OAuthException code 190 → OAuthTokenExpiredException → 401
            ↓ cache.set("meta:campaigns:act_123", result, 300s)
            → MetaCampaign[] (200)
```

---

## Tarefas Sequenciais

### Tarefa 1 — [Config] Adicionar configuração da Ads API

**Arquivos:**
- `src/config/meta-ads.config.ts` ← novo
- `src/config/configuration.ts` ← modificar: adicionar `metaAdsConfig` aos loads e ao schema Joi
- `.env.example` ← modificar: documentar `META_ADS_API_VERSION`

**O que fazer:**
Criar `meta-ads.config.ts` registrando `meta-ads.apiVersion` (default `v21.0`).
Adicionar ao `validationSchema`: `META_ADS_API_VERSION: Joi.string().default('v21.0')`.
A base URL da Marketing API reutiliza `meta.graphApiUrl` já existente.

**Depende de:** nada
**Testável:** `npm run build` sem erros de compilação

---

### Tarefa 2 — [Common] Extrair e generalizar OAuthTokenExpiredException

**Arquivos:**
- `src/common/exceptions/oauth-token-expired.exception.ts` ← novo
- `src/modules/webhook/instagram/exceptions/oauth-token-expired.exception.ts` ← remover (ou reexportar de common)
- `src/modules/webhook/instagram/instagram-graph.service.ts` ← atualizar import

**O que fazer:**
Criar versão generalizada em `src/common/exceptions/`:
```typescript
export class OAuthTokenExpiredException extends Error {
  constructor(identifier: string) {
    super(`OAuth token expired or invalid for: ${identifier}`);
    this.name = 'OAuthTokenExpiredException';
  }
}
```
Atualizar o import em `instagram-graph.service.ts`. Remover o arquivo antigo.

**Depende de:** nada (paralelo com Tarefa 1)
**Testável:** `npm run build` + `npm run test` sem quebrar testes existentes

---

### Tarefa 3 — [Entity + Migration] AdAccountEntity e tabela ad_accounts

**Arquivos:**
- `src/modules/ad-accounts/entities/ad-account.entity.ts` ← novo
- `src/database/migrations/1779944000000-CreateAdAccountsTable.ts` ← novo (timestamp > 1779922436820)

**O que fazer:**
Entity conforme spec seção 6: `clientId`, `client` (ManyToOne → ClientEntity), `adAccountId` (unique), `accountName` (nullable), `accessToken` (@Exclude), `tokenExpiresAt` (nullable), `isActive` (default true).

Migration manual com `up` criando tabela `ad_accounts` e FK para `clients.id`, e `down` desfazendo.

SQL do `up`:
```sql
CREATE TABLE "ad_accounts" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMP,
  "client_id" uuid NOT NULL,
  "ad_account_id" character varying NOT NULL,
  "account_name" character varying,
  "access_token" text NOT NULL,
  "token_expires_at" TIMESTAMP WITH TIME ZONE,
  "isActive" boolean NOT NULL DEFAULT true,
  CONSTRAINT "UQ_ad_accounts_ad_account_id" UNIQUE ("ad_account_id"),
  CONSTRAINT "PK_ad_accounts" PRIMARY KEY ("id")
);
ALTER TABLE "ad_accounts"
  ADD CONSTRAINT "FK_ad_accounts_client_id"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id");
```

**Depende de:** Tarefa 1 (para imports de path)
**Testável:** migration aplicável (requer DB local)

---

### Tarefa 4 — [Interface + DTOs] Contratos do AdAccounts

**Arquivos:**
- `src/modules/ad-accounts/interfaces/ad-accounts-service.interface.ts` ← novo
- `src/modules/ad-accounts/dto/create-ad-account.dto.ts` ← novo
- `src/modules/ad-accounts/dto/update-ad-account.dto.ts` ← novo

**O que fazer:**
- Interface `IAdAccountsService` com os 6 métodos da spec seção 8.
- `CreateAdAccountDto`: `@IsUUID() clientId`, `@Matches(/^act_\d+$/) adAccountId`, `@IsString() @IsNotEmpty() accessToken`, `@IsOptional() @IsString() accountName`, `@IsOptional() @IsDateString() tokenExpiresAt`.
- `UpdateAdAccountDto`: todos opcionais — `accessToken`, `tokenExpiresAt`, `isActive` (`@IsBoolean()`), `accountName`.

**Depende de:** Tarefa 3 (entity importada na interface)
**Testável:** `npm run build`

---

### Tarefa 5 — [Service] AdAccountsService

**Arquivo:** `src/modules/ad-accounts/ad-accounts.service.ts`

**O que fazer:**
Implementar `IAdAccountsService`. Padrão idêntico ao `IntegrationsService`:
- `create`: encrypt token → repo.save → cache por id e por adAccountId; captura `QueryFailedError code 23505` → `ConflictException`.
- `findAll(clientId)`: repo.find `{ where: { clientId, isActive: true } }`.
- `findOne(id)`: cache `ad-account:id:{id}` → repo → 404 se não encontrado.
- `findByAdAccountId(adAccountId)`: cache `ad-account:act:{adAccountId}` → repo → 404.
- `update(id, dto)`: findOne → patch (encrypt se accessToken presente) → repo.save → invalidar ambos os caches.
- `remove(id)`: findOne → repo.softRemove → invalidar ambos os caches.

Cache keys:
```typescript
const cacheById = (id: string) => `ad-account:id:${id}`;
const cacheByAct = (adAccountId: string) => `ad-account:act:${adAccountId}`;
```

**Depende de:** Tarefas 3, 4
**Testável:** testes unitários (Tarefa 8)

---

### Tarefa 6 — [Controller] AdAccountsController

**Arquivo:** `src/modules/ad-accounts/ad-accounts.controller.ts`

**O que fazer:**
5 endpoints conforme spec seção 5:
- `POST /ad-accounts` → `@HttpCode(201)` → `service.create(dto)`
- `GET /ad-accounts?clientId=` → `@Query('clientId', ParseUUIDPipe)` → `service.findAll(clientId)`
- `GET /ad-accounts/:id` → `@Param('id', ParseUUIDPipe)` → `service.findOne(id)`
- `PATCH /ad-accounts/:id` → `service.update(id, dto)`
- `DELETE /ad-accounts/:id` → `@HttpCode(204)` → `service.remove(id)`

Decorators: `@ApiTags('ad-accounts')`, `@ApiSecurity('x-api-key')`, `@UseGuards(ApiKeyGuard)`.

**Depende de:** Tarefa 5
**Testável:** `npm run start:dev` — endpoints visíveis no Swagger `/docs`

---

### Tarefa 7 — [Module] AdAccountsModule

**Arquivo:** `src/modules/ad-accounts/ad-accounts.module.ts`

**O que fazer:**
```typescript
@Module({
  imports: [TypeOrmModule.forFeature([AdAccountEntity]), CryptoModule],
  controllers: [AdAccountsController],
  providers: [AdAccountsService],
  exports: [AdAccountsService],       // CampaignReportsModule vai importar
})
export class AdAccountsModule {}
```

**Depende de:** Tarefas 5, 6
**Testável:** `npm run start:dev` sem erros de injeção (após Tarefa 17)

---

### Tarefa 8 — [Testes] AdAccountsService unit tests

**Arquivo:** `src/modules/ad-accounts/ad-accounts.service.spec.ts`

**O que fazer:**
Seguir exatamente o padrão de `integrations.service.spec.ts`:
- `mockRepo` com `create`, `save`, `find`, `findOne`, `softRemove`
- `mockCache` com `get`, `set`, `del`
- `mockCrypto` com `encrypt`/`decrypt`

Cenários obrigatórios:
- `create`: criptografa token, popula ambos os caches, lança `ConflictException` no 23505
- `findAll`: filtra por `clientId` e `isActive: true`
- `findOne`: cache hit (não chama repo), cache miss (popula cache), 404
- `findByAdAccountId`: cache hit, cache miss (popula ambas as chaves), 404
- `update`: criptografa se accessToken presente; não criptografa se ausente; invalida caches
- `remove`: soft remove, invalida ambos os caches

**Depende de:** Tarefa 5
**Testável:** `npx jest --testPathPattern=ad-accounts.service`

---

### Tarefa 9 — [Interfaces/Tipos] Meta API response types e interfaces de serviços

**Arquivos:**
- `src/modules/campaign-reports/interfaces/meta-campaign.interface.ts` ← novo
- `src/modules/campaign-reports/interfaces/meta-ads-service.interface.ts` ← novo
- `src/modules/campaign-reports/interfaces/campaign-reports-service.interface.ts` ← novo

**O que fazer:**
Definir todos os tipos da spec seções 8 e 10:
- `MetaCampaign`, `MetaInsights`, `MetaAction` (tipos da resposta da Meta)
- `MetaInsightsParams` com `datePreset: MetaDatePreset`, `level?: MetaInsightsLevel`, `fields: string`
- `IMetaAdsService` (3 métodos: fetchCampaigns, fetchInsights, fetchCampaignInsights)
- `ICampaignReportsService` (3 métodos: listCampaigns, getInsights, getCampaignInsights)

Os enums `MetaDatePreset` e `MetaInsightsLevel` serão definidos em `dto/get-insights-query.dto.ts` (Tarefa 10) e importados aqui.

**Depende de:** nada (paralelo com Tarefas 7–8)
**Testável:** `npm run build`

---

### Tarefa 10 — [DTO] GetInsightsQueryDto com enums

**Arquivo:** `src/modules/campaign-reports/dto/get-insights-query.dto.ts`

**O que fazer:**
```typescript
export enum MetaDatePreset { TODAY='today', YESTERDAY='yesterday', LAST_7D='last_7d',
  LAST_14D='last_14d', LAST_30D='last_30d', THIS_MONTH='this_month', LAST_MONTH='last_month' }

export enum MetaInsightsLevel { ACCOUNT='account', CAMPAIGN='campaign', ADSET='adset', AD='ad' }

export class GetInsightsQueryDto {
  @IsString() @IsNotEmpty()
  adAccountId: string;

  @IsEnum(MetaDatePreset) @IsOptional()
  datePreset?: MetaDatePreset = MetaDatePreset.LAST_30D;

  @IsEnum(MetaInsightsLevel) @IsOptional()
  level?: MetaInsightsLevel = MetaInsightsLevel.CAMPAIGN;
}
```

**Depende de:** nada
**Testável:** `npm run build`

---

### Tarefa 11 — [Service] MetaAdsService (cliente HTTP puro)

**Arquivo:** `src/modules/campaign-reports/meta-ads.service.ts`

**O que fazer:**
Service com `HttpService` (injetado) e `ConfigService`. Sem cache, sem DB.

```
baseUrl = `${config.get('meta.graphApiUrl')}/${config.get('meta-ads.apiVersion')}`
```

- `fetchCampaigns(adAccountId, accessToken)`:
  `GET {baseUrl}/{adAccountId}/campaigns?fields=id,name,status,objective,created_time&access_token={token}`
  Retorna `response.data.data` (array paginado da Meta, página 1 apenas nesta fase).

- `fetchInsights(adAccountId, accessToken, params)`:
  `GET {baseUrl}/{adAccountId}/insights?fields=...&date_preset={params.datePreset}&level={params.level}&access_token={token}`
  Fields fixos: `campaign_id,campaign_name,impressions,clicks,spend,reach,cpm,cpc,ctr,actions,cost_per_action_type,date_start,date_stop`

- `fetchCampaignInsights(campaignId, accessToken, params)`:
  `GET {baseUrl}/{campaignId}/insights?fields=...&date_preset={params.datePreset}&access_token={token}`

Tratamento de erro (igual ao `instagram-graph.service.ts`):
```typescript
.catch((err) => {
  if (err?.response?.data?.error?.code === 190) {
    throw new OAuthTokenExpiredException(adAccountId);
  }
  throw err;
})
```

**Depende de:** Tarefas 1, 2, 9, 10
**Testável:** Tarefa 15

---

### Tarefa 12 — [Service] CampaignReportsService

**Arquivo:** `src/modules/campaign-reports/campaign-reports.service.ts`

**O que fazer:**
Implementar `ICampaignReportsService`. Injeta: `AdAccountsService`, `MetaAdsService`, `AesCryptoService`, `Cache` (CACHE_MANAGER).

```typescript
// listCampaigns(adAccountId)
const cacheKey = `meta:campaigns:${adAccountId}`;
const cached = await cache.get<MetaCampaign[]>(cacheKey);
if (cached) return cached;

const account = await adAccountsService.findByAdAccountId(adAccountId);    // 404 se não existe
if (!account.isActive) throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);

const token = crypto.decrypt(account.accessToken);
const campaigns = await metaAdsService.fetchCampaigns(adAccountId, token);
await cache.set(cacheKey, campaigns, 300 * 1000);   // TTL em ms (CacheModule usa ms)
return campaigns;
```

Mesmo padrão para `getInsights` (chave: `meta:insights:${adAccountId}:${level}:${datePreset}`)
e `getCampaignInsights` (chave: `meta:insights:campaign:${campaignId}:${datePreset}`).

**Depende de:** Tarefas 7, 11
**Testável:** Tarefa 16

---

### Tarefa 13 — [Controller] CampaignReportsController

**Arquivo:** `src/modules/campaign-reports/campaign-reports.controller.ts`

**O que fazer:**
3 endpoints conforme spec seção 5:

```
GET /campaign-reports/campaigns?adAccountId=act_123
    @Query('adAccountId') adAccountId: string
    → service.listCampaigns(adAccountId)

GET /campaign-reports/insights?adAccountId=act_123&datePreset=last_30d&level=campaign
    @Query() query: GetInsightsQueryDto
    → service.getInsights(query.adAccountId, query)

GET /campaign-reports/insights/:campaignId?adAccountId=act_123&datePreset=last_7d
    @Param('campaignId') campaignId: string
    @Query('adAccountId') adAccountId: string
    @Query('datePreset') datePreset: MetaDatePreset
    → service.getCampaignInsights(campaignId, adAccountId, datePreset)
```

Decorators: `@ApiTags('campaign-reports')`, `@ApiSecurity('x-api-key')`, `@UseGuards(ApiKeyGuard)`.

**Depende de:** Tarefa 12
**Testável:** `npm run start:dev` — endpoints visíveis no Swagger

---

### Tarefa 14 — [Module] CampaignReportsModule

**Arquivo:** `src/modules/campaign-reports/campaign-reports.module.ts`

**O que fazer:**
```typescript
@Module({
  imports: [HttpModule, AdAccountsModule, CryptoModule],
  controllers: [CampaignReportsController],
  providers: [CampaignReportsService, MetaAdsService],
})
export class CampaignReportsModule {}
```

**Depende de:** Tarefas 7, 12, 13
**Testável:** `npm run start:dev` após Tarefa 17

---

### Tarefa 15 — [Testes] MetaAdsService unit tests

**Arquivo:** `src/modules/campaign-reports/meta-ads.service.spec.ts`

**O que fazer:**
Mock do `HttpService` (`{ get: jest.fn() }`) e `ConfigService`.

Cenários:
- `fetchCampaigns`: retorna `response.data.data` corretamente
- `fetchInsights`: passa `date_preset` e `level` nos params; retorna `response.data.data`
- `fetchCampaignInsights`: retorna primeiro elemento de `response.data.data`
- Todos os métodos: erro code 190 → lança `OAuthTokenExpiredException`
- Erro genérico: propaga sem transformar

**Depende de:** Tarefa 11
**Testável:** `npx jest --testPathPattern=meta-ads.service`

---

### Tarefa 16 — [Testes] CampaignReportsService unit tests

**Arquivo:** `src/modules/campaign-reports/campaign-reports.service.spec.ts`

**O que fazer:**
Mock do `AdAccountsService`, `MetaAdsService`, `AesCryptoService` e `Cache`.

Cenários:
- `listCampaigns`: cache hit → não chama `metaAdsService`
- `listCampaigns`: cache miss → chama `findByAdAccountId` → decrypt → `fetchCampaigns` → set cache
- `listCampaigns`: conta inativa → `UnprocessableEntityException`
- `listCampaigns`: conta não encontrada → propaga `NotFoundException` do `AdAccountsService`
- `getInsights`: cache hit; cache miss com chamada à Marketing API
- `getCampaignInsights`: cache hit; cache miss

**Depende de:** Tarefa 12
**Testável:** `npx jest --testPathPattern=campaign-reports.service`

---

### Tarefa 17 — [App] Registrar módulos e finalizar configuração

**Arquivos:**
- `src/app.module.ts` ← adicionar `AdAccountsModule`, `CampaignReportsModule`
- `.env.example` ← documentar `META_ADS_API_VERSION=v21.0`

**O que fazer:**
```typescript
import { AdAccountsModule } from './modules/ad-accounts/ad-accounts.module.js';
import { CampaignReportsModule } from './modules/campaign-reports/campaign-reports.module.js';

// no array imports:
AdAccountsModule,
CampaignReportsModule,
```

**Depende de:** Tarefas 7, 14
**Testável:** `npm run start:dev` — servidor sobe, Swagger mostra os novos endpoints, `npm run test` verde

---

## Grafo de Dependências

```
Tarefa 1 (Config) ──────────────────────────────┐
Tarefa 2 (Exception) ─────────────────────────┐ │
Tarefa 3 (Entity+Migration) ← T1              │ │
Tarefa 4 (Interface+DTOs) ← T3                │ │
Tarefa 5 (AdAccountsService) ← T3,T4          │ │
Tarefa 6 (AdAccountsController) ← T5          │ │
Tarefa 7 (AdAccountsModule) ← T5,T6 ──────────┼─┼──────────┐
Tarefa 8 (Tests AdAccountsService) ← T5       │ │          │
Tarefa 9 (Meta types/interfaces) ─────────────┼─┼──┐       │
Tarefa 10 (GetInsightsQueryDto) ───────────────┼─┼──┼──┐    │
Tarefa 11 (MetaAdsService) ← T1,T2,T9,T10 ────┘ │  │  │    │
Tarefa 12 (CampaignReportsService) ← T7,T11 ────┘  │  │    │
Tarefa 13 (CampaignReportsController) ← T12        │  │    │
Tarefa 14 (CampaignReportsModule) ← T7,T12,T13     │  │    │
Tarefa 15 (Tests MetaAdsService) ← T11             │  │    │
Tarefa 16 (Tests CampaignReportsService) ← T12     │  │    │
Tarefa 17 (App registration) ← T7,T14 ─────────────┘  └────┘
```

**Paralelizável:** T1 ∥ T2 ∥ T9 ∥ T10 (nenhuma depende da outra)
**Segundo batch paralelo:** T8 ∥ T15 ∥ T16 (após os respectivos services)

---

## Estimativa

| Tarefa | Complexidade | Estimativa |
|---|---|---|
| 1 — Config meta-ads | Baixa | 15 min |
| 2 — Extrair OAuthException | Baixa | 10 min |
| 3 — AdAccountEntity + migration | Baixa | 30 min |
| 4 — Interface + DTOs | Baixa | 25 min |
| 5 — AdAccountsService | Média | 45 min |
| 6 — AdAccountsController | Baixa | 20 min |
| 7 — AdAccountsModule | Baixa | 10 min |
| 8 — Testes AdAccountsService | Média | 45 min |
| 9 — Meta types / interfaces | Baixa | 20 min |
| 10 — GetInsightsQueryDto | Baixa | 15 min |
| 11 — MetaAdsService (HTTP) | Média | 50 min |
| 12 — CampaignReportsService | Alta | 50 min |
| 13 — CampaignReportsController | Baixa | 20 min |
| 14 — CampaignReportsModule | Baixa | 10 min |
| 15 — Testes MetaAdsService | Média | 35 min |
| 16 — Testes CampaignReportsService | Média | 40 min |
| 17 — App registration + .env.example | Baixa | 10 min |
| **Total** | | **~7h30min** |

---

## Riscos e Dependências Externas

### Alto impacto
- **Token de Usuário vs. Token de Página:** O cliente precisa fornecer um **User Access Token de longa duração** (60 dias) ou um **System User Token** com `ads_read` ao registrar o `AdAccount`. Tokens de Página (já existentes no módulo de integração) *não* têm permissão de leitura de insights de anúncios. Isso deve ser documentado no README e no Swagger.
- **Rate limit da Marketing API:** ~200 chamadas/hora por token de usuário (Tier 1). O TTL de 300s no cache cobre ~12 req/hora por adAccountId, o que é seguro. Se um cliente tiver muitas campanhas, a paginação (cursor `after`) precisará ser tratada — **fora do escopo desta fase**, retornamos apenas a primeira página.

### Médio impacto
- **Formato `act_{id}`:** A Meta exige exatamente `act_123456789` nas chamadas de API. A validação regex `/^act_\d+$/` no DTO garante isso, mas é bom testar com um ID real antes do go-live.
- **Paginação da Marketing API:** `fetchCampaigns` e `fetchInsights` retornam até 25 itens por padrão. Esta implementação retorna apenas a primeira página (`response.data.data`). Se um cliente tiver >25 campanhas, verá dados incompletos — tratar paginação é um risco conhecido aceito para esta fase.

### Baixo impacto
- **`@nestjs/axios` já instalado:** `WebhookModule` já usa `HttpModule`, nenhuma instalação adicional necessária.
- **`OAuthTokenExpiredException` move de local:** O refactor (Tarefa 2) quebra o import em `instagram-graph.service.ts` — mas é simples de corrigir e os testes existentes validam que não houve regressão.
- **Timestamp da migration:** Usar `1779944000000` (posterior ao último `1779922436820`) para garantir a ordem correta de execução.
