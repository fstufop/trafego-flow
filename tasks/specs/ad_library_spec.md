# Spec: Ad Library Search

## 1. Objetivo

Expor um endpoint interno que consulta a **Meta Ad Library API** (dados públicos) e retorna uma lista de anunciantes ativos no setor de moda/vestuário no Brasil. O objetivo é apoiar o processo de captação de clientes: a equipe recebe a lista, faz triagem manual e aborda os anunciantes via Instagram.

---

## 2. Contexto Multi-tenant

Este módulo **não é multi-tenant**. A Ad Library API é pública — os dados retornados não pertencem a nenhum cliente da plataforma. O endpoint é protegido apenas pelo `ApiKeyGuard` (MASTER_API_KEY), da mesma forma que os demais endpoints internos (ex: `campaign-reports`).

| Dado | Escopo |
|---|---|
| Resultado da busca na Ad Library | Global (sem tenantId) |
| Access token usado | App token (`META_APP_ID\|META_APP_SECRET`) |

---

## 3. Descrição Funcional

- Recebe parâmetros de busca: termos, país, limite e cursor de paginação
- Chama `GET /ads_archive` da Graph API com os parâmetros informados
- Deduplica o resultado por `page_id` (a API retorna um item por anúncio; podem existir múltiplos anúncios do mesmo anunciante)
- Retorna lista de anunciantes únicos com nome da página, entidade financiadora, faixas de impressão/gasto e link para o criativo
- Suporta paginação via cursor (`after`)

---

## 4. Estrutura de Arquivos

### Novos arquivos

- `src/modules/ad-library/ad-library.module.ts`
- `src/modules/ad-library/ad-library.controller.ts`
- `src/modules/ad-library/ad-library.service.ts`
- `src/modules/ad-library/ad-library.service.spec.ts`
- `src/modules/ad-library/dto/search-ad-library.dto.ts`
- `src/modules/ad-library/interfaces/ad-library.interface.ts`

### Arquivos modificados

- `src/app.module.ts` — importar `AdLibraryModule`
- `src/config/meta.config.ts` — adicionar `appId` via `META_APP_ID`
- `src/config/configuration.ts` — adicionar `META_APP_ID` ao `validationSchema`

---

## 5. Contrato de API

| Campo      | Valor                                                                 |
|------------|-----------------------------------------------------------------------|
| Método     | `GET`                                                                 |
| Path       | `/ad-library/search`                                                  |
| Auth       | `x-api-key` header — `ApiKeyGuard` (MASTER_API_KEY)                  |
| Query DTO  | `SearchAdLibraryDto`                                                  |
| Resposta   | `AdLibrarySearchResult`                                               |

### Query parameters (`SearchAdLibraryDto`)

#### Filtros enviados diretamente à Meta API

| Param                | Tipo       | Obrigatório | Default       | Mapeado para (Meta)         | Descrição                                                   |
|----------------------|------------|-------------|---------------|-----------------------------|-------------------------------------------------------------|
| `terms`              | `string`   | Não         | `moda`        | `search_terms`              | Palavras-chave nos criativos (máx 100 chars). Espaço = AND  |
| `searchType`         | `string`   | Não         | `KEYWORD_UNORDERED` | `search_type`         | `KEYWORD_UNORDERED` ou `KEYWORD_EXACT_PHRASE`               |
| `country`            | `string`   | Não         | `BR`          | `ad_reached_countries`      | Código ISO-2 do país. Aceita múltiplos separados por vírgula |
| `adType`             | `string`   | Não         | `ALL`         | `ad_type`                   | `ALL`, `EMPLOYMENT_ADS`, `HOUSING_ADS`, `FINANCIAL_PRODUCTS_AND_SERVICES_ADS` |
| `activeStatus`       | `string`   | Não         | `ACTIVE`      | `ad_active_status`          | `ACTIVE`, `INACTIVE`, `ALL`                                 |
| `platforms`          | `string`   | Não         | —             | `publisher_platforms`       | `FACEBOOK`, `INSTAGRAM`, `MESSENGER`, `WHATSAPP`, `THREADS`. Múltiplos por vírgula |
| `languages`          | `string`   | Não         | —             | `languages`                 | Códigos ISO 639-1. Ex: `pt` para português                  |
| `mediaType`          | `string`   | Não         | —             | `media_type`                | `ALL`, `IMAGE`, `MEME`, `VIDEO`, `NONE`                     |
| `deliveryDateMin`    | `string`   | Não         | —             | `ad_delivery_date_min`      | Data mínima de veiculação (`YYYY-MM-DD`)                    |
| `deliveryDateMax`    | `string`   | Não         | —             | `ad_delivery_date_max`      | Data máxima de veiculação (`YYYY-MM-DD`)                    |
| `pageIds`            | `string`   | Não         | —             | `search_page_ids`           | Até 10 IDs de página separados por vírgula                  |
| `limit`              | `number`   | Não         | `50`          | `limit` (×3 interno)        | Resultados únicos por página (máx 100)                      |
| `after`              | `string`   | Não         | —             | `after`                     | Cursor de paginação retornado em `paging.cursors.after`     |

#### Filtros aplicados no service (pós-resposta da Meta)

> A Meta **não** suporta filtrar por valor de gasto ou impressões diretamente. Esses valores são retornados como faixas e filtrados no nosso service após receber os dados.

| Param          | Tipo     | Descrição                                                            |
|----------------|----------|----------------------------------------------------------------------|
| `minSpend`     | `number` | Descarta anunciantes com `spend.lowerBound` abaixo deste valor      |
| `minImpressions` | `number` | Descarta anunciantes com `impressions.lowerBound` abaixo deste valor |

### Campos retornados (`AdLibraryAdvertiser`)

Campos solicitados à Meta via `fields=`:

| Campo                   | Tipo                        | Descrição                                          |
|-------------------------|-----------------------------|----------------------------------------------------|
| `pageId`                | `string`                    | ID da página Facebook                              |
| `pageName`              | `string`                    | Nome da página                                     |
| `fundingEntity`         | `string`                    | Empresa/pessoa que financia o anúncio (`bylines`)  |
| `spend`                 | `{ lowerBound, upperBound }` | Faixa de valor gasto (sem valor exato)            |
| `impressions`           | `{ lowerBound, upperBound }` | Faixa de impressões                               |
| `estimatedAudienceSize` | `{ lowerBound, upperBound }` | Faixa do tamanho estimado da audiência            |
| `brTotalReach`          | `number`                    | Alcance total estimado no Brasil                   |
| `adDeliveryStartTime`   | `string`                    | Data de início da veiculação                       |
| `adDeliveryStopTime`    | `string \| null`            | Data de fim (null = ainda ativo)                   |
| `publisherPlatforms`    | `string[]`                  | Plataformas onde o anúncio rodou                   |
| `languages`             | `string[]`                  | Idiomas do criativo                                |
| `demographicDistribution` | `AudienceDistribution[]`  | Distribuição por idade e gênero                    |
| `deliveryByRegion`      | `AudienceDistribution[]`    | Distribuição de alcance por estado/região          |
| `targetAges`            | `string[]`                  | Faixas etárias segmentadas pelo anunciante         |
| `targetGender`          | `string`                    | Gênero segmentado (`Women`, `Men`, `All`)          |
| `targetLocations`       | `TargetLocation[]`          | Localizações incluídas/excluídas na segmentação    |
| `adSnapshotUrl`         | `string`                    | Link para visualizar o criativo do anúncio         |

### Exemplo de resposta

```json
{
  "data": [
    {
      "pageId": "123456789",
      "pageName": "Loja Fashion XYZ",
      "fundingEntity": "Fashion XYZ LTDA",
      "spend": { "lowerBound": "100", "upperBound": "499" },
      "impressions": { "lowerBound": "1000", "upperBound": "5000" },
      "estimatedAudienceSize": { "lowerBound": "5000", "upperBound": "10000" },
      "brTotalReach": 3200,
      "adDeliveryStartTime": "2024-01-15",
      "adDeliveryStopTime": null,
      "publisherPlatforms": ["INSTAGRAM", "FACEBOOK"],
      "languages": ["pt"],
      "demographicDistribution": [
        { "age": "25-34", "gender": "female", "percentage": "0.42" }
      ],
      "deliveryByRegion": [
        { "region": "São Paulo", "percentage": "0.35" }
      ],
      "targetAges": ["18", "24", "35", "44"],
      "targetGender": "All",
      "targetLocations": [
        { "name": "Brazil", "type": "country" }
      ],
      "adSnapshotUrl": "https://www.facebook.com/ads/archive/render_ad/?id=..."
    }
  ],
  "paging": {
    "cursors": {
      "before": "...",
      "after": "..."
    }
  },
  "total": 42
}
```

---

## 6. Entidade (PostgreSQL)

**Sem entidade.** Este módulo é um proxy para a Meta Ad Library API — nenhum dado é persistido no banco. Os resultados são retornados diretamente ao cliente.

---

## 7. Cache (Redis)

**Sem cache para este módulo.** Os resultados da Ad Library mudam com frequência (anúncios novos, pausados, etc.) e cada combinação de `terms + country + after` gera uma chave potencialmente ilimitada. O custo de cache não justifica o benefício neste caso.

---

## 8. Interface do Service

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
  type: string; // 'country' | 'region' | 'city'
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

---

## 9. DTOs e Validações

```typescript
export enum AdType {
  ALL = 'ALL',
  EMPLOYMENT_ADS = 'EMPLOYMENT_ADS',
  HOUSING_ADS = 'HOUSING_ADS',
  FINANCIAL_PRODUCTS_AND_SERVICES_ADS = 'FINANCIAL_PRODUCTS_AND_SERVICES_ADS',
}

export enum AdActiveStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ALL = 'ALL',
}

export enum SearchType {
  KEYWORD_UNORDERED = 'KEYWORD_UNORDERED',
  KEYWORD_EXACT_PHRASE = 'KEYWORD_EXACT_PHRASE',
}

export enum MediaType {
  ALL = 'ALL',
  IMAGE = 'IMAGE',
  MEME = 'MEME',
  VIDEO = 'VIDEO',
  NONE = 'NONE',
}

export class SearchAdLibraryDto {
  // ── Filtros Meta API ──────────────────────────────────────────────────────

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  terms?: string = 'moda';

  @IsOptional()
  @IsEnum(SearchType)
  searchType?: SearchType = SearchType.KEYWORD_UNORDERED;

  @IsOptional()
  @IsString()
  country?: string = 'BR'; // ISO-2, aceita múltiplos: 'BR,AR'

  @IsOptional()
  @IsEnum(AdType)
  adType?: AdType = AdType.ALL;

  @IsOptional()
  @IsEnum(AdActiveStatus)
  activeStatus?: AdActiveStatus = AdActiveStatus.ACTIVE;

  @IsOptional()
  @IsString()
  platforms?: string; // 'INSTAGRAM,FACEBOOK'

  @IsOptional()
  @IsString()
  languages?: string; // 'pt,en'

  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType;

  @IsOptional()
  @IsDateString()
  deliveryDateMin?: string; // 'YYYY-MM-DD'

  @IsOptional()
  @IsDateString()
  deliveryDateMax?: string; // 'YYYY-MM-DD'

  @IsOptional()
  @IsString()
  pageIds?: string; // até 10 IDs separados por vírgula

  // ── Paginação ─────────────────────────────────────────────────────────────

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  after?: string;

  // ── Filtros pós-resposta (aplicados no service) ───────────────────────────

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  minSpend?: number; // descarta pages com spend.lowerBound abaixo deste valor

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  minImpressions?: number; // descarta pages com impressions.lowerBound abaixo deste valor
}
```

---

## 10. Implementação do Service

### Access token

A Ad Library API aceita **app access token** — não requer token de usuário. O token é construído como:

```
{META_APP_ID}|{META_APP_SECRET}
```

Adicionar `appId` ao `meta.config.ts`:

```typescript
registerAs('meta', () => ({
  appId: process.env.META_APP_ID,          // novo
  appSecret: process.env.META_APP_SECRET,
  // ...
}))
```

O service monta o token internamente — nunca exposto na resposta.

### Endpoint Meta chamado

```
GET https://graph.facebook.com/v21.0/ads_archive
```

Parâmetros passados:

```typescript
{
  access_token: `${appId}|${appSecret}`,
  ad_reached_countries: JSON.stringify([country]),
  search_terms: terms,
  ad_type: 'ALL',
  fields: 'page_id,page_name,funding_entity,impressions,spend,ad_delivery_start_time,ad_snapshot_url',
  limit: limit * 3,   // busca 3x mais para absorver deduplicação por page_id
  ...(after && { after }),
}
```

### Deduplicação

Após receber a resposta da Meta, o service deduplica por `page_id`:
- Para cada `page_id` duplicado, mantém o registro com `ad_delivery_start_time` mais recente
- Retorna no máximo `limit` itens únicos

---

## 11. Critérios de Aceitação (BDD)

```gherkin
Feature: Ad Library Search

  Scenario: Busca com termos padrão retorna anunciantes de moda no Brasil
    Given a variável META_APP_ID está configurada
    And a variável META_APP_SECRET está configurada
    When GET /ad-library/search com header x-api-key válido
    Then retorna 200 com lista de anunciantes únicos por page_id
    And cada item contém pageId, pageName, fundingEntity

  Scenario: Busca com termos customizados
    Given o dev passa ?terms=vestuario&country=BR
    When GET /ad-library/search
    Then a Meta API é chamada com search_terms=vestuario e ad_reached_countries=["BR"]

  Scenario: Paginação com cursor
    Given a resposta anterior retornou paging.cursors.after="abc123"
    When GET /ad-library/search?after=abc123
    Then a Meta API é chamada com after=abc123
    And retorna a próxima página de resultados

  Scenario: Limite máximo respeitado
    Given o dev passa ?limit=200
    When GET /ad-library/search
    Then retorna 400 com mensagem de validação (max 100)

  Scenario: Autenticação ausente
    Given o header x-api-key não é enviado
    When GET /ad-library/search
    Then retorna 403

  Scenario: Meta API indisponível
    Given a Meta API retorna erro 5xx
    When GET /ad-library/search
    Then retorna 502 ou propaga o erro com log
```

---

## 12. Nova variável de ambiente

| Variável      | Obrigatório | Descrição                               |
|---------------|-------------|-----------------------------------------|
| `META_APP_ID` | Sim         | ID do App Meta (visível no Dev Console) |

---

## 13. Definition of Done

- [ ] `AdLibraryModule` registrado em `app.module.ts`
- [ ] `META_APP_ID` adicionado ao `meta.config.ts` e ao `validationSchema`
- [ ] Controller com `ApiKeyGuard` e decorators Swagger
- [ ] Service implementa `IAdLibraryService`
- [ ] Deduplicação por `page_id` implementada no service
- [ ] `SearchAdLibraryDto` com validações `class-validator`
- [ ] Testes unitários do service (mock do `HttpService`)
- [ ] `META_APP_ID` documentado no `.env.example`
