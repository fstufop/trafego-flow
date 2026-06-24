# Spec: Campaign Reports — Exportação CSV

## 1. Objetivo

Permitir que gestores de tráfego exportem relatórios de insights de campanhas em formato CSV,
selecionando apenas as colunas relevantes para sua análise e com valores já formatados nas
unidades corretas (moeda, porcentagem, contagem, data). Elimina o trabalho manual de copiar
dados do JSON e formatar em planilha.

Quando nenhuma coluna for especificada, o sistema exporta automaticamente todas as colunas
disponíveis — útil para análises exploratórias ou auditorias completas.

O período pode ser definido como preset nomeado (`last_30d`, `this_month`, etc.) ou como
intervalo customizado com datas exatas (`since` / `until`), ambos mutuamente exclusivos.

## 2. Contexto Multi-tenant

| Dado                     | Isolamento                                                        |
|--------------------------|-------------------------------------------------------------------|
| Insights exportados      | Por `adAccountId` — pertence a um único tenant via AdAccountEntity |
| Autenticação             | `x-api-key` global (mesmo guard dos demais endpoints)            |
| Cache de insights        | Reutilizado do `CampaignReportsService` (chave existente)         |

## 3. Descrição Funcional

- Novo endpoint `POST /campaign-reports/insights/export/csv` recebe no body:
  os mesmos parâmetros de filtro do `GET /insights` (adAccountId, level, timeIncrement,
  breakdowns) **mais** o período e as colunas desejadas.
- **Seleção de colunas:** campo `columns` é opcional. Quando ausente ou vazio, todas as
  colunas do enum `MetaInsightsColumn` são exportadas (colunas de breakdown só são incluídas
  se o campo `breakdowns` também for passado). Quando presente, exporta apenas as informadas.
- **Seleção de período:** dois modos mutuamente exclusivos:
  1. `datePreset` — preset nomeado da Meta API (`last_30d`, `this_month`, etc.)
  2. `since` + `until` — intervalo customizado em formato `YYYY-MM-DD`; **ambos obrigatórios
     quando um deles for fornecido**. Validado com `@ValidateIf` + `@IsDateString`.
  - Se nenhum for fornecido, `datePreset` assume o default `last_30d`.
  - Se ambos forem fornecidos simultaneamente, retorna `400`.
- O service reutiliza a lógica de busca do `CampaignReportsService` para aproveitar o cache
  Redis. Para intervalo customizado, uma nova cache key é derivada de `since`/`until`.
- Um `CsvFormatterService` transforma o array de `MetaInsights` em string CSV aplicando
  a formatação correta por tipo de coluna (veja tabela na seção 9).
- A resposta define `Content-Type: text/csv` e `Content-Disposition` com nome de arquivo
  dinâmico: `insights_<adAccountId>_<datePreset|since_until>.csv`.
- Colunas do tipo `actions` (ex.: `purchase_roas`, `video_plays`) são achatadas: o service
  extrai o `value` do `action_type` relevante conforme mapeamento fixo (seção 9).
- Sem paginação na resposta: exporta **todos** os registros (a Meta API pode retornar múltiplas
  páginas — o service faz cursor loop antes de formatar).

## 4. Estrutura de Arquivos

### Novos arquivos

```
src/modules/campaign-reports/
  dto/export-insights-csv.dto.ts          ← body DTO com columns + filtros
  enums/insights-column.enum.ts           ← enum MetaInsightsColumn com todas as colunas exportáveis

src/common/csv/
  csv-formatter.service.ts               ← serviço genérico de formatação e serialização CSV
  csv-formatter.service.spec.ts
  csv.module.ts                          ← módulo que exporta CsvFormatterService
```

### Arquivos modificados

```
src/modules/campaign-reports/
  campaign-reports.controller.ts         ← novo endpoint POST /insights/export/csv
  campaign-reports.service.ts            ← novo método exportInsightsCsv(dto)
  campaign-reports.module.ts             ← importa CsvModule
  interfaces/campaign-reports-service.interface.ts  ← adiciona exportInsightsCsv
  interfaces/meta-campaign.interface.ts  ← MetaInsightsParams: adiciona since? e until?
  meta-ads.service.ts                    ← suporte a time_range (since/until) no fetchInsights

src/app.module.ts                        ← nenhuma alteração esperada (CsvModule é importado localmente)
```

## 5. Contrato de API

### POST /campaign-reports/insights/export/csv

| Campo      | Valor                                                          |
|------------|----------------------------------------------------------------|
| Método     | `POST`                                                         |
| Path       | `/campaign-reports/insights/export/csv`                        |
| Auth       | `x-api-key`                                                    |
| Body DTO   | `ExportInsightsCsvDto`                                         |
| Resposta   | `200 text/csv` — arquivo CSV como string plana                 |
| Headers    | `Content-Type: text/csv; charset=utf-8`                        |
|            | `Content-Disposition: attachment; filename="insights_<adAccountId>_<período>.csv"` |

> `<período>` = valor do `datePreset` (ex.: `last_30d`) ou `<since>_<until>` (ex.: `2025-11-01_2025-11-30`).

**Exemplo 1 — colunas específicas + datePreset:**

```json
{
  "adAccountId": "act_123456789",
  "datePreset": "last_30d",
  "level": "campaign",
  "columns": ["campaign_name", "date_start", "date_stop", "impressions", "spend", "ctr", "cpc"]
}
```

**Exemplo 2 — todas as colunas + intervalo customizado:**

```json
{
  "adAccountId": "act_123456789",
  "since": "2025-11-01",
  "until": "2025-11-30",
  "level": "campaign"
}
```

> `columns` ausente → exporta todas. `datePreset` ausente + `since`/`until` presentes → usa intervalo customizado.

**Exemplo de resposta (CSV):**

```
Campanha,Início,Fim,Impressões,Cliques,Investimento,CTR,CPC
"Black Friday 2025","01/11/2025","30/11/2025","125.430","3.210","R$ 4.850,00","2,56%","R$ 1,51"
"Natal 2025","01/12/2025","25/12/2025","98.700","2.105","R$ 3.200,00","2,13%","R$ 1,52"
```

## 6. Entidade (PostgreSQL)

Sem nova entidade. O endpoint consome dados em tempo real da Meta API (com cache Redis existente).

## 7. Cache (Redis)

Reutiliza as chaves de cache existentes do `CampaignReportsService`:

| Tipo de período  | Chave de cache                                                     |
|------------------|--------------------------------------------------------------------|
| `datePreset`     | `meta:insights:{adAccountId}:{level}:{datePreset}` (já existente) |
| `since` / `until`| `meta:insights:{adAccountId}:{level}:since:{since}:until:{until}` (nova) |

- TTL: `INSIGHTS_CACHE_TTL_SECONDS` (já configurável)
- O export **não** cria chave própria — consome o mesmo cache de `getInsights`.
- Cada página do cursor loop tem sua chave com sufixo `:cursor:{cursor}` (já implementado).
- Cache customizado (`since`/`until`) é invalidado pelo mesmo TTL; não há invalidação manual.

## 8. Interface do Service

```typescript
interface ICampaignReportsService {
  // métodos existentes ...
  exportInsightsCsv(dto: ExportInsightsCsvDto): Promise<string>;
  // retorna a string CSV completa; o controller define os headers de resposta
}
```

## 9. DTOs, Enums e Mapeamento de Colunas

### `MetaInsightsColumn` enum

```typescript
export enum MetaInsightsColumn {
  // Identificação
  CAMPAIGN_ID   = 'campaign_id',
  CAMPAIGN_NAME = 'campaign_name',

  // Período
  DATE_START = 'date_start',
  DATE_STOP  = 'date_stop',

  // Volume
  IMPRESSIONS    = 'impressions',
  CLICKS         = 'clicks',
  REACH          = 'reach',
  FREQUENCY      = 'frequency',
  UNIQUE_CLICKS  = 'unique_clicks',

  // Financeiro
  SPEND                  = 'spend',
  CPM                    = 'cpm',
  CPC                    = 'cpc',
  COST_PER_UNIQUE_CLICK  = 'cost_per_unique_click',

  // Taxas
  CTR = 'ctr',

  // Conversão / ROAS
  PURCHASE_ROAS    = 'purchase_roas',    // extraído de purchase_roas[].value
  LINK_CLICKS      = 'link_clicks',      // extraído de actions[action_type=link_click]
  LANDING_PAGE_VIEWS = 'landing_page_views', // extraído de actions[action_type=landing_page_view]
  LEADS            = 'leads',            // extraído de actions[action_type=lead]
  PURCHASES        = 'purchases',        // extraído de actions[action_type=purchase]

  // Vídeo
  VIDEO_PLAYS   = 'video_plays',         // extraído de video_play_actions[].value (soma)
  VIDEO_P25     = 'video_p25',           // video_p25_watched_actions
  VIDEO_P50     = 'video_p50',
  VIDEO_P75     = 'video_p75',
  VIDEO_P100    = 'video_p100',

  // Breakdowns (presentes apenas quando breakdowns solicitado)
  AGE                = 'age',
  GENDER             = 'gender',
  COUNTRY            = 'country',
  REGION             = 'region',
  PUBLISHER_PLATFORM = 'publisher_platform',
  DEVICE_PLATFORM    = 'device_platform',
}
```

### Mapeamento de colunas → tipo de formatação

| Coluna                     | Label CSV               | Tipo           | Exemplo formatado     |
|----------------------------|-------------------------|----------------|-----------------------|
| `campaign_id`              | ID da Campanha          | `text`         | `123456789`           |
| `campaign_name`            | Campanha                | `text`         | `"Black Friday"`      |
| `date_start`               | Início                  | `date`         | `01/11/2025`          |
| `date_stop`                | Fim                     | `date`         | `30/11/2025`          |
| `impressions`              | Impressões              | `count`        | `125.430`             |
| `clicks`                   | Cliques                 | `count`        | `3.210`               |
| `reach`                    | Alcance                 | `count`        | `98.700`              |
| `frequency`                | Frequência              | `decimal`      | `1,87`                |
| `unique_clicks`            | Cliques Únicos          | `count`        | `2.105`               |
| `spend`                    | Investimento            | `monetary`     | `R$ 4.850,00`         |
| `cpm`                      | CPM                     | `monetary`     | `R$ 12,50`            |
| `cpc`                      | CPC                     | `monetary`     | `R$ 1,51`             |
| `cost_per_unique_click`    | Custo/Clique Único      | `monetary`     | `R$ 2,30`             |
| `ctr`                      | CTR                     | `percentage`   | `2,56%`               |
| `purchase_roas`            | ROAS                    | `decimal`      | `3,20`                |
| `link_clicks`              | Cliques no Link         | `count`        | `1.500`               |
| `landing_page_views`       | Visualiz. de Página     | `count`        | `1.200`               |
| `leads`                    | Leads                   | `count`        | `320`                 |
| `purchases`                | Compras                 | `count`        | `85`                  |
| `video_plays`              | Reproduções de Vídeo    | `count`        | `5.000`               |
| `video_p25`                | Vídeo 25%               | `count`        | `3.200`               |
| `video_p50`                | Vídeo 50%               | `count`        | `2.100`               |
| `video_p75`                | Vídeo 75%               | `count`        | `1.400`               |
| `video_p100`               | Vídeo 100%              | `count`        | `800`                 |
| `age`                      | Faixa Etária            | `text`         | `25-34`               |
| `gender`                   | Gênero                  | `text`         | `female`              |
| `country`                  | País                    | `text`         | `BR`                  |
| `region`                   | Região                  | `text`         | `São Paulo`           |
| `publisher_platform`       | Plataforma              | `text`         | `instagram`           |
| `device_platform`          | Dispositivo             | `text`         | `mobile`              |

**Regras de formatação:**

- `monetary` → `R$ #.###,##` (locale `pt-BR`, duas casas decimais)
- `percentage` → `#,##%` (multiplica por 1 — Meta já entrega em %, ex: `"2.56"` → `"2,56%"`)
- `count` → `#.###` (inteiro com separador de milhar)
- `decimal` → `#,##` (duas casas, sem símbolo)
- `date` → `DD/MM/YYYY`
- `text` → sem transformação; envolve em aspas se contiver vírgula ou quebra de linha

**Campos ausentes:** se a coluna solicitada não existe no objeto `MetaInsights` retornado
(ex.: coluna de breakdown sem o breakdown ativado), o valor é `"-"`.

### `ExportInsightsCsvDto`

```typescript
@ValidateIf((o) => !!o.since || !!o.until, { message: 'since e until não podem ser usados junto com datePreset' })
export class ExportInsightsCsvDto {
  @ApiProperty({ example: 'act_123456789' })
  @IsString()
  @IsNotEmpty()
  adAccountId: string;

  // ── Colunas ──────────────────────────────────────────────────────────────
  @ApiPropertyOptional({
    type: [String],
    enum: MetaInsightsColumn,
    isArray: true,
    description: 'Colunas a exportar. Quando ausente, exporta todas.',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(MetaInsightsColumn, { each: true })
  @ArrayMaxSize(30)
  columns?: MetaInsightsColumn[];
  // quando undefined o service usa Object.values(MetaInsightsColumn) como fallback

  // ── Período (modos mutuamente exclusivos) ─────────────────────────────────
  @ApiPropertyOptional({
    enum: MetaDatePreset,
    default: MetaDatePreset.LAST_30D,
    description: 'Preset de período. Mutuamente exclusivo com since/until.',
  })
  @IsOptional()
  @IsEnum(MetaDatePreset)
  @ValidateIf((o) => !o.since && !o.until)
  datePreset?: MetaDatePreset;
  // default aplicado no service: se nem datePreset nem since/until → LAST_30D

  @ApiPropertyOptional({
    example: '2025-11-01',
    description: 'Data inicial do intervalo customizado (YYYY-MM-DD). Requer until.',
  })
  @IsOptional()
  @IsDateString()
  @ValidateIf((o) => !o.datePreset)
  since?: string;

  @ApiPropertyOptional({
    example: '2025-11-30',
    description: 'Data final do intervalo customizado (YYYY-MM-DD). Requer since.',
  })
  @IsOptional()
  @IsDateString()
  @ValidateIf((o) => !o.datePreset)
  until?: string;

  // ── Demais filtros ────────────────────────────────────────────────────────
  @ApiPropertyOptional({ enum: MetaInsightsLevel, default: MetaInsightsLevel.CAMPAIGN })
  @IsOptional()
  @IsEnum(MetaInsightsLevel)
  level?: MetaInsightsLevel = MetaInsightsLevel.CAMPAIGN;

  @ApiPropertyOptional({ enum: MetaTimeIncrement })
  @IsOptional()
  @IsEnum(MetaTimeIncrement)
  timeIncrement?: MetaTimeIncrement;

  @ApiPropertyOptional({ example: 'age,gender' })
  @IsOptional()
  @IsString()
  breakdowns?: string;
}
```

### Validação de exclusividade mútua `datePreset` ↔ `since`/`until`

A validação ocorre em dois níveis:
1. **class-validator** — `@ValidateIf` impede que `since`/`until` sejam validados quando
   `datePreset` está presente, e vice-versa.
2. **Service** — se ambos chegarem preenchidos (bypass de validação), o service lança
   `BadRequestException('Informe datePreset OU since+until, não ambos')`.
3. **since sem until (ou vice-versa)** — o service lança
   `BadRequestException('since e until devem ser informados juntos')`.

### Extensão de `MetaInsightsParams`

```typescript
// interfaces/meta-campaign.interface.ts — campos adicionados
export interface MetaInsightsParams {
  datePreset?: MetaDatePreset;  // torna opcional (era obrigatório)
  since?: string;               // novo — YYYY-MM-DD
  until?: string;               // novo — YYYY-MM-DD
  level?: MetaInsightsLevel;
  timeIncrement?: MetaTimeIncrement;
  breakdowns?: string;
}
```

`MetaAdsService.fetchInsights` envia `time_range={ since, until }` à Marketing API quando
`since`/`until` estiverem presentes; caso contrário, envia `date_preset` como hoje.

## 10. Critérios de Aceitação (BDD)

```gherkin
Feature: Exportação de insights de campanhas em CSV

  Scenario: Exportação com colunas específicas e datePreset
    Given adAccountId "act_123" com insights válidos na Meta API
    And token de acesso válido no AdAccountsService
    When POST /campaign-reports/insights/export/csv
      """
      { "adAccountId": "act_123", "datePreset": "last_30d",
        "columns": ["campaign_name", "impressions", "spend", "ctr"] }
      """
    Then retorna 200 com Content-Type "text/csv; charset=utf-8"
    And Content-Disposition contém filename="insights_act_123_last_30d.csv"
    And a primeira linha do CSV é "Campanha,Impressões,Investimento,CTR"
    And os valores monetários estão no formato "R$ 1.234,56"
    And os percentuais estão no formato "2,56%"
    And os contadores estão no formato "125.430"

  Scenario: Exportação sem informar columns exporta todas as colunas
    Given adAccountId "act_123" com insights válidos
    When POST /campaign-reports/insights/export/csv sem o campo "columns"
    Then retorna 200
    And o header da primeira linha contém todas as colunas não-breakdown do enum
    And nenhum campo de breakdown aparece (breakdowns não foi solicitado)

  Scenario: Exportação sem columns com breakdowns ativados inclui colunas de breakdown
    When POST com body { "adAccountId": "act_123", "breakdowns": "age,gender" } (sem columns)
    Then o header do CSV inclui também "Faixa Etária" e "Gênero"

  Scenario: Exportação com intervalo customizado (since/until)
    When POST /campaign-reports/insights/export/csv
      """
      { "adAccountId": "act_123", "since": "2025-11-01", "until": "2025-11-30" }
      """
    Then retorna 200
    And Content-Disposition contém filename="insights_act_123_2025-11-01_2025-11-30.csv"
    And a Meta API é chamada com time_range={ since: "2025-11-01", until: "2025-11-30" }
    And o cache usa chave "meta:insights:act_123:campaign:since:2025-11-01:until:2025-11-30"

  Scenario: since sem until retorna 400
    When POST com body { "adAccountId": "act_123", "since": "2025-11-01" } (sem until)
    Then retorna 400 com mensagem "since e until devem ser informados juntos"

  Scenario: datePreset e since/until juntos retorna 400
    When POST com body { "adAccountId": "act_123", "datePreset": "last_30d", "since": "2025-11-01", "until": "2025-11-30" }
    Then retorna 400 com mensagem "Informe datePreset OU since+until, não ambos"

  Scenario: Sem período informado usa default last_30d
    When POST com body { "adAccountId": "act_123" } (sem datePreset, since, until)
    Then o service usa datePreset "last_30d" internamente
    And Content-Disposition contém filename="insights_act_123_last_30d.csv"

  Scenario: Coluna de breakdown selecionada sem breakdown ativado
    Given insights sem campo "age" (breakdowns não solicitado)
    When columns inclui "age"
    Then a coluna "Faixa Etária" é exibida com valor "-" em todas as linhas

  Scenario: Coluna de ação (purchase_roas) extraída corretamente
    Given insights com purchase_roas: [{ action_type: "omni_purchase", value: "3.20" }]
    When columns inclui "purchase_roas"
    Then o valor formatado é "3,20"

  Scenario: Múltiplas páginas de dados
    Given conta "act_456" com 60 registros de insights (3 páginas de 20)
    When POST /campaign-reports/insights/export/csv
    Then o CSV contém 60 linhas de dados (cursor loop busca todas as páginas)

  Scenario: Reutilização de cache com datePreset
    Given cache Redis "meta:insights:act_123:campaign:last_30d" populado
    When POST /campaign-reports/insights/export/csv para "act_123" / "last_30d"
    Then o service NÃO chama a Meta API (usa cache)

  Scenario: Coluna inválida
    When body contém "columns": ["coluna_inexistente"]
    Then retorna 400 com mensagem de validação sobre enum inválido

  Scenario: adAccountId não encontrado / sem token
    Given nenhum AdAccountEntity para "act_999"
    When POST /campaign-reports/insights/export/csv com adAccountId "act_999"
    Then retorna 404 Not Found

  Scenario: Token de API ausente
    When requisição sem header "x-api-key"
    Then retorna 401 Unauthorized
```

## 11. Definition of Done

### Colunas opcionais
- [ ] `columns` marcado como `@IsOptional()` no DTO (sem `@ArrayMinSize`)
- [ ] Service aplica fallback: `dto.columns ?? Object.values(MetaInsightsColumn)` removendo breakdown columns quando `dto.breakdowns` for ausente

### Período customizado
- [ ] Campos `since` e `until` adicionados ao `ExportInsightsCsvDto` com `@IsDateString()` e `@ValidateIf`
- [ ] Validação de exclusividade mútua `datePreset` ↔ `since`/`until` com `BadRequestException` no service
- [ ] Validação de co-presença: `since` exige `until` e vice-versa
- [ ] `MetaInsightsParams` extendido com `since?` e `until?` (ambos opcionais, `datePreset` torna-se opcional)
- [ ] `MetaAdsService.fetchInsights` envia `time_range` quando `since`/`until` presentes, `date_preset` caso contrário
- [ ] Cache key para intervalo customizado: `meta:insights:{adAccountId}:{level}:since:{since}:until:{until}`
- [ ] Nome do arquivo CSV dinâmico: `insights_act_123_last_30d.csv` ou `insights_act_123_2025-11-01_2025-11-30.csv`

### Core CSV
- [ ] `MetaInsightsColumn` enum criado com todas as colunas documentadas na seção 9
- [ ] `CsvFormatterService` em `src/common/csv/` com método `format(rows, columns): string`
- [ ] `CsvModule` exporta `CsvFormatterService` e é importado em `CampaignReportsModule`
- [ ] `CampaignReportsService.exportInsightsCsv(dto)` faz cursor loop para buscar todas as páginas
- [ ] Controller define `@Header('Content-Type', 'text/csv; charset=utf-8')` e `@Header('Content-Disposition', ...)`
- [ ] Campos de `actions[]` e `purchase_roas[]` extraídos por `action_type` mapeado
- [ ] Valores ausentes (`undefined`/`null`) formatados como `"-"` no CSV

### Testes e documentação
- [ ] Testes unitários de `CsvFormatterService` cobrindo todos os tipos de formatação
- [ ] Testes unitários de `CampaignReportsService.exportInsightsCsv`:
  - columns ausente → fallback para todas as colunas
  - `since`/`until` → cache key correto e `time_range` passado ao MetaAdsService
  - `datePreset` + `since` → `BadRequestException`
  - `since` sem `until` → `BadRequestException`
- [ ] Swagger documentado com `@ApiProduces('text/csv')` e exemplos de body (com e sem `columns`, com `since`/`until`)
- [ ] `CampaignReportsModule` importa `CsvModule`
- [ ] Testes e2e: 200 (com columns, sem columns, com since/until), 400 (conflito, since sem until), 401, 404
