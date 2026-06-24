# Plano de Implementação: Campaign Reports — Exportação CSV

**Spec:** `tasks/specs/campaign_reports_csv_export_spec.md`
**Data:** 2026-06-17

---

## Análise de Alternativas

### Geração do CSV

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| **A (Escolhida)** | Serialização manual com template string | Zero dependência nova; simples para dados tabulares planos; encoding UTF-8 com BOM controlável | Needs manual escaping de aspas/quebras de linha |
| B | `csv-stringify` (npm) | API stream-friendly, escaping automático | Dependência nova; overhead desnecessário para payload não-stream |
| C | `fast-csv` (npm) | Boa performance em volumes altos | Dependência nova; API verbosa para casos simples |

**Decisão:** Alternativa A — os dados de insights são planos (sem arrays aninhados na saída CSV), o volume por exportação é moderado (centenas a poucos milhares de linhas), e evitar nova dependência mantém o projeto enxuto. O escaping de aspas duplas (`"` → `""`) é trivial de implementar.

### Validação de exclusividade mútua `datePreset` ↔ `since`/`until`

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| **A (Escolhida)** | `@ValidateIf` no DTO + guard no service | Erros 400 com mensagens claras; typesafe | Dois pontos de validação (aceitável — service é defesa em profundidade) |
| B | Decorator customizado `@MutuallyExclusive` | Single point of truth | Boilerplate elevado para um único caso de uso |

**Decisão:** Alternativa A — `@ValidateIf` já está disponível via `class-validator` sem nenhum novo decorator; a guarda no service é padrão no projeto (ver `ad-accounts.service.ts` com `ConflictException`).

---

## Recursos Reutilizáveis Identificados

| Recurso | Localização | Como usar |
|---|---|---|
| `ApiKeyGuard` | `src/common/guards/api-key.guard.ts` | `@UseGuards(ApiKeyGuard)` no novo endpoint (igual ao controller existente) |
| `AesCryptoService` | `src/common/crypto/aes.service.ts` | Já injetado em `CampaignReportsService` — `decrypt(account.accessToken)` |
| `buildInsightsCacheKey` | `campaign-reports.service.ts:36` | Estender para suportar `since`/`until` como ramo alternativo ao `datePreset` |
| `insightsTtlMs` getter | `campaign-reports.service.ts:32` | Mesmo TTL para chaves de intervalo customizado |
| `MetaAdsService.fetchInsights` | `campaign-reports/meta-ads.service.ts:51` | Adicionar ramo `time_range` quando `params.since`/`until` presentes |
| `INSIGHTS_FIELDS` constante | `meta-ads.service.ts:14` | Reutilizar na mesma chamada — não muda |
| Padrão `PaginatedResult<T>` | `interfaces/meta-campaign.interface.ts:70` | Cursor loop no novo método do service |

---

## Diagrama de Fluxo

```
POST /campaign-reports/insights/export/csv
    ↓ ApiKeyGuard (x-api-key)
CampaignReportsController.exportCsv()
    ↓ ValidationPipe → ExportInsightsCsvDto
CampaignReportsService.exportInsightsCsv(dto)
    ↓ [guarda] datePreset + since/until → BadRequestException
    ↓ [guarda] since sem until (ou vice-versa) → BadRequestException
    ↓ resolve columns (dto.columns ?? fallback com/sem breakdowns)
    ↓ resolve período (datePreset | since+until → default last_30d)
    ↓ AdAccountsService.findByAdAccountId(adAccountId) → NotFoundException se ausente
    ↓ AesCryptoService.decrypt(account.accessToken)
    ↓ cursor loop:
    │   MetaAdsService.fetchInsights(adAccountId, token, params, cursor?)
    │   ├── Redis cache hit? → retorna página cacheada
    │   └── Meta Marketing API → cacheia → acumula em allRows[]
    │   └── repete até paging.next = undefined
    ↓ CsvFormatterService.format(allRows, resolvedColumns)
    ↓ string CSV completa
Controller seta headers → retorna 200 text/csv
```

---

## Tarefas Sequenciais

### Tarefa 1 — [Enum] Criar `MetaInsightsColumn` e mapeamento de metadados

**Arquivo:** `src/modules/campaign-reports/enums/insights-column.enum.ts`

**O que fazer:**
- Declarar enum `MetaInsightsColumn` com todos os valores da seção 9 da spec.
- Exportar constante `COLUMN_META` do tipo `Record<MetaInsightsColumn, { label: string; type: ColumnType; source?: ... }>` com o mapeamento completo da tabela da spec (label PT-BR, tipo de formatação).
- Declarar tipo auxiliar `ColumnType = 'text' | 'count' | 'monetary' | 'percentage' | 'decimal' | 'date'`.
- Exportar constante `BREAKDOWN_COLUMNS: MetaInsightsColumn[]` listando age, gender, country, region, publisher_platform, device_platform — usada no fallback "todas as colunas".

**Depende de:** nada
**Testável:** compilação sem erro (`npm run build`)

---

### Tarefa 2 — [Interface] Estender `MetaInsightsParams` com `since`/`until`

**Arquivo:** `src/modules/campaign-reports/interfaces/meta-campaign.interface.ts`

**O que fazer:**
- Tornar `datePreset` opcional (`datePreset?: MetaDatePreset`).
- Adicionar `since?: string` e `until?: string`.
- Nenhuma outra interface muda neste arquivo.

**Impacto em código existente:** `MetaAdsService.fetchInsights` passa `params.datePreset` diretamente como `date_preset` — após a mudança, o campo pode ser `undefined`; isso é aceitável porque a Tarefa 3 trata o ramo `since`/`until` antes de usar `date_preset`.

**Depende de:** nada (paralelo com Tarefa 1)
**Testável:** compilação sem erro

---

### Tarefa 3 — [Service Infra] Atualizar `MetaAdsService.fetchInsights` para `time_range`

**Arquivo:** `src/modules/campaign-reports/meta-ads.service.ts`

**O que fazer:**  
Alterar a construção de `params` na chamada HTTP dentro de `fetchInsights` (linha ~62):

```typescript
// antes (simplificado):
date_preset: params.datePreset,

// depois:
...(params.since && params.until
  ? { time_range: JSON.stringify({ since: params.since, until: params.until }) }
  : { date_preset: params.datePreset }),
```

> A Marketing API exige `time_range` como JSON string: `'{"since":"2025-11-01","until":"2025-11-30"}'`.

**Depende de:** Tarefa 2
**Testável:** testes unitários existentes de `meta-ads.service.spec.ts` continuam passando; adicionar caso de teste `since`/`until`.

---

### Tarefa 4 — [DTO + Enum] Criar `ExportInsightsCsvDto`

**Arquivo:** `src/modules/campaign-reports/dto/export-insights-csv.dto.ts`

**O que fazer:**
- Implementar classe conforme spec seção 9, usando `@ValidateIf` para exclusividade mútua.
- Importar `MetaInsightsColumn` da Tarefa 1.
- Importar enums existentes `MetaDatePreset`, `MetaInsightsLevel`, `MetaTimeIncrement` de `get-insights-query.dto.ts`.

**Campos:**
| Campo | Tipo | Obrigatório | Regra |
|---|---|---|---|
| `adAccountId` | `string` | sim | `@IsNotEmpty()` |
| `columns` | `MetaInsightsColumn[]` | não | `@IsOptional`, `@IsArray`, `@IsEnum({each:true})`, `@ArrayMaxSize(30)` |
| `datePreset` | `MetaDatePreset` | não | `@IsOptional`, `@IsEnum`, `@ValidateIf(!since && !until)` |
| `since` | `string` | não | `@IsOptional`, `@IsDateString`, `@ValidateIf(!datePreset)` |
| `until` | `string` | não | `@IsOptional`, `@IsDateString`, `@ValidateIf(!datePreset)` |
| `level` | `MetaInsightsLevel` | não | `@IsOptional`, `@IsEnum` |
| `timeIncrement` | `MetaTimeIncrement` | não | `@IsOptional`, `@IsEnum` |
| `breakdowns` | `string` | não | `@IsOptional`, `@IsString` |

**Depende de:** Tarefa 1
**Testável:** compilação sem erro

---

### Tarefa 5 — [Common] Criar `CsvFormatterService` e `CsvModule`

**Arquivos:**
- `src/common/csv/csv-formatter.service.ts`
- `src/common/csv/csv-formatter.service.spec.ts`
- `src/common/csv/csv.module.ts`

**O que fazer no `CsvFormatterService`:**

```typescript
// Assinatura pública
format(rows: MetaInsights[], columns: MetaInsightsColumn[]): string
```

Internamente:
1. Gera linha de cabeçalho usando `COLUMN_META[col].label` (da Tarefa 1).
2. Para cada `row`, mapeia cada coluna chamando `extractValue(row, col)` → valor raw.
3. `extractValue` lida com:
   - Campos simples: `row[col]` (impressions, clicks, spend…)
   - Campos de `actions[]`: procura `action_type` mapeado fixo:
     ```
     link_clicks       → actions[link_click]
     landing_page_views→ actions[landing_page_view]
     leads             → actions[lead]
     purchases         → actions[purchase]
     ```
   - `purchase_roas` → `purchase_roas[omni_purchase]`
   - Métricas de vídeo: `video_play_actions`, `video_p25_watched_actions`, etc.
   - Campo ausente/undefined → `"-"`
4. Aplica formatação via `formatValue(raw, type)`:
   - `monetary` → `new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(raw))`
   - `percentage` → `${Number(raw).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
   - `count` → `Math.round(Number(raw)).toLocaleString('pt-BR')`
   - `decimal` → `Number(raw).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`
   - `date` → `new Date(raw).toLocaleDateString('pt-BR')` — ou parse manual `YYYY-MM-DD` → `DD/MM/YYYY` para evitar timezone shift
   - `text` → envolve em aspas se contém `,` ou `\n`; escapa `"` interno como `""`
5. Serializa cada linha como `valores.join(',')`, linhas unidas por `\r\n` (padrão RFC 4180).
6. Prefixa com BOM UTF-8 (`﻿`) para compatibilidade com Excel.

**Testes unitários (`csv-formatter.service.spec.ts`):**
- Formata `monetary` corretamente (`"4850"` → `"R$ 4.850,00"`)
- Formata `percentage` (`"2.56"` → `"2,56%"`)
- Formata `count` (`"125430"` → `"125.430"`)
- Formata `date` (`"2025-11-01"` → `"01/11/2025"`)
- Valor ausente → `"-"`
- Texto com vírgula envolto em aspas
- Extrai `link_clicks` de `actions[]`
- Extrai `purchase_roas` de array
- Cabeçalho na primeira linha

**Depende de:** Tarefa 1
**Testável:** `npx jest --testPathPattern=csv-formatter`

---

### Tarefa 6 — [Service] Implementar `exportInsightsCsv` em `CampaignReportsService`

**Arquivo:** `src/modules/campaign-reports/campaign-reports.service.ts`

**O que fazer:**

```typescript
async exportInsightsCsv(dto: ExportInsightsCsvDto): Promise<string> {
  // 1. Guardas de período
  if (dto.datePreset && (dto.since || dto.until)) throw BadRequestException(...)
  if (dto.since && !dto.until || !dto.since && dto.until) throw BadRequestException(...)

  // 2. Resolve colunas
  const columns = this.resolveColumns(dto.columns, dto.breakdowns)

  // 3. Resolve período
  const period = this.resolvePeriod(dto)

  // 4. Busca conta e token
  const account = await this.adAccountsService.findByAdAccountId(dto.adAccountId)
  if (!account.isActive) throw UnprocessableEntityException(...)
  const token = this.crypto.decrypt(account.accessToken)

  // 5. Cursor loop — coleta todas as páginas
  const allRows: MetaInsights[] = []
  let cursor: string | undefined
  do {
    const cacheKey = this.buildExportCacheKey(dto.adAccountId, period, dto.level, dto.timeIncrement, dto.breakdowns, cursor)
    let page = await this.cache.get<PaginatedResult<MetaInsights>>(cacheKey)
    if (!page) {
      const result = await this.metaAdsService.fetchInsights(dto.adAccountId, token, { ...period, level: dto.level, timeIncrement: dto.timeIncrement, breakdowns: dto.breakdowns }, cursor)
      page = { data: result.data, paging: { next: result.paging?.cursors?.after } }
      await this.cache.set(cacheKey, page, this.insightsTtlMs)
    }
    allRows.push(...page.data)
    cursor = page.paging.next
  } while (cursor)

  // 6. Formata CSV
  return this.csvFormatter.format(allRows, columns)
}

private resolveColumns(columns?: MetaInsightsColumn[], breakdowns?: string): MetaInsightsColumn[] {
  if (columns?.length) return columns
  const activeBreakdowns = breakdowns ? breakdowns.split(',').map(s => s.trim()) : []
  return Object.values(MetaInsightsColumn).filter(col =>
    !BREAKDOWN_COLUMNS.includes(col) || activeBreakdowns.includes(col)
  )
}

private resolvePeriod(dto: ExportInsightsCsvDto): Pick<MetaInsightsParams, 'datePreset' | 'since' | 'until'> {
  if (dto.since && dto.until) return { since: dto.since, until: dto.until }
  return { datePreset: dto.datePreset ?? MetaDatePreset.LAST_30D }
}

private buildExportCacheKey(adAccountId: string, period: ..., level?: ..., ti?: ..., bd?: ..., cursor?: string): string {
  const periodPart = period.since
    ? `since:${period.since}:until:${period.until}`
    : period.datePreset
  return this.buildInsightsCacheKey(
    `meta:insights:${adAccountId}:${level ?? MetaInsightsLevel.CAMPAIGN}:${periodPart}`,
    cursor, ti, bd
  )
}
```

**Injetar `CsvFormatterService`** no construtor de `CampaignReportsService`.

**Atualizar `ICampaignReportsService`** com `exportInsightsCsv(dto: ExportInsightsCsvDto): Promise<string>`.

**Depende de:** Tarefas 3, 4 e 5
**Testável:** testes unitários (Tarefa 7)

---

### Tarefa 7 — [Controller] Adicionar endpoint `POST /insights/export/csv`

**Arquivo:** `src/modules/campaign-reports/campaign-reports.controller.ts`

**O que fazer:**

```typescript
@Post('insights/export/csv')
@ApiOperation({ summary: 'Exporta insights em CSV' })
@ApiProduces('text/csv')
@ApiBody({ type: ExportInsightsCsvDto })
async exportCsv(
  @Body() dto: ExportInsightsCsvDto,
  @Res() res: Response,
): Promise<void> {
  const csv = await this.campaignReportsService.exportInsightsCsv(dto)
  const period = dto.since ? `${dto.since}_${dto.until}` : (dto.datePreset ?? 'last_30d')
  const filename = `insights_${dto.adAccountId}_${period}.csv`
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(csv)
}
```

> Usar `@Res() res: Response` do Express para controle total dos headers.  
> Importar `Response` de `'express'` e `Res` de `'@nestjs/common'`.

**Depende de:** Tarefa 6
**Testável:** `npm run start:dev` + curl/Postman

---

### Tarefa 8 — [Module] Importar `CsvModule` em `CampaignReportsModule`

**Arquivo:** `src/modules/campaign-reports/campaign-reports.module.ts`

**O que fazer:**
- Importar `CsvModule` de `../../common/csv/csv.module.js`.
- `CsvModule` deve estar na lista `imports` do módulo.
- `CsvFormatterService` é fornecido pelo `CsvModule` e injetável em `CampaignReportsService`.

**Depende de:** Tarefa 5
**Testável:** `npm run start:dev` sem erros de injeção

---

### Tarefa 9 — [Testes Unitários] `CsvFormatterService`

**Arquivo:** `src/common/csv/csv-formatter.service.spec.ts`

**Cenários obrigatórios:**
- `monetary`: `"4850.50"` → `"R$ 4.850,50"`
- `percentage`: `"2.56"` → `"2,56%"`
- `count`: `"125430"` → `"125.430"`
- `decimal`: `"3.20"` → `"3,20"`
- `date`: `"2025-11-01"` → `"01/11/2025"`
- Campo `undefined`/`null` → `"-"`
- Texto com vírgula → envolvido em aspas duplas
- `link_clicks` extraído de `actions[action_type=link_click]`
- `purchase_roas` extraído de `purchase_roas[omni_purchase]`
- `video_plays` extraído de `video_play_actions`
- Cabeçalho gerado na primeira linha com labels PT-BR
- BOM UTF-8 como primeiro caractere

**Depende de:** Tarefa 5
**Testável:** `npx jest --testPathPattern=csv-formatter`

---

### Tarefa 10 — [Testes Unitários] `CampaignReportsService.exportInsightsCsv`

**Arquivo:** `src/modules/campaign-reports/campaign-reports.service.spec.ts`

**Cenários a adicionar:**
- `columns` ausente → `resolveColumns` retorna todas sem breakdowns
- `columns` ausente + `breakdowns: 'age'` → inclui coluna `age`
- `since`/`until` → cache key contém `since:...:until:...`; `MetaAdsService` chamado com `time_range`
- `datePreset` + `since` → lança `BadRequestException`
- `since` sem `until` → lança `BadRequestException`
- Cursor loop: mock retorna 2 páginas → `allRows` acumula os dois lotes
- Cache hit na segunda chamada → `MetaAdsService` não chamado de novo

**Depende de:** Tarefa 6
**Testável:** `npx jest --testPathPattern=campaign-reports.service`

---

### Tarefa 11 — [Testes] Atualizar `meta-ads.service.spec.ts`

**Arquivo:** `src/modules/campaign-reports/meta-ads.service.spec.ts`

**Cenários a adicionar:**
- `fetchInsights` com `since`/`until` → params HTTP contém `time_range` (JSON string) e **não** `date_preset`
- `fetchInsights` sem `since`/`until` → params HTTP contém `date_preset` e **não** `time_range`
- Testes existentes continuam passando sem modificação

**Depende de:** Tarefa 3
**Testável:** `npx jest --testPathPattern=meta-ads.service`

---

## Ordem de Execução (com paralelismo)

```
Tarefa 1 ──┬── Tarefa 4 ──┐
           │               ↓
Tarefa 2 ──┴── Tarefa 3 ── Tarefa 6 ── Tarefa 7 ── Tarefa 8
                           ↑           ↓
Tarefa 5 ──────────────────┘        Tarefa 10
           ↓
        Tarefa 9
Tarefa 3 → Tarefa 11
```

**Tarefas 1 e 2** podem ser feitas em paralelo (sem dependências mútuas).  
**Tarefa 5** pode ser desenvolvida em paralelo com as Tarefas 2–4.  
**Tarefas 9 e 11** podem ser feitas em paralelo após suas respectivas dependências.

---

## Estimativa

| # | Tarefa | Complexidade | Estimativa |
|---|---|---|---|
| 1 | Enum + mapeamento COLUMN_META | Baixa | 20 min |
| 2 | Estender MetaInsightsParams | Baixa | 10 min |
| 3 | MetaAdsService time_range | Baixa | 20 min |
| 4 | ExportInsightsCsvDto | Baixa | 25 min |
| 5 | CsvFormatterService + CsvModule | **Alta** | 1h–1h30 |
| 6 | exportInsightsCsv no Service | **Alta** | 1h–1h30 |
| 7 | Controller endpoint | Baixa | 20 min |
| 8 | CampaignReportsModule (CsvModule) | Baixa | 10 min |
| 9 | Testes unitários CsvFormatterService | Média | 45 min |
| 10 | Testes unitários exportInsightsCsv | Média | 45 min |
| 11 | Testes MetaAdsService time_range | Baixa | 20 min |
| **Total** | | | **~6–7 horas** |

---

## Riscos e Dependências

### Risco 1 — `time_range` na Meta Marketing API (médio)
A API exige o parâmetro como **JSON string** (`'{"since":"...","until":"..."}'`), não como objeto.
Validar contra a documentação antes de implementar a Tarefa 3. Testar com uma conta real se
possível — erros de formato retornam `400` da Meta com mensagem obscura.

### Risco 2 — Timezone em datas da Meta API (baixo)
Os campos `date_start`/`date_stop` chegam como `"YYYY-MM-DD"` (string pura, sem timezone).
Usar parse manual (`split('-')`) em vez de `new Date(str)` para evitar off-by-one ao
converter para `DD/MM/YYYY` em ambientes com timezone negativo (UTC-3 BRT).

### Risco 3 — Injeção de `CsvFormatterService` em `CampaignReportsService` (baixo)
`CampaignReportsService` já tem 5 injeções no construtor. A adição de `CsvFormatterService`
é trivial, mas o módulo precisa importar `CsvModule` (Tarefa 8) antes de `npm run start:dev`
funcionar.

### Risco 4 — `@Res()` desabilita interceptors do NestJS (baixo, conhecido)
Usar `@Res()` no controller desabilita o `ClassSerializerInterceptor` global se houver um.
Checar `main.ts` — o projeto não usa esse interceptor globalmente, então sem impacto.

### Risco 5 — Cursor loop sem limite de páginas (médio)
Contas com volume muito alto podem ter dezenas de páginas. O loop deve ter um limite de
segurança (ex.: `MAX_PAGES = 50`) com log de warning se atingido, para evitar timeout
ou consumo excessivo da API da Meta.
