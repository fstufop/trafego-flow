# Plano de Implementação: Ad Library Search

**Spec:** `tasks/specs/ad_library_spec.md`
**Data:** 2026-06-22

---

## Análise de Alternativas

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| A — Service único (Escolhida) | `AdLibraryService` faz a chamada HTTP e a deduplicação | Simples, sem camadas desnecessárias; módulo autossuficiente | — |
| B — Dois services (api + orquestrador) | Separar chamada HTTP (`AdLibraryApiService`) da lógica de negócio (`AdLibraryService`) | Segue o padrão `MetaAdsService` + `CampaignReportsService` | Over-engineering: não há cache, não há tokens criptografados, não há multi-tenancy — a separação não agrega aqui |
| C — Adicionar endpoint ao `CampaignReportsModule` | Aproveitar o módulo Meta já existente | Menos arquivos | Responsabilidade errada: Ad Library é prospecção, não relatório de campanha |

**Decisão:** Alternativa A — um único `AdLibraryService` com `HttpService` injetado é suficiente e mantém o módulo coeso sem complexidade desnecessária.

---

## Recursos Reutilizáveis Identificados

| Recurso | Localização | Como usar |
|---|---|---|
| `ApiKeyGuard` | `src/common/guards/api-key.guard.ts` | Aplicar no controller com `@UseGuards(ApiKeyGuard)` |
| `HttpModule` + `HttpService` | `@nestjs/axios` (já instalado) | Importar `HttpModule` no módulo; injetar `HttpService` no service |
| `ConfigService` | `@nestjs/config` (global) | Ler `meta.appId` e `meta.appSecret` para montar o app access token |
| `firstValueFrom` | `rxjs` (já instalado) | Converter Observable → Promise, padrão do projeto |
| `Logger` | `@nestjs/common` | Padrão de log já usado em `MetaAdsService` |

---

## Diagrama de Fluxo

```
GET /ad-library/search?terms=moda&activeStatus=ACTIVE&...
    ↓
ApiKeyGuard (valida x-api-key header)
    ↓
AdLibraryController
    ↓ @Query() SearchAdLibraryDto (ValidationPipe)
AdLibraryService.search(dto)
    ↓
    Monta app access token: META_APP_ID|META_APP_SECRET
    Monta params: search_terms, ad_reached_countries, ad_active_status,
                  publisher_platforms, languages, media_type,
                  ad_delivery_date_min/max, search_page_ids, ad_type,
                  fields=..., limit=dto.limit*3, after=dto.after
    ↓
HttpService.get('https://graph.facebook.com/v21.0/ads_archive', { params })
    ↓
Meta Ad Library API (dados públicos)
    ↓ raw: N anúncios (mesmo anunciante pode aparecer várias vezes)
    ↓
Deduplicação por page_id (mantém ad_delivery_start_time mais recente)
    ↓
Filtros pós-resposta: minSpend, minImpressions
    ↓
Slice: retorna até dto.limit itens únicos
    ↓
AdLibrarySearchResult { data, paging, total }
    ↓
200 OK
```

---

## Tarefas Sequenciais

### Tarefa 1 — Config: adicionar META_APP_ID

**Arquivos:**
- `src/config/meta.config.ts`
- `src/config/configuration.ts`

**O que fazer:**
- Em `meta.config.ts`, adicionar `appId: process.env.META_APP_ID` ao objeto registrado
- Em `configuration.ts`, adicionar `META_APP_ID: Joi.string().required()` ao `validationSchema`

**Depende de:** nada
**Testável:** `npm run start:dev` valida o schema Joi na inicialização — falha se `META_APP_ID` não estiver no `.env`

---

### Tarefa 2 — Interface + DTOs + Enums

**Arquivos:**
- `src/modules/ad-library/interfaces/ad-library.interface.ts`
- `src/modules/ad-library/dto/search-ad-library.dto.ts`

**O que fazer em `ad-library.interface.ts`:**

```typescript
export interface InsightsRange {
  lowerBound: string;
  upperBound: string;
}

export interface AudienceDistribution {
  age?: string;
  gender?: string;
  region?: string;
  percentage: string;
}

export interface TargetLocation {
  name: string;
  type: string;
}

export interface AdLibraryAdvertiser {
  pageId: string;
  pageName: string;
  fundingEntity: string | null;
  spend: InsightsRange | null;
  impressions: InsightsRange | null;
  estimatedAudienceSize: InsightsRange | null;
  brTotalReach: number | null;
  adDeliveryStartTime: string;
  adDeliveryStopTime: string | null;
  publisherPlatforms: string[];
  languages: string[];
  demographicDistribution: AudienceDistribution[];
  deliveryByRegion: AudienceDistribution[];
  targetAges: string[];
  targetGender: string | null;
  targetLocations: TargetLocation[];
  adSnapshotUrl: string;
}

export interface AdLibraryPaging {
  cursors: { before: string; after: string };
}

export interface AdLibrarySearchResult {
  data: AdLibraryAdvertiser[];
  paging: AdLibraryPaging | null;
  total: number;
}

export interface IAdLibraryService {
  search(params: SearchAdLibraryDto): Promise<AdLibrarySearchResult>;
}
```

**O que fazer em `search-ad-library.dto.ts`:**
- Declarar enums `AdType`, `AdActiveStatus`, `SearchType`, `MediaType`
- Classe `SearchAdLibraryDto` com todos os campos da spec §9:
  - `terms`, `searchType`, `country`, `adType`, `activeStatus`, `platforms`, `languages`, `mediaType`, `deliveryDateMin`, `deliveryDateMax`, `pageIds` — filtros Meta
  - `limit`, `after` — paginação
  - `minSpend`, `minImpressions` — filtros pós-resposta

**Depende de:** nada (paralelo com Tarefa 1)
**Testável:** `npm run build` sem erros de tipo

---

### Tarefa 3 — Service: AdLibraryService

**Arquivo:** `src/modules/ad-library/ad-library.service.ts`

**O que fazer:**

```typescript
@Injectable()
export class AdLibraryService implements IAdLibraryService {
  private readonly logger = new Logger(AdLibraryService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  async search(dto: SearchAdLibraryDto): Promise<AdLibrarySearchResult> { ... }

  private get baseUrl(): string { ... }           // https://graph.facebook.com/v21.0
  private get appAccessToken(): string { ... }    // META_APP_ID|META_APP_SECRET
  private buildParams(dto: SearchAdLibraryDto): Record<string, unknown> { ... }
  private deduplicate(ads: RawMetaAd[]): RawMetaAd[] { ... }
  private applyClientFilters(ads: RawMetaAd[], dto: SearchAdLibraryDto): RawMetaAd[] { ... }
  private mapToAdvertiser(raw: RawMetaAd): AdLibraryAdvertiser { ... }
  private handleError(err: unknown): never { ... }
}
```

**Detalhes críticos:**

- `buildParams`: mapeia DTO → parâmetros Meta. Arrays (platforms, languages, pageIds) são strings separadas por vírgula no DTO e precisam ser convertidas para array JSON. `limit` é `dto.limit * 3` para absorver duplicatas.
- `deduplicate`: agrupa por `page_id`, mantém o item com `ad_delivery_start_time` mais recente (comparação de string ISO — ordena desc, pega primeiro).
- `applyClientFilters`: se `minSpend` definido, descarta itens onde `parseInt(spend.lowerBound) < minSpend`. Mesma lógica para `minImpressions`.
- `mapToAdvertiser`: converte snake_case da Meta → camelCase da nossa interface. Campos ausentes mapeiam para `null` ou `[]`.
- `handleError`: loga o erro e relança. Não trata código 190 (app token não expira como user token).

**Campos solicitados à Meta (`fields=`):**
```
page_id,page_name,bylines,spend,impressions,estimated_audience_size,
br_total_reach,ad_delivery_start_time,ad_delivery_stop_time,
publisher_platforms,languages,demographic_distribution,
delivery_by_region,target_ages,target_gender,target_locations,ad_snapshot_url
```

**Depende de:** Tarefa 2
**Testável:** testes unitários com `HttpService` mockado (Tarefa 7)

---

### Tarefa 4 — Controller: AdLibraryController

**Arquivo:** `src/modules/ad-library/ad-library.controller.ts`

**O que fazer:**

```typescript
@ApiTags('ad-library')
@ApiSecurity('x-api-key')
@UseGuards(ApiKeyGuard)
@Controller('ad-library')
export class AdLibraryController {
  constructor(private readonly adLibraryService: AdLibraryService) {}

  @Get('search')
  @ApiOperation({ summary: 'Busca anunciantes na Meta Ad Library por setor/termos' })
  search(@Query() dto: SearchAdLibraryDto): Promise<AdLibrarySearchResult> {
    return this.adLibraryService.search(dto);
  }
}
```

- Decorators Swagger: `@ApiQuery` para cada parâmetro do DTO com `required: false` e exemplos
- `ValidationPipe` aplicado globalmente (já configurado no `main.ts`) — não precisa declarar no método

**Depende de:** Tarefa 3
**Testável:** `make -n` / chamada manual via curl ou Swagger UI

---

### Tarefa 5 — Module: AdLibraryModule

**Arquivo:** `src/modules/ad-library/ad-library.module.ts`

**O que fazer:**

```typescript
@Module({
  imports: [HttpModule],
  controllers: [AdLibraryController],
  providers: [AdLibraryService],
})
export class AdLibraryModule {}
```

- Importar apenas `HttpModule` — sem TypeORM, sem CryptoModule, sem AdAccountsModule
- `AdLibraryService` não precisa ser exportado (não é consumido por outros módulos)

**Depende de:** Tarefas 3 e 4
**Testável:** `npm run start:dev` sem erros de injeção de dependência

---

### Tarefa 6 — App: registrar AdLibraryModule

**Arquivo:** `src/app.module.ts`

**O que fazer:**
- Importar `AdLibraryModule` e adicionar ao array `imports` do `AppModule`

**Depende de:** Tarefa 5
**Testável:** `npm run start:dev` sobe sem erro; `GET /ad-library/search` responde (403 sem API key, 200 com)

---

### Tarefa 7 — Testes unitários do Service

**Arquivo:** `src/modules/ad-library/ad-library.service.spec.ts`

**O que testar:**

| Cenário | O que verificar |
|---|---|
| Busca bem-sucedida | Retorna `AdLibrarySearchResult` com `data`, `paging`, `total` corretos |
| Deduplicação | Dois anúncios do mesmo `page_id` → retorna apenas 1 advertiser com o start_time mais recente |
| `minSpend` aplicado | Advertiser com `spend.lowerBound = "50"` é descartado quando `minSpend = 100` |
| `minImpressions` aplicado | Advertiser com `impressions.lowerBound = "200"` é descartado quando `minImpressions = 500` |
| App token montado corretamente | `HttpService.get` é chamado com `access_token = "APP_ID\|APP_SECRET"` |
| Meta API retorna lista vazia | Retorna `{ data: [], paging: null, total: 0 }` |
| Meta API retorna erro | Logger registra o erro e a exceção é relançada |

**Mock pattern (seguindo `MetaAdsService` como referência):**
```typescript
const mockHttpService = { get: jest.fn() };
const mockConfig = { get: jest.fn() };
// mockConfig.get retorna diferentes valores por chave
```

**Depende de:** Tarefa 3
**Testável:** `npm run test` passa sem erros

---

## Ordem de execução recomendada

```
Tarefa 1 (config)  ─┐
Tarefa 2 (types)   ─┘ paralelas
        ↓
Tarefa 3 (service)
        ↓
Tarefa 4 (controller)
        ↓
Tarefa 5 (module)
        ↓
Tarefa 6 (app)
        ↓
Tarefa 7 (testes)
```

---

## Estimativa

| Tarefa | Descrição | Complexidade | Estimativa |
|---|---|---|---|
| 1 | Config META_APP_ID | Baixa | 10 min |
| 2 | Interface + DTOs + Enums | Baixa | 20 min |
| 3 | Service (HTTP + deduplica + mapeia) | Média | 45 min |
| 4 | Controller + Swagger | Baixa | 20 min |
| 5 | Module | Baixa | 5 min |
| 6 | App | Baixa | 5 min |
| 7 | Testes unitários | Média | 40 min |

**Total estimado: ~2h30**

---

## Riscos e Dependências

| Risco | Probabilidade | Mitigação |
|---|---|---|
| `META_APP_ID` não disponível no ambiente | Alta | Documentar em `.env.example`; app inicializa sem ela se Joi for configurado como `required()` |
| Ad Library API exige aprovação do app Meta | Média | App tokens básicos funcionam para acesso público; se bloqueado, Meta retorna erro 200 com `error.code=10` — tratar no `handleError` |
| `limit * 3` não garante `limit` items únicos após deduplicação | Baixa | Retornar o que tiver (pode ser menos que `limit`) — aceitável para uso de triagem |
| Campos opcionais ausentes na resposta da Meta | Alta | Todo mapeamento usa `?? null` ou `?? []` — campos ausentes não quebram a resposta |
| `delivery_by_region` e `demographic_distribution` ausentes para anúncios sem dados suficientes | Alta | Mesma mitigação acima — mapear para `[]` quando ausente |
| `br_total_reach` só disponível para anúncios com alcance no Brasil | Média | Mapear para `null` quando ausente |

### Módulos NestJS necessários

Todos já instalados:
- `@nestjs/axios` — `HttpModule` / `HttpService`
- `@nestjs/config` — `ConfigService`
- `rxjs` — `firstValueFrom`
- `class-validator` / `class-transformer` — DTOs
