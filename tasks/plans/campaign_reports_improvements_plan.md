# Plano de Implementação: Campaign Reports — Melhorias e Dívidas Técnicas

**Spec:** `tasks/specs/campaign_reports_improvements_spec.md`
**Data:** 2026-06-16

---

## Análise de Alternativas

### Paginação: como expor os cursores ao caller

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| **A (Escolhida)** | Exposição cursor-based: controller aceita `?cursor=` e retorna `{ data, paging: { next? } }` | Stateless, simples, sem estado no servidor, retrocompatível quando cursor ausente | Caller precisa iterar manualmente |
| B | Auto-fetch all pages internamente no service | UX transparente | Timeout em contas grandes; sem controle de rate limit; não testável unitariamente |
| C | Offset/limit tradicional | Familiar | Meta API não suporta offset — teria que re-buscar todas as páginas anteriores |

**Decisão:** Alternativa A — espelha o contrato nativo da Meta API, é a única implementação segura para rate limit, e permite que o front-end implemente "Load more" sem lógica de servidor.

### Cron job: onde reside o monitor de tokens

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| **A (Escolhida)** | `AdAccountsTokenMonitorService` dentro do módulo `ad-accounts`, injeta `AdAccountsService` | Coesão; reutiliza `findAllExpiring`; module boundary claro | Módulo fica um pouco mais complexo |
| B | Cron no próprio `AdAccountsService` com `@Cron` | Menos arquivos | Mistura responsabilidade de I/O (repo) com agendamento; dificulta testes |

**Decisão:** Alternativa A — separação de responsabilidades; o service permanece testável em isolamento.

---

## Recursos Reutilizáveis Identificados

| Recurso | Localização | Uso |
|---|---|---|
| `ApiKeyGuard` | `src/common/guards/api-key.guard.ts` | Novo endpoint `/expiring` |
| `ParseUUIDPipe` | NestJS built-in | Validar `clientId` no endpoint `/expiring` |
| `mockRepo`, `mockCache`, `mockCrypto` | Padrão estabelecido em `*.service.spec.ts` | Adicionar `mockRepo.createQueryBuilder` para `findExpiring` |
| `makeAxiosResponse` helper | `meta-ads.service.spec.ts:42` | Reutilizar nos novos cenários de paginação |
| `MetaApiPaginatedResponse<T>` | `meta-campaign.interface.ts` | Já existe; `paging.next` já está tipado — nenhum change necessário no tipo |

---

## Diagrama de Fluxo

### Paginação — GET /campaign-reports/campaigns?cursor=abc

```
GET /campaign-reports/campaigns?adAccountId=act_123&cursor=cursor_abc
    ↓ ApiKeyGuard
CampaignReportsController.listCampaigns(adAccountId, cursor?)
CampaignReportsService.listCampaigns(adAccountId, cursor?)
    ↓ cacheKey = cursor
    │   ? "meta:campaigns:act_123:cursor:cursor_abc"
    │   : "meta:campaigns:act_123"
    ↓ Cache.get(cacheKey)
        → HIT: retorna PaginatedResult<MetaCampaign>
        → MISS:
            ↓ AdAccountsService.findByAdAccountId → AdAccountEntity
            ↓ AesCryptoService.decrypt(token)
            ↓ MetaAdsService.fetchCampaigns(adAccountId, token, cursor?)
                ↓ GET /act_123/campaigns?after=cursor_abc
                ← { data: [...], paging: { next?: "cursor_xyz" } }
            ↓ Cache.set(cacheKey, { data, paging }, TTL_MS)
← { data: MetaCampaign[], paging: { next?: string } } (200)
```

### Token Monitor — Cron diário

```
@Cron('0 8 * * *') — 08:00 America/Sao_Paulo
AdAccountsTokenMonitorService.checkExpiringTokens()
    ↓ AdAccountsService.findAllExpiring(daysAhead=7)
        ↓ Repository.find({ where: {
              isActive: true,
              tokenExpiresAt: LessThanOrEqual(now + 7d),
              [Not null check via TypeORM]
          }})
    ↓ forEach(account)
        Logger.warn(`[TOKEN_EXPIRING] adAccountId=${account.adAccountId} ...`)
← void (sem side effects no banco)
```

---

## Tarefas Sequenciais

### Tarefa 1 — [Config] TTL configurável via env

**Arquivos:**
- `src/config/meta-ads.config.ts` ← adicionar `insightsCacheTtlSeconds`
- `src/config/configuration.ts` ← adicionar `INSIGHTS_CACHE_TTL_SECONDS` ao schema Joi
- `.env.example` ← documentar a nova variável

**O que fazer:**

Em `meta-ads.config.ts`, adicionar o campo:
```typescript
insightsCacheTtlSeconds: parseInt(process.env.INSIGHTS_CACHE_TTL_SECONDS ?? '300', 10),
```

Em `configuration.ts`, adicionar ao `validationSchema`:
```typescript
INSIGHTS_CACHE_TTL_SECONDS: Joi.number().min(30).max(3600).default(300),
```

Em `.env.example`, adicionar abaixo de `META_ADS_API_VERSION`:
```
INSIGHTS_CACHE_TTL_SECONDS=300
```

**Depende de:** nada
**Testável:** `npm run build`

---

### Tarefa 2 — [Service] CampaignReportsService: TTL via ConfigService

**Arquivo:** `src/modules/campaign-reports/campaign-reports.service.ts`

**O que fazer:**
- Remover `const INSIGHTS_TTL_MS = 300 * 1000`
- Injetar `ConfigService` no construtor
- Adicionar getter privado `get insightsTtlMs(): number` que retorna `this.config.get<number>('meta-ads.insightsCacheTtlSeconds')! * 1000`
- Substituir todas as ocorrências de `INSIGHTS_TTL_MS` por `this.insightsTtlMs`

```typescript
constructor(
  private readonly adAccountsService: AdAccountsService,
  private readonly metaAdsService: MetaAdsService,
  private readonly crypto: AesCryptoService,
  private readonly config: ConfigService,
  @Inject(CACHE_MANAGER) private readonly cache: Cache,
) {}

private get insightsTtlMs(): number {
  return this.config.get<number>('meta-ads.insightsCacheTtlSeconds')! * 1000;
}
```

**Depende de:** Tarefa 1
**Testável:** `npm run build`; testes atualizados na Tarefa 16

---

### Tarefa 3 — [Interfaces] PaginatedResult + IMetaAdsService atualizado

**Arquivos:**
- `src/modules/campaign-reports/interfaces/meta-campaign.interface.ts` ← adicionar `PaginatedResult<T>`
- `src/modules/campaign-reports/interfaces/meta-ads-service.interface.ts` ← atualizar assinaturas

**O que fazer:**

Em `meta-campaign.interface.ts`, adicionar ao final:
```typescript
export interface PaginatedResult<T> {
  data: T[];
  paging: { next?: string };
}
```

Em `meta-ads-service.interface.ts`, atualizar os dois métodos:
```typescript
fetchCampaigns(adAccountId: string, accessToken: string, cursor?: string): Promise<MetaApiPaginatedResponse<MetaCampaign>>;
fetchInsights(adAccountId: string, accessToken: string, params: MetaInsightsParams, cursor?: string): Promise<MetaApiPaginatedResponse<MetaInsights>>;
// fetchCampaignInsights não muda
```

**Depende de:** nada (paralelo com Tarefas 1–2)
**Testável:** `npm run build`

---

### Tarefa 4 — [Service] MetaAdsService: cursor + retorno completo

**Arquivo:** `src/modules/campaign-reports/meta-ads.service.ts`

**O que fazer:**

`fetchCampaigns` e `fetchInsights` passam a:
1. Aceitar `cursor?: string` como último parâmetro
2. Incluir `after: cursor` nos `params` quando o cursor for fornecido
3. Retornar `response.data` completo (`MetaApiPaginatedResponse<T>`) em vez de só `response.data.data`

```typescript
async fetchCampaigns(adAccountId: string, accessToken: string, cursor?: string): Promise<MetaApiPaginatedResponse<MetaCampaign>> {
  const url = `${this.baseUrl}/${adAccountId}/campaigns`;
  const response = await firstValueFrom(
    this.httpService.get<MetaApiPaginatedResponse<MetaCampaign>>(url, {
      params: {
        fields: 'id,name,status,objective,created_time',
        access_token: accessToken,
        ...(cursor && { after: cursor }),
      },
    }),
  ).catch((err: MetaErrorResponse) => this.handleError(err, adAccountId));
  return response.data;
}
```

Mesmo padrão para `fetchInsights`.

`fetchCampaignInsights` **não muda** — continua retornando `MetaInsights` diretamente.

**Depende de:** Tarefa 3
**Testável:** Tarefa 15

---

### Tarefa 5 — [DTO] GetInsightsQueryDto: adicionar cursor

**Arquivo:** `src/modules/campaign-reports/dto/get-insights-query.dto.ts`

**O que fazer:**
Adicionar ao final da classe `GetInsightsQueryDto`:
```typescript
@ApiPropertyOptional({ description: 'Cursor de paginação retornado em paging.next' })
@IsOptional()
@IsString()
cursor?: string;
```

**Depende de:** nada
**Testável:** `npm run build`

---

### Tarefa 6 — [Service] CampaignReportsService: paginação + cursor na cache key

**Arquivo:** `src/modules/campaign-reports/campaign-reports.service.ts`

**O que fazer:**

Atualizar `listCampaigns` e `getInsights` para:
1. Aceitar `cursor?: string`
2. Construir cache key incluindo cursor quando presente:
   ```typescript
   const cacheKey = cursor
     ? `meta:campaigns:${adAccountId}:cursor:${cursor}`
     : `meta:campaigns:${adAccountId}`;
   ```
3. Passar cursor para `MetaAdsService`
4. Retornar `PaginatedResult<T>` extraindo `data` e `paging` do `MetaApiPaginatedResponse`:
   ```typescript
   const result = await this.metaAdsService.fetchCampaigns(adAccountId, token, cursor);
   const paginated: PaginatedResult<MetaCampaign> = {
     data: result.data,
     paging: { next: result.paging?.cursors?.after ?? result.paging?.next },
   };
   await this.cache.set(cacheKey, paginated, this.insightsTtlMs);
   return paginated;
   ```

> **Nota sobre `paging.next`:** A Meta pode retornar o cursor dentro de `paging.cursors.after` ou diretamente em `paging.next`. Normalizar para um único campo `next` no `PaginatedResult`.

Atualizar `ICampaignReportsService` com as novas assinaturas:
```typescript
listCampaigns(adAccountId: string, cursor?: string): Promise<PaginatedResult<MetaCampaign>>;
getInsights(adAccountId: string, query: GetInsightsQueryDto): Promise<PaginatedResult<MetaInsights>>;
// getCampaignInsights não muda
```

**Depende de:** Tarefas 2, 4, 5
**Testável:** Tarefa 16

---

### Tarefa 7 — [Controller] CampaignReportsController: expor cursor

**Arquivo:** `src/modules/campaign-reports/campaign-reports.controller.ts`

**O que fazer:**

`listCampaigns`: adicionar `@Query('cursor') cursor?: string` e passar para o service.

`getInsights`: o cursor já vem em `GetInsightsQueryDto` (Tarefa 5); controller apenas passa o DTO completo.

```typescript
@Get('campaigns')
listCampaigns(
  @Query('adAccountId') adAccountId: string,
  @Query('cursor') cursor?: string,
) {
  return this.campaignReportsService.listCampaigns(adAccountId, cursor);
}

@Get('insights')
getInsights(@Query() query: GetInsightsQueryDto) {
  return this.campaignReportsService.getInsights(query.adAccountId, query);
}
```

Adicionar `@ApiQuery({ name: 'cursor', required: false })` nos decorators Swagger dos dois endpoints.

**Depende de:** Tarefa 6
**Testável:** `npm run start:dev` — Swagger mostra `cursor` como parâmetro opcional

---

### Tarefa 8 — [Deps] Instalar @nestjs/schedule

**O que fazer:**
```bash
npm install @nestjs/schedule
```

Verificar que `@types/cron` não é necessário separadamente (já incluído em `@nestjs/schedule`).

**Depende de:** nada (paralelo com demais tarefas)
**Testável:** `npm run build`

---

### Tarefa 9 — [Service] AdAccountsService: findExpiring + findAllExpiring

**Arquivos:**
- `src/modules/ad-accounts/ad-accounts.service.ts`
- `src/modules/ad-accounts/interfaces/ad-accounts-service.interface.ts`

**O que fazer:**

Adicionar à interface:
```typescript
findExpiring(clientId: string, daysAhead: number): Promise<AdAccountEntity[]>;
findAllExpiring(daysAhead: number): Promise<AdAccountEntity[]>;
```

Implementar usando TypeORM `LessThanOrEqual` e `Not(IsNull())`:
```typescript
import { LessThanOrEqual, Not, IsNull } from 'typeorm';

findExpiring(clientId: string, daysAhead: number): Promise<AdAccountEntity[]> {
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + daysAhead);
  return this.repo.find({
    where: {
      clientId,
      isActive: true,
      tokenExpiresAt: LessThanOrEqual(deadline),
    },
  });
}

findAllExpiring(daysAhead: number): Promise<AdAccountEntity[]> {
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + daysAhead);
  return this.repo.find({
    where: {
      isActive: true,
      tokenExpiresAt: LessThanOrEqual(deadline),
    },
  });
}
```

> **Nota:** TypeORM `find` com `LessThanOrEqual` em coluna nullable automaticamente exclui registros onde `tokenExpiresAt IS NULL` (comportamento padrão do SQL: NULL não satisfaz `<= deadline`). Não é necessário `Not(IsNull())`.

**Depende de:** Tarefa 8 (para garantir ambiente estável antes de testar)
**Testável:** Tarefa 17

---

### Tarefa 10 — [DTO] GetExpiringQueryDto

**Arquivo:** `src/modules/ad-accounts/dto/get-expiring-query.dto.ts` ← novo

**O que fazer:**
```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetExpiringQueryDto {
  @ApiProperty({ example: 'uuid-do-client' })
  @IsUUID()
  clientId: string;

  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  daysAhead?: number = 7;
}
```

> `@Type(() => Number)` é necessário porque query params chegam como string — o `ValidationPipe({ transform: true })` global faz a coerção, mas `@Type` garante que o `@IsInt()` funcione corretamente.

**Depende de:** nada
**Testável:** `npm run build`

---

### Tarefa 11 — [Controller] AdAccountsController: endpoint /expiring

**Arquivo:** `src/modules/ad-accounts/ad-accounts.controller.ts`

**O que fazer:**
Adicionar o método **antes** do `@Get(':id')` existente:

```typescript
@Get('expiring')
@ApiOperation({ summary: 'List ad accounts with tokens expiring soon' })
findExpiring(@Query() query: GetExpiringQueryDto) {
  return this.adAccountsService.findExpiring(query.clientId, query.daysAhead ?? 7);
}
```

A posição importa: NestJS resolve rotas na ordem de declaração. `'expiring'` deve ser declarado antes de `':id'`, caso contrário o NestJS tentará parsear a string `"expiring"` como UUID e falhará com 400.

**Depende de:** Tarefas 9, 10
**Testável:** `npm run start:dev` — `GET /api/v1/ad-accounts/expiring?clientId=uuid` responde 200

---

### Tarefa 12 — [Service] AdAccountsTokenMonitorService (cron job)

**Arquivo:** `src/modules/ad-accounts/ad-accounts-token-monitor.service.ts` ← novo

**O que fazer:**
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdAccountsService } from './ad-accounts.service.js';

@Injectable()
export class AdAccountsTokenMonitorService {
  private readonly logger = new Logger(AdAccountsTokenMonitorService.name);
  private readonly DAYS_AHEAD = 7;

  constructor(private readonly adAccountsService: AdAccountsService) {}

  @Cron('0 8 * * *', { timeZone: 'America/Sao_Paulo' })
  async checkExpiringTokens(): Promise<void> {
    const expiring = await this.adAccountsService.findAllExpiring(this.DAYS_AHEAD);
    for (const account of expiring) {
      const daysLeft = Math.ceil(
        (account.tokenExpiresAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      this.logger.warn(
        `[TOKEN_EXPIRING] adAccountId=${account.adAccountId} clientId=${account.clientId} expiresIn=${daysLeft}d`,
      );
    }
  }
}
```

**Depende de:** Tarefa 9
**Testável:** Tarefa 18

---

### Tarefa 13 — [Module] AdAccountsModule: registrar ScheduleModule + TokenMonitorService

**Arquivo:** `src/modules/ad-accounts/ad-accounts.module.ts`

**O que fazer:**
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { CryptoModule } from '../../common/crypto/crypto.module.js';
import { AdAccountEntity } from './entities/ad-account.entity.js';
import { AdAccountsController } from './ad-accounts.controller.js';
import { AdAccountsService } from './ad-accounts.service.js';
import { AdAccountsTokenMonitorService } from './ad-accounts-token-monitor.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([AdAccountEntity]), CryptoModule, ScheduleModule],
  controllers: [AdAccountsController],
  providers: [AdAccountsService, AdAccountsTokenMonitorService],
  exports: [AdAccountsService],
})
export class AdAccountsModule {}
```

**Depende de:** Tarefas 11, 12
**Testável:** `npm run start:dev` sem erros de injeção (após Tarefa 14)

---

### Tarefa 14 — [App] Registrar ScheduleModule.forRoot() em AppModule

**Arquivo:** `src/app.module.ts`

**O que fazer:**
Adicionar import:
```typescript
import { ScheduleModule } from '@nestjs/schedule';
```
Adicionar ao array `imports` antes dos módulos de feature:
```typescript
ScheduleModule.forRoot(),
```

**Depende de:** Tarefas 8, 13
**Testável:** `npm run start:dev` — servidor sobe sem erro; cron registrado no log de bootstrap

---

### Tarefa 15 — [Testes] MetaAdsService: cenários de paginação

**Arquivo:** `src/modules/campaign-reports/meta-ads.service.spec.ts`

**O que fazer:**
Atualizar mocks e cenários existentes para a nova assinatura (retorna `MetaApiPaginatedResponse<T>` completo).

Adicionar novos cenários em `fetchCampaigns`:
- **sem cursor**: `params` não contém `after`; retorna `{ data: mockCampaigns, paging: {} }`
- **com cursor**: `params` contém `after: 'cursor_abc'`; retorna `{ data: [...], paging: { next: 'cursor_xyz' } }`
- **última página**: Meta retorna `{ data: [...], paging: {} }` — `paging.next` ausente

Adicionar mesmos cenários em `fetchInsights`.

**Depende de:** Tarefa 4
**Testável:** `npx jest --testPathPattern=meta-ads.service`

---

### Tarefa 16 — [Testes] CampaignReportsService: cache key com cursor + TTL via config

**Arquivo:** `src/modules/campaign-reports/campaign-reports.service.spec.ts`

**O que fazer:**

1. Atualizar `mockConfigService` para responder `'meta-ads.insightsCacheTtlSeconds'` com `300`
2. Adicionar `ConfigService` ao `providers` do `TestingModule`
3. Remover cenários que verificam `INSIGHTS_TTL_MS` hardcoded e substituir por verificação do TTL configurável
4. Adicionar cenários:
   - `listCampaigns` com cursor: cache key `meta:campaigns:act_123:cursor:cursor_abc`
   - `listCampaigns` sem cursor: cache key `meta:campaigns:act_123` (retrocompatível)
   - Resposta retorna `{ data: [...], paging: { next? } }` em vez de array simples

**Depende de:** Tarefa 6
**Testável:** `npx jest --testPathPattern=campaign-reports.service`

---

### Tarefa 17 — [Testes] AdAccountsService: findExpiring + findAllExpiring

**Arquivo:** `src/modules/ad-accounts/ad-accounts.service.spec.ts`

**O que fazer:**
Adicionar `mockRepo.find` com os novos cenários num novo `describe('findExpiring')`:
- Retorna somente contas dentro do intervalo (mock retorna array com 1 conta)
- `findAll` e `findExpiring` passam queries diferentes ao repo

Adicionar `describe('findAllExpiring')`:
- Chama `repo.find` sem `clientId` no where
- Tokens com `tokenExpiresAt = null` não aparecem (TypeORM exclui automaticamente NULLs em comparação)

**Depende de:** Tarefa 9
**Testável:** `npx jest --testPathPattern=ad-accounts.service`

---

### Tarefa 18 — [Testes] AdAccountsTokenMonitorService

**Arquivo:** `src/modules/ad-accounts/ad-accounts-token-monitor.service.spec.ts` ← novo

**O que fazer:**
```typescript
describe('AdAccountsTokenMonitorService', () => {
  let service: AdAccountsTokenMonitorService;
  const mockAdAccountsService = { findAllExpiring: jest.fn() };

  // Cenários:
  // 1. checkExpiringTokens com contas expirando → Logger.warn chamado N vezes
  // 2. checkExpiringTokens sem contas expirando → Logger.warn não chamado
  // 3. Formato do log: contém adAccountId, clientId, expiresIn
})
```

Para testar `Logger.warn`, usar `jest.spyOn(Logger.prototype, 'warn')`.

**Depende de:** Tarefa 12
**Testável:** `npx jest --testPathPattern=ad-accounts-token-monitor`

---

## Grafo de Dependências

```
T1 (Config TTL) ──────────────────┐
T2 (Service TTL) ← T1             │
T3 (Interfaces/PaginatedResult) ──┼──────────────────────────┐
T4 (MetaAdsService cursor) ← T3   │                          │
T5 (QueryDto cursor) ─────────────┼──────┐                   │
T6 (CampaignReportsService) ← T2,T4,T5  │                   │
T7 (Controller cursor) ← T6       │      │                   │
T8 (install @nestjs/schedule) ────┼──────┼──────────┐        │
T9 (AdAccountsService findExpiring) ← T8 │          │        │
T10 (GetExpiringQueryDto) ─────────┼──────┼──┐      │        │
T11 (Controller /expiring) ← T9,T10      │  │      │        │
T12 (TokenMonitorService) ← T9    │      │  │      │        │
T13 (AdAccountsModule) ← T11,T12  │      │  │      │        │
T14 (AppModule) ← T8,T13          │      │  │      │        │
T15 (Tests MetaAdsService) ← T4   └──────┘  └──────┘        │
T16 (Tests CampaignReports) ← T6                             │
T17 (Tests AdAccountsService) ← T9                          │
T18 (Tests TokenMonitor) ← T12 ──────────────────────────────┘
```

**Paralelizável inicialmente:** T1 ∥ T3 ∥ T5 ∥ T8 ∥ T10

---

## Estimativa

| Tarefa | Complexidade | Estimativa |
|---|---|---|
| 1 — Config TTL | Baixa | 15 min |
| 2 — Service TTL via ConfigService | Baixa | 20 min |
| 3 — Interfaces / PaginatedResult | Baixa | 15 min |
| 4 — MetaAdsService cursor | Média | 30 min |
| 5 — QueryDto cursor | Baixa | 10 min |
| 6 — CampaignReportsService paginação | Média | 35 min |
| 7 — Controller cursor | Baixa | 20 min |
| 8 — Instalar @nestjs/schedule | Baixa | 5 min |
| 9 — AdAccountsService findExpiring | Média | 30 min |
| 10 — GetExpiringQueryDto | Baixa | 15 min |
| 11 — Controller /expiring | Baixa | 20 min |
| 12 — TokenMonitorService | Média | 25 min |
| 13 — AdAccountsModule atualizado | Baixa | 10 min |
| 14 — AppModule ScheduleModule | Baixa | 5 min |
| 15 — Testes MetaAdsService | Média | 40 min |
| 16 — Testes CampaignReportsService | Média | 35 min |
| 17 — Testes AdAccountsService | Média | 25 min |
| 18 — Testes TokenMonitorService | Média | 20 min |
| **Total** | | **~5h30min** |

---

## Riscos e Dependências Externas

### Alto impacto
- **Formato do cursor na resposta da Meta:** A Marketing API pode retornar o cursor de duas formas: `paging.cursors.after` (mais comum) ou `paging.next` como URL completa contendo `?after=...`. A normalização em `CampaignReportsService` deve extrair `paging.cursors?.after` — não a URL completa — para passar de volta ao endpoint `?cursor=`. Verificar com dados reais antes do go-live.

### Médio impacto
- **`ScheduleModule` requer `ScheduleModule.forRoot()` no `AppModule`** além do `ScheduleModule` no módulo filho. Se o `forRoot()` for omitido, o `@Cron` silenciosamente não registra o job (sem erro em runtime, apenas o job não executa). A Tarefa 14 é crítica.
- **TypeORM e valores NULL em `LessThanOrEqual`:** SQL padrão: `NULL <= date` retorna NULL (falso), então `tokenExpiresAt = null` não será incluído no resultado — comportamento desejado. Validado pelo padrão do SQL, mas vale checar com um teste de integração real.
- **Ordem de rotas no controller:** `/expiring` **deve** ser declarado antes de `/:id`. Se inserido depois, NestJS tentará parsear `"expiring"` como UUID e retornará 400.

### Baixo impacto
- **Breaking change na resposta de `listCampaigns` e `getInsights`:** A resposta muda de `MetaCampaign[]` para `{ data: MetaCampaign[], paging: {} }`. Qualquer front-end ou integração que consome esses endpoints diretamente precisará atualizar o código do lado cliente. Comunicar antes de fazer o deploy.
- **`@nestjs/schedule` não está instalado** — único pacote novo nesta implementação.
