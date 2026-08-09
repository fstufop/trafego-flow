# Adset Alerts — Design Spec

**Data:** 2026-08-09  
**Status:** Aprovado

---

## Visão Geral

Tarefa cronológica diária que percorre todos os clientes ativos, busca dados de adsets na API do Meta e dispara uma mensagem consolidada no grupo de managers do WhatsApp toda manhã. A mensagem exibe ROAS e última data de edição por conjunto de anúncios, além de um rodapé com erros encontrados.

---

## Módulos

### `alert-jobs`

Gerencia a configuração dos jobs de alerta.

**`AlertJobEntity`** (tabela `alert_jobs`):

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid | Herdado de `BaseEntity` |
| `type` | enum `AlertJobType` | Tipo do job. Valor inicial: `ADSET_INSIGHTS` |
| `status` | enum `AlertJobStatus` | `ACTIVE` \| `INACTIVE` |
| `clientId` | `varchar` nullable | Nulo = aplica a todos os clientes |
| `fields` | `text[]` | Métricas a exibir. Valor inicial: `['roas', 'last_updated']`. Extensível com `'ctr'`, `'cpm'` no futuro |
| `createdAt`, `updatedAt`, `deletedAt` | timestamps | Herdados de `BaseEntity` |

**`AlertJobsService`:**
- `findAll(filters?)` — lista jobs, filtro opcional por `status` e `type`
- `findActive()` — retorna jobs com `status = ACTIVE`
- `create(dto)` — cria novo job
- `update(id, dto)` — atualiza `status` e/ou `fields`

**`AlertJobsController`** (`/alert-jobs`):

```
GET  /alert-jobs                  → lista jobs (query: ?status, ?type)
POST /alert-jobs                  → cria job
PATCH /alert-jobs/:id             → atualiza status e/ou fields
```

---

### `adset-alerts`

Responsável pela execução diária: busca dados na Meta, formata e envia mensagem, persiste snapshots.

**`AdsetAlertSnapshotEntity`** (tabela `adset_alert_snapshots`):

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | uuid | Herdado de `BaseEntity` |
| `jobId` | varchar | FK lógica para `alert_jobs.id` |
| `clientId` | varchar | ID do cliente |
| `adAccountId` | varchar | ID da conta de anúncios |
| `adsetId` | varchar | ID do conjunto de anúncios |
| `adsetName` | varchar | Nome do conjunto de anúncios |
| `roas` | decimal nullable | ROAS calculado. Nulo quando sem dados de conversão |
| `updatedTime` | date | Última data de edição do adset (`updated_time` da Meta) |
| `sentAt` | timestamptz nullable | Quando a mensagem foi enviada. Nulo se houve falha de envio |
| `createdAt`, `updatedAt`, `deletedAt` | timestamps | Herdados de `BaseEntity` |

**`AdsetAlertsService`:**
- `runForJob(job)` — executa o fluxo completo para um job ativo
- `triggerAll()` — busca todos os jobs ativos e executa `runForJob` para cada um
- `triggerManual()` — mesmo comportamento de `triggerAll()`, sem delay aleatório

**`AdsetAlertSchedulerService`:**
- Cron fixo `30 7 * * *` (timezone: `America/Sao_Paulo`)
- Aguarda delay aleatório de 0–30 minutos antes de chamar `AdsetAlertsService.triggerAll()`
- Estratégia deliberada: simples, sem `SchedulerRegistry`, sem estado persistido entre dias

**`AdsetAlertsController`** (`/adset-alerts`):

```
POST /adset-alerts/trigger        → disparo manual (sem delay aleatório)
```

---

## Fluxo de Execução

```
AdsetAlertSchedulerService (07:30 + random 0–30min)
  └─ AdsetAlertsService.triggerAll()
       └─ AlertJobsService.findActive() → jobs[]
            └─ para cada job:
                 ├─ determina clientes (job.clientId ?? todos com contas ativas)
                 └─ para cada cliente → para cada ad account ativo:
                      ├─ MetaAdsService.fetchAdsets(adAccountId, token)
                      │    → adsets com id, name, updated_time, effective_status
                      └─ para cada adset ATIVO:
                           ├─ MetaAdsService.fetchAdsetInsights(adsetId, token, updated_time, hoje)
                           │    → purchase_roas
                           └─ salva AdsetAlertSnapshotEntity
       └─ agrupa resultados por cliente
       └─ formata mensagem única (dados + erros acumulados)
       └─ WhatsAppSessionService.sendMessage(MANAGERS_GROUP_JID, message)
```

---

## Formato da Mensagem

```
*Nome do cliente*: Marca ABC

*Conjunto de anúncios*: CJ - Retargeting | *ROAS*: 3.42 | *Última atualização*: 05/08/2026
*Conjunto de anúncios*: CJ - Prospecting | *ROAS*: 1.87 | *Última atualização*: 01/08/2026

*Nome do cliente*: Loja XYZ

*Conjunto de anúncios*: CJ - Top of Funnel | *ROAS*: – | *Última atualização*: 03/08/2026

⚠️ *Erros:*
- Marca ZZZ / act_456: token expirado
- Loja XYZ / CJ - Prospecting: sem dados de insights
```

**Regras de formatação:**
- WhatsApp usa `*texto*` para negrito (não `**`)
- ROAS exibido com 2 casas decimais (ex: `3.42`). Quando nulo: `–`
- Data formatada como `DD/MM/YYYY`
- Seção `⚠️ *Erros:*` omitida quando não há falhas
- Clientes sem nenhum adset ativo são silenciosamente ignorados
- Adset "ativo" = `effective_status === 'ACTIVE'`. Adsets com `PAUSED`, `IN_PROCESS`, `WITH_ISSUES`, `DELETED` ou `ARCHIVED` são ignorados

---

## Tratamento de Erros

| Cenário | Comportamento |
|---|---|
| Falha em adset individual | Loga, registra `roas: null` no snapshot, acumula no rodapé da mensagem, continua |
| Falha em ad account | Loga, acumula no rodapé, pula para próximo ad account |
| Falha em cliente inteiro | Loga, acumula no rodapé, pula para próximo cliente |
| Falha no envio da mensagem | Loga o erro; snapshots já persistidos garantem rastreabilidade |

Os erros acumulados são sempre exibidos ao final da **mesma mensagem** enviada ao grupo — não é enviada uma mensagem separada de alerta.

---

## Extensões na API da Meta

Adicionar em `src/modules/campaign-reports/meta-ads.service.ts`:

**`fetchAdsets(adAccountId, token)`**
- Endpoint: `GET /{adAccountId}/adsets`
- Fields: `id,name,updated_time,effective_status`
- Retorna: `MetaAdset[]`

**`fetchAdsetInsights(adsetId, token, since, until)`**
- Endpoint: `GET /{adsetId}/insights`
- Fields: `purchase_roas`
- Params: `time_range: { since, until }`, `level: adset`
- Retorna: `MetaInsights | null` (null quando sem dados no período)
- ROAS extraído como: `parseFloat(result.purchase_roas?.[0]?.value ?? '0')`. Zero é tratado como "sem dados" e persiste como `roas: null` no snapshot

**Nova interface** em `meta-campaign.interface.ts`:

```typescript
export interface MetaAdset {
  id: string;
  name: string;
  updated_time: string; // ISO 8601
  effective_status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED' | 'IN_PROCESS' | 'WITH_ISSUES';
}
```

---

## Testes

**`AdsetAlertsService`** (`adset-alerts.service.spec.ts`):
- Formata mensagem corretamente com múltiplos clientes e adsets
- Exibe `–` quando ROAS é nulo
- Acumula erros no rodapé e omite a seção quando vazia
- Pula cliente inteiro sem ad accounts ativos
- Não lança exceção quando um adset individual falha

**`AlertJobsService`** (`alert-jobs.service.spec.ts`):
- `findActive()` retorna apenas jobs com `status = ACTIVE`
- Job com `clientId` nulo é incluído para qualquer cliente
- Job com `clientId` preenchido é filtrado corretamente

**`AdsetAlertSchedulerService`** (`adset-alert-scheduler.service.spec.ts`):
- Delay gerado está sempre no intervalo 0–30 min
- Chama `AdsetAlertsService.triggerAll()` após o delay

---

## Migrações

Duas migrações TypeORM:

1. `CreateAlertJobsTable` — cria tabela `alert_jobs` com enums `alert_job_type` e `alert_job_status`
2. `CreateAdsetAlertSnapshotsTable` — cria tabela `adset_alert_snapshots`

---

## Contexto para o Dashboard (`trafegoflow-dashboard`)

Ver arquivo: `docs/trafegoflow-dashboard-alert-jobs-context.md`

---

## Fora do Escopo

- Notificação por e-mail ou outros canais
- Filtro por adset individual (granularidade é ad account inteiro)
- Retry automático em caso de falha de envio
- Histórico de execuções exposto via endpoint (os snapshots ficam na DB mas não há endpoint de listagem nesta versão)
