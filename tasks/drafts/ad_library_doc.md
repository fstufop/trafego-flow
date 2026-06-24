# Documentação: Ad Library Search

**Data:** 2026-06-23
**Tipo:** Módulo Novo
**Arquivos analisados:**
- `src/modules/ad-library/ad-library.module.ts`
- `src/modules/ad-library/ad-library.controller.ts`
- `src/modules/ad-library/ad-library.service.ts`
- `src/modules/ad-library/dto/search-ad-library.dto.ts`
- `src/modules/ad-library/interfaces/ad-library.interface.ts`
- `src/config/meta.config.ts`

---

## Visão Geral

Módulo de prospecção comercial que consulta a **Meta Ad Library API** (dados públicos) e retorna uma lista deduplicada de anunciantes ativos em determinado setor. O objetivo é apoiar o time interno na captação de novos clientes: a equipe recebe a lista, faz triagem manual e aborda os anunciantes via Instagram. Não persiste dados — é um proxy inteligente sobre a API pública da Meta.

---

## Contexto Multi-tenant

- **Dados isolados por tenant:** nenhum — este módulo não tem contexto de tenant
- **Dados globais:** toda a operação é global; o endpoint é protegido por `MASTER_API_KEY` (chave única da plataforma, não por cliente)

---

## Fluxo de Dados

```
GET /api/v1/ad-library/search?terms=moda&platforms=INSTAGRAM&...
    ↓
ApiKeyGuard — valida header x-api-key contra MASTER_API_KEY
    ↓
AdLibraryController.search(@Query() dto: SearchAdLibraryDto)
    ↓ ValidationPipe (whitelist: true, transform: true)
AdLibraryService.search(dto)
    ↓
    1. buildParams(dto)
       - Monta access_token: META_SYSTEM_USER_TOKEN ?? APP_ID|APP_SECRET
       - Converte strings CSV → arrays JSON (platforms, languages, pageIds)
       - limit enviado à Meta = dto.limit × 3 (para absorver duplicatas)
    ↓
HttpService.get('https://graph.facebook.com/v21.0/ads_archive', { params })
    ↓
Meta Ad Library API (dados públicos — requer Standard Access em ads_read)
    ↓ N anúncios raw (mesmo page_id pode aparecer múltiplas vezes)
    ↓
    2. deduplicate(raw)
       - Agrupa por page_id
       - Mantém o anúncio com ad_delivery_start_time mais recente
    ↓
    3. applyClientFilters(deduplicated, dto)
       - Descarta se spend.lower_bound < minSpend
       - Descarta se impressions.lower_bound < minImpressions
    ↓
    4. slice(0, dto.limit)
       - Retorna no máximo dto.limit itens únicos
    ↓
    5. mapToAdvertiser(raw) — snake_case → camelCase
    ↓
AdLibrarySearchResult { data[], paging, total }
← 200 OK
```

---

## Regras de Negócio Identificadas

### RN-01: Deduplicação por page_id
**Onde no código:** `ad-library.service.ts:102–113`
**Descrição:** A Meta Ad Library retorna um item por *anúncio*, não por *anunciante*. Um mesmo anunciante pode ter dezenas de anúncios ativos. O service agrupa por `page_id` e mantém apenas o registro com `ad_delivery_start_time` mais recente.
**Condição:** Aplicada sempre, antes dos filtros client-side.

### RN-02: Multiplicador de limite (×3)
**Onde no código:** `ad-library.service.ts:91`
**Descrição:** O `limit` enviado à Meta é `dto.limit × 3`. Isso garante que, após a deduplicação, ainda haja itens suficientes para preencher a página solicitada. Exemplo: se o usuário quer 25 resultados únicos, a Meta é consultada com `limit=75`.
**Condição:** Aplicada sempre no `buildParams`.

### RN-03: Filtros client-side para spend e impressions
**Onde no código:** `ad-library.service.ts:115–125`
**Descrição:** A Meta Ad Library API não suporta filtros por valor gasto ou impressões — retorna apenas faixas (`lower_bound`/`upper_bound`). Os filtros `minSpend` e `minImpressions` são aplicados no service, comparando `parseInt(lower_bound)` com o valor mínimo informado.
**Condição:** Aplicados somente quando `minSpend` ou `minImpressions` estão definidos no DTO.

### RN-04: Estratégia de token com fallback
**Onde no código:** `ad-library.service.ts:70–77`
**Descrição:** O service usa `META_SYSTEM_USER_TOKEN` quando disponível (token de System User do Business Manager, sem expiração). Se ausente, constrói um app access token no formato `APP_ID|APP_SECRET`. O System User token tem precedência por ter permissões mais amplas.
**Condição:** Aplicada a cada requisição; sem cache do token.

### RN-05: Campos ausentes mapeados para null/[]
**Onde no código:** `ad-library.service.ts:127–163`
**Descrição:** Todos os campos opcionais da resposta da Meta (`spend`, `impressions`, `br_total_reach`, `demographic_distribution`, etc.) são mapeados com `?? null` ou `?? []`. A Meta omite campos quando não há dados suficientes para a divulgação (política de privacidade).
**Condição:** Aplicada sempre no `mapToAdvertiser`.

### RN-06: Paginação com cursor da Meta
**Onde no código:** `ad-library.service.ts:59`
**Descrição:** O cursor de paginação retornado (`paging.cursors.after`) refere-se à posição nos resultados *brutos* da Meta (antes da deduplicação). Isso causa uma imprecisão: a próxima página pode retornar menos de `limit` itens únicos dependendo da distribuição de duplicatas.
**Condição:** Comportamento aceitável para uso de triagem manual; não impacta a funcionalidade.

---

## Endpoints Expostos

| Método | Path | Guard | DTO | Descrição |
|--------|------|-------|-----|-----------|
| `GET` | `/api/v1/ad-library/search` | `ApiKeyGuard` | `SearchAdLibraryDto` | Busca anunciantes ativos na Meta Ad Library por setor/termos |

### Parâmetros de query

**Filtros enviados à Meta API:**

| Param | Tipo | Default | Mapeado para |
|---|---|---|---|
| `terms` | `string` | `moda` | `search_terms` |
| `searchType` | `enum` | `KEYWORD_UNORDERED` | `search_type` |
| `country` | `string` | `BR` | `ad_reached_countries` |
| `adType` | `enum` | `ALL` | `ad_type` |
| `activeStatus` | `enum` | `ACTIVE` | `ad_active_status` |
| `platforms` | `string` (CSV) | — | `publisher_platforms` |
| `languages` | `string` (CSV) | — | `languages` |
| `mediaType` | `enum` | — | `media_type` |
| `deliveryDateMin` | `date` | — | `ad_delivery_date_min` |
| `deliveryDateMax` | `date` | — | `ad_delivery_date_max` |
| `pageIds` | `string` (CSV) | — | `search_page_ids` |

**Paginação:**

| Param | Tipo | Default |
|---|---|---|
| `limit` | `number` (1–100) | `50` |
| `after` | `string` | — |

**Filtros client-side (aplicados no service):**

| Param | Tipo | Descrição |
|---|---|---|
| `minSpend` | `number` | Valor mínimo em `spend.lowerBound` |
| `minImpressions` | `number` | Valor mínimo em `impressions.lowerBound` |

---

## Entidade PostgreSQL

**Sem entidade.** O módulo não persiste dados. Todos os resultados são retornados diretamente da Meta API sem armazenamento intermediário.

---

## Estratégia de Cache Redis

**Módulo sem cache Redis.** Os resultados da Ad Library mudam frequentemente (anúncios pausados, novos anúncios criados) e a combinação de parâmetros é praticamente ilimitada, tornando o cache ineficaz para este caso.

---

## Schema de Resposta

```typescript
AdLibrarySearchResult {
  data: AdLibraryAdvertiser[]   // lista deduplicada por page_id
  paging: {
    cursors: { before: string; after: string }
  } | null
  total: number                 // quantidade de itens retornados (≤ limit)
}

AdLibraryAdvertiser {
  pageId: string
  pageName: string
  fundingEntity: string | null       // empresa/pessoa que patrocina
  spend: InsightsRange | null        // { lowerBound, upperBound } em moeda local
  impressions: InsightsRange | null  // { lowerBound, upperBound }
  estimatedAudienceSize: InsightsRange | null
  brTotalReach: number | null        // alcance total estimado no Brasil
  adDeliveryStartTime: string        // ISO date
  adDeliveryStopTime: string | null  // null = anúncio ainda ativo
  publisherPlatforms: string[]       // ['INSTAGRAM', 'FACEBOOK', ...]
  languages: string[]                // ['pt', ...]
  demographicDistribution: AudienceDistribution[]  // por idade e gênero
  deliveryByRegion: AudienceDistribution[]         // por estado/região
  targetAges: string[]               // faixas etárias segmentadas
  targetGender: string | null        // 'Women' | 'Men' | 'All'
  targetLocations: TargetLocation[]  // localizações segmentadas
  adSnapshotUrl: string              // link para o criativo do anúncio
}
```

---

## Critérios de Aceitação

```gherkin
Feature: Ad Library Search

  Scenario: Busca padrão retorna anunciantes de moda no Brasil
    Given META_SYSTEM_USER_TOKEN configurado com ads_read
    When GET /api/v1/ad-library/search com x-api-key válido
    Then retorna 200 com lista de anunciantes únicos por pageId
    And cada item contém pageId, pageName, adDeliveryStartTime

  Scenario: Deduplicação por page_id
    Given Meta API retorna dois anúncios do mesmo page_id com datas diferentes
    When GET /api/v1/ad-library/search
    Then retorna apenas 1 item para esse page_id com a data mais recente

  Scenario: Filtro minSpend descarta anunciantes com baixo investimento
    Given Meta retorna anunciante com spend.lowerBound = "50"
    And parâmetro minSpend = 100
    When GET /api/v1/ad-library/search?minSpend=100
    Then esse anunciante não aparece na resposta

  Scenario: Paginação com cursor
    Given resposta anterior retornou paging.cursors.after = "xyz"
    When GET /api/v1/ad-library/search?after=xyz
    Then Meta API é chamada com after=xyz

  Scenario: API key ausente
    Given header x-api-key não enviado
    When GET /api/v1/ad-library/search
    Then retorna 401

  Scenario: Meta API retorna erro de permissão
    Given META_SYSTEM_USER_TOKEN sem Standard Access em ads_read
    When GET /api/v1/ad-library/search
    Then retorna 502 com mensagem da Meta
```

---

## Variáveis de Ambiente Necessárias

| Variável | Obrigatório | Descrição | Exemplo |
|----------|-------------|-----------|---------|
| `META_APP_ID` | Sim | ID do app no Meta Developer Console | `10019996369089789` |
| `META_APP_SECRET` | Sim | Secret do app Meta | `abc123...` |
| `META_SYSTEM_USER_TOKEN` | Recomendado | Token de System User (não expira) — tem precedência sobre o app token | `EAAxxxxxxx` |

---

## Dependências Externas

- **Meta Graph API** — `GET /v21.0/ads_archive` (Ad Library API pública)
- **`@nestjs/axios`** — `HttpModule` / `HttpService` para chamadas HTTP
- **`@nestjs/config`** — leitura de `meta.appId`, `meta.appSecret`, `meta.systemUserToken`
- **`rxjs`** — `firstValueFrom` para converter Observable → Promise

**Módulos internos importados:** nenhum (módulo autossuficiente)

---

## Pontos de Atenção / Dívida Técnica

### ⚠️ Requer Standard Access na Meta (bloqueante)
O endpoint `/ads_archive` exige **Standard Access** para `ads_read`, aprovado via App Review ou registro em `facebook.com/ads/library/api`. Em Development Mode, a chamada falha com `OAuthException code: 10` mesmo com token válido e escopo `ads_read`. Pendente aprovação da Meta.

### ⚠️ Imprecisão na paginação após deduplicação
O cursor retornado no `paging.cursors.after` aponta para a posição nos resultados *brutos* da Meta (antes da deduplicação × 3). Em páginas subsequentes, o número de itens únicos retornados pode ser menor que `limit` se o fator de multiplicação (×3) não for suficiente para a densidade de duplicatas da busca.

**Mitigação possível:** implementar busca com múltiplas páginas até atingir `limit` únicos (aumenta latência).

### ℹ️ spend e impressions são faixas, não valores exatos
A Meta não divulga valores exatos por política de privacidade. Os filtros `minSpend` e `minImpressions` comparam contra `lower_bound`, o que significa que um anunciante que gastou exatamente no limiar pode ser incluído ou excluído dependendo da faixa em que se enquadra.

### ℹ️ country aceita múltiplos valores sem validação de formato
O campo `country` aceita strings como `BR,AR,PT` (CSV), mas não há validação individual de cada código ISO-2. Um valor inválido seria enviado à Meta e causaria um erro 400 da API externa.

**Mitigação possível:** adicionar `@IsISO31661Alpha2()` em um array após split, ou validar no service.
