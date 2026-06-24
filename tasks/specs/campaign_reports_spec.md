# Spec: Campaign Reports (Meta Marketing API)

## 1. Objetivo

Permitir que a plataforma busque e exponha relatórios de campanhas de anúncios de cada cliente a partir da **Meta Marketing API** (`/insights`). O trafegante registra suas contas de anúncio (Ad Accounts) na plataforma e pode consultar métricas de performance (gasto, impressões, cliques, CPM, CPC, CTR etc.) por período e por campanha, sem precisar acessar o Gerenciador de Anúncios da Meta manualmente.

## 2. Contexto Multi-tenant

| Dado                         | Isolamento        |
|------------------------------|-------------------|
| `AdAccountEntity`            | Por `clientId`    |
| Tokens de acesso             | Por `clientId`, criptografados com AES-256-GCM (mesmo `AesCryptoService` existente) |
| Métricas / insights          | Por `clientId` + `adAccountId` — nunca expostos cross-tenant |
| Configuração da Meta API     | Global (URL, versão) — compartilhada via `ConfigService` |

> **Diferença crítica do token:** Módulos de mensagens (Instagram/WhatsApp) usam **Page Access Token**. O Marketing API exige **User Access Token de longa duração** ou **System User Token** com a permissão `ads_read`. São tokens distintos — este módulo gerencia seu próprio conjunto de credenciais.

## 3. Descrição Funcional

- Registrar uma conta de anúncio (`ad_account_id`) por cliente, com o respectivo User Token criptografado.
- Listar, atualizar (rotacionar token) e remover contas de anúncio.
- Buscar a lista de campanhas ativas de uma conta de anúncio via Marketing API.
- Buscar insights de uma conta ou de uma campanha específica para um período.
- Cachear resultados de campanhas e insights no Redis (dado que a Marketing API tem rate limit apertado).
- Propagar o erro `OAuthException` (code 190) como exceção tipada para facilitar rotação de token futura.

## 4. Estrutura de Arquivos

### Novos arquivos

```
src/modules/ad-accounts/
  ad-accounts.module.ts
  ad-accounts.controller.ts
  ad-accounts.service.ts
  ad-accounts.service.spec.ts
  dto/
    create-ad-account.dto.ts
    update-ad-account.dto.ts
  entities/
    ad-account.entity.ts
  interfaces/
    ad-accounts-service.interface.ts

src/modules/campaign-reports/
  campaign-reports.module.ts
  campaign-reports.controller.ts
  campaign-reports.service.ts
  campaign-reports.service.spec.ts
  meta-ads.service.ts              ← cliente HTTP para a Marketing API
  meta-ads.service.spec.ts
  dto/
    get-insights-query.dto.ts
  interfaces/
    campaign-reports-service.interface.ts
    meta-ads-service.interface.ts
    meta-campaign.interface.ts     ← tipos de resposta da Meta API

src/config/
  meta-ads.config.ts               ← META_ADS_API_VERSION (opcional, default v21.0)

src/database/migrations/
  [timestamp]-CreateAdAccountsTable.ts
```

### Arquivos modificados

- `src/app.module.ts` — importar `AdAccountsModule` e `CampaignReportsModule`
- `src/config/configuration.ts` — adicionar `metaAdsConfig` ao `configLoads` e ao `validationSchema`
- `.env.example` — documentar `META_ADS_API_VERSION`

## 5. Contrato de API

### Ad Accounts — Gerenciamento de credenciais

| Campo    | Valor                                              |
|----------|----------------------------------------------------|
| Método   | `POST`                                             |
| Path     | `/api/v1/ad-accounts`                              |
| Auth     | `x-api-key` (ApiKeyGuard)                          |
| Body     | `CreateAdAccountDto`                               |
| Resposta | `AdAccountEntity` (201) — `accessToken` excluído   |

| Campo    | Valor                                              |
|----------|----------------------------------------------------|
| Método   | `GET`                                              |
| Path     | `/api/v1/ad-accounts?clientId={uuid}`              |
| Auth     | `x-api-key`                                        |
| Resposta | `AdAccountEntity[]` (200)                          |

| Campo    | Valor                                              |
|----------|----------------------------------------------------|
| Método   | `GET`                                              |
| Path     | `/api/v1/ad-accounts/:id`                          |
| Auth     | `x-api-key`                                        |
| Resposta | `AdAccountEntity` (200)                            |

| Campo    | Valor                                              |
|----------|----------------------------------------------------|
| Método   | `PATCH`                                            |
| Path     | `/api/v1/ad-accounts/:id`                          |
| Auth     | `x-api-key`                                        |
| Body     | `UpdateAdAccountDto`                               |
| Resposta | `AdAccountEntity` (200)                            |

| Campo    | Valor                                              |
|----------|----------------------------------------------------|
| Método   | `DELETE`                                           |
| Path     | `/api/v1/ad-accounts/:id`                          |
| Auth     | `x-api-key`                                        |
| Resposta | `void` (204)                                       |

---

### Campaign Reports — Consulta de métricas

| Campo    | Valor                                                                                    |
|----------|------------------------------------------------------------------------------------------|
| Método   | `GET`                                                                                    |
| Path     | `/api/v1/campaign-reports/campaigns?adAccountId={id}`                                   |
| Auth     | `x-api-key`                                                                              |
| Query    | `adAccountId: string` (obrigatório)                                                      |
| Resposta | `MetaCampaign[]` (200) — lista de campanhas da conta                                     |
| Cache    | Redis por `adAccountId`, TTL 300s                                                        |

| Campo    | Valor                                                                                     |
|----------|-------------------------------------------------------------------------------------------|
| Método   | `GET`                                                                                     |
| Path     | `/api/v1/campaign-reports/insights?adAccountId={id}&datePreset=last_30d&level=account`   |
| Auth     | `x-api-key`                                                                               |
| Query    | `GetInsightsQueryDto`                                                                     |
| Resposta | `MetaInsights[]` (200)                                                                    |
| Cache    | Redis por `adAccountId:level:datePreset`, TTL 300s                                        |

| Campo    | Valor                                                                                     |
|----------|-------------------------------------------------------------------------------------------|
| Método   | `GET`                                                                                     |
| Path     | `/api/v1/campaign-reports/insights/:campaignId?adAccountId={id}&datePreset=last_30d`      |
| Auth     | `x-api-key`                                                                               |
| Query    | `adAccountId: string`, `datePreset: MetaDatePreset`                                       |
| Resposta | `MetaInsights` (200) — métricas de uma campanha específica                                |
| Cache    | Redis por `campaign:{campaignId}:datePreset`, TTL 300s                                    |

## 6. Entidades (PostgreSQL)

### `AdAccountEntity` — tabela `ad_accounts`

```typescript
@Entity('ad_accounts')
export class AdAccountEntity extends BaseEntity {
  @Column({ name: 'client_id' })
  clientId: string;                         // FK → clients.id

  @ManyToOne(() => ClientEntity)
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ name: 'ad_account_id', unique: true })
  adAccountId: string;                      // ex: "act_123456789"

  @Column({ name: 'account_name', nullable: true })
  accountName: string | null;               // label legível (opcional)

  @Exclude()
  @Column({ name: 'access_token', type: 'text' })
  accessToken: string;                      // User Token — AES-256-GCM

  @Column({ name: 'token_expires_at', type: 'timestamptz', nullable: true })
  tokenExpiresAt: Date | null;

  @Column({ default: true })
  isActive: boolean;
}
```

> Sem entidade de métricas nesta fase — os insights são buscados on-demand e cacheados no Redis. Persistência de histórico é escopo futuro.

## 7. Cache (Redis)

| O que cachear             | Chave                                              | TTL    | Quando invalidar             |
|---------------------------|----------------------------------------------------|--------|------------------------------|
| Credencial por ID         | `ad-account:id:{id}`                               | 3600s  | Update / Delete              |
| Credencial por adAccountId| `ad-account:act:{adAccountId}`                     | 3600s  | Update / Delete              |
| Lista de campanhas        | `meta:campaigns:{adAccountId}`                     | 300s   | Não invalidar (TTL curto)    |
| Insights conta/campanha   | `meta:insights:{adAccountId}:{level}:{datePreset}` | 300s   | Não invalidar (TTL curto)    |
| Insights por campaignId   | `meta:insights:campaign:{campaignId}:{datePreset}` | 300s   | Não invalidar (TTL curto)    |

TTL de 300s para insights é conservador dado que a Marketing API tem quota de ~200 chamadas/hora por token.

## 8. Interfaces dos Services

```typescript
// IAdAccountsService
interface IAdAccountsService {
  create(dto: CreateAdAccountDto): Promise<AdAccountEntity>;
  findAll(clientId: string): Promise<AdAccountEntity[]>;
  findOne(id: string): Promise<AdAccountEntity>;
  findByAdAccountId(adAccountId: string): Promise<AdAccountEntity>;
  update(id: string, dto: UpdateAdAccountDto): Promise<AdAccountEntity>;
  remove(id: string): Promise<void>;
}

// ICampaignReportsService
interface ICampaignReportsService {
  listCampaigns(adAccountId: string): Promise<MetaCampaign[]>;
  getInsights(adAccountId: string, query: GetInsightsQueryDto): Promise<MetaInsights[]>;
  getCampaignInsights(campaignId: string, adAccountId: string, datePreset: MetaDatePreset): Promise<MetaInsights>;
}

// IMetaAdsService — cliente HTTP puro (sem cache, sem DB)
interface IMetaAdsService {
  fetchCampaigns(adAccountId: string, accessToken: string): Promise<MetaCampaign[]>;
  fetchInsights(adAccountId: string, accessToken: string, params: MetaInsightsParams): Promise<MetaInsights[]>;
  fetchCampaignInsights(campaignId: string, accessToken: string, params: MetaInsightsParams): Promise<MetaInsights>;
}
```

## 9. DTOs e Validações

```typescript
// CreateAdAccountDto
class CreateAdAccountDto {
  @IsUUID()
  clientId: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^act_\d+$/, { message: 'adAccountId must follow the format act_{numeric_id}' })
  adAccountId: string;                      // "act_123456789"

  @IsString()
  @IsNotEmpty()
  accessToken: string;                      // User Token de longa duração (plaintext na entrada)

  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsDateString()
  tokenExpiresAt?: string;
}

// UpdateAdAccountDto
class UpdateAdAccountDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  accessToken?: string;

  @IsOptional()
  @IsDateString()
  tokenExpiresAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  accountName?: string;
}

// GetInsightsQueryDto
enum MetaDatePreset {
  TODAY = 'today',
  YESTERDAY = 'yesterday',
  LAST_7D = 'last_7d',
  LAST_14D = 'last_14d',
  LAST_30D = 'last_30d',
  THIS_MONTH = 'this_month',
  LAST_MONTH = 'last_month',
}

enum MetaInsightsLevel {
  ACCOUNT = 'account',
  CAMPAIGN = 'campaign',
  ADSET = 'adset',
  AD = 'ad',
}

class GetInsightsQueryDto {
  @IsString()
  @IsNotEmpty()
  adAccountId: string;

  @IsEnum(MetaDatePreset)
  @IsOptional()
  datePreset?: MetaDatePreset = MetaDatePreset.LAST_30D;

  @IsEnum(MetaInsightsLevel)
  @IsOptional()
  level?: MetaInsightsLevel = MetaInsightsLevel.CAMPAIGN;
}
```

### Campos de insights retornados da Meta

Os seguintes campos serão solicitados na query `?fields=`:

```
campaign_id, campaign_name, impressions, clicks, spend, reach,
cpm, cpc, ctr, actions, cost_per_action_type, date_start, date_stop
```

## 10. Tipos da Meta API

```typescript
interface MetaCampaign {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';
  objective: string;
  created_time: string;
}

interface MetaInsights {
  campaign_id?: string;
  campaign_name?: string;
  impressions: string;          // Meta retorna strings
  clicks: string;
  spend: string;
  reach: string;
  cpm: string;
  cpc: string;
  ctr: string;
  actions?: MetaAction[];
  date_start: string;
  date_stop: string;
}

interface MetaAction {
  action_type: string;
  value: string;
}
```

## 11. Variáveis de Ambiente

| Variável               | Obrigatório | Default   | Descrição                                      |
|------------------------|-------------|-----------|------------------------------------------------|
| `META_ADS_API_VERSION` | Não         | `v21.0`   | Versão da Marketing API (reutiliza mesmo base URL do Graph API) |

As demais variáveis já existentes (`META_GRAPH_API_URL`, `ENCRYPTION_KEY`, etc.) são reutilizadas.

## 12. Critérios de Aceitação (BDD)

```gherkin
Feature: Ad Accounts — Gerenciamento de credenciais

  Scenario: Registrar uma conta de anúncio com sucesso
    Given um clientId válido e um User Token de longa duração
    When POST /api/v1/ad-accounts com { clientId, adAccountId: "act_123", accessToken }
    Then retorna 201 com AdAccountEntity
    And o accessToken NÃO aparece no response
    And a credencial está cacheada no Redis em "ad-account:act:act_123"

  Scenario: adAccountId duplicado
    Given já existe uma conta "act_123" registrada
    When POST /api/v1/ad-accounts com o mesmo adAccountId
    Then retorna 409 Conflict com mensagem descritiva

  Scenario: adAccountId com formato inválido
    When POST /api/v1/ad-accounts com adAccountId: "123456" (sem prefixo act_)
    Then retorna 400 com detalhe do campo adAccountId

  Scenario: Rotacionar token de uma conta de anúncio
    Given uma AdAccountEntity existente com id {uuid}
    When PATCH /api/v1/ad-accounts/{uuid} com { accessToken: "novo-token" }
    Then retorna 200 com a entidade atualizada
    And o cache "ad-account:id:{uuid}" e "ad-account:act:{adAccountId}" são invalidados

Feature: Campaign Reports — Consulta de campanhas e métricas

  Scenario: Listar campanhas de uma conta de anúncio
    Given uma AdAccountEntity ativa com adAccountId "act_123"
    When GET /api/v1/campaign-reports/campaigns?adAccountId=act_123
    Then retorna 200 com array de MetaCampaign
    And o resultado é cacheado em "meta:campaigns:act_123" por 300s

  Scenario: Cache hit na listagem de campanhas
    Given o cache "meta:campaigns:act_123" está populado
    When GET /api/v1/campaign-reports/campaigns?adAccountId=act_123
    Then retorna 200 sem chamar a Marketing API

  Scenario: Buscar insights de conta no último mês
    Given uma AdAccountEntity ativa com adAccountId "act_123"
    When GET /api/v1/campaign-reports/insights?adAccountId=act_123&datePreset=last_30d&level=campaign
    Then retorna 200 com array de MetaInsights com campos spend, impressions, clicks, cpm, cpc, ctr

  Scenario: Buscar insights de campanha específica
    Given campaignId "987654321" pertence à conta "act_123"
    When GET /api/v1/campaign-reports/insights/987654321?adAccountId=act_123&datePreset=last_7d
    Then retorna 200 com MetaInsights da campanha

  Scenario: Token expirado (code 190)
    Given o accessToken da conta "act_123" está expirado
    When GET /api/v1/campaign-reports/campaigns?adAccountId=act_123
    Then a Meta API retorna OAuthException code 190
    And o service lança OAuthTokenExpiredException
    And retorna 401 com mensagem "Access token expired for adAccountId act_123"

  Scenario: Conta de anúncio não encontrada
    When GET /api/v1/campaign-reports/campaigns?adAccountId=act_inexistente
    Then retorna 404 Not Found

  Scenario: Conta de anúncio inativa
    Given uma AdAccountEntity com isActive: false
    When GET /api/v1/campaign-reports/campaigns?adAccountId=act_123
    Then retorna 422 Unprocessable Entity com mensagem "Ad account act_123 is inactive"

  Scenario: Requisição sem API Key
    When qualquer endpoint é chamado sem o header x-api-key
    Then retorna 401 Unauthorized
```

## 13. Definition of Done

- [ ] `AdAccountsModule` registrado em `app.module.ts`
- [ ] `CampaignReportsModule` registrado em `app.module.ts`
- [ ] `AdAccountsController` com todos os 5 endpoints protegidos por `ApiKeyGuard`
- [ ] `AdAccountsService` implementando `IAdAccountsService` com cache Redis
- [ ] `AdAccountEntity` com `@Exclude()` no `accessToken`, estendendo `BaseEntity`
- [ ] Migration criada para tabela `ad_accounts`
- [ ] `MetaAdsService` (HttpModule) com métodos `fetchCampaigns` e `fetchInsights`
- [ ] `CampaignReportsService` com cache Redis (TTL 300s) para campanhas e insights
- [ ] `CampaignReportsController` com 3 endpoints (`/campaigns`, `/insights`, `/insights/:campaignId`)
- [ ] `OAuthTokenExpiredException` reutilizável (ou extraída do módulo webhook)
- [ ] `meta-ads.config.ts` + entrada no `validationSchema` + `.env.example` atualizado
- [ ] `GetInsightsQueryDto` com enum `MetaDatePreset` e `MetaInsightsLevel`
- [ ] `adAccountId` validado com regex `/^act_\d+$/`
- [ ] Testes unitários do `AdAccountsService` (mock do repository + cache)
- [ ] Testes unitários do `CampaignReportsService` (mock do `MetaAdsService` + cache)
- [ ] Testes unitários do `MetaAdsService` (mock do `HttpService`)

## 14. Ordem de Implementação

1. `meta-ads.config.ts` + atualizar `configuration.ts` e `.env.example`
2. `AdAccountEntity` + migration
3. `AdAccountsModule` (module → entity → dto → service → controller → testes)
4. Extrair / reutilizar `OAuthTokenExpiredException` em `src/common/exceptions/`
5. `MetaAdsService` (cliente HTTP puro — sem cache, sem DB)
6. `CampaignReportsModule` (service com cache → controller → testes)
7. Registrar ambos os módulos em `app.module.ts`

## 15. Módulos Futuros (fora de escopo desta spec)

- Persistência de snapshots de métricas para histórico (tabela `campaign_metrics`)
- Agendamento automático via cron para atualização periódica dos insights
- Webhook de alteração de status de campanha (Marketing API subscriptions)
- Breakdown por idade, gênero, plataforma (`/insights?breakdowns=age,gender`)
- Exportação de relatório em CSV/PDF
