# Documentação: WhatsApp Weekly Reports

**Data:** 2026-07-03
**Tipo:** Módulo Novo
**Arquivos analisados:**
- `src/modules/whatsapp-groups/` (entity, service, controller, DTOs, interface)
- `src/modules/whatsapp-session/` (entity, service, controller, interface)
- `src/modules/report-dispatches/` (entity, service, scheduler, controller, DTOs, interface)
- `src/database/migrations/1780000000000-CreateWhatsAppTables.ts`
- `src/database/migrations/1780000000001-AddUniquePhoneToWhatsAppSessions.ts`
- `src/config/whatsapp.config.ts`
- `docs/whatsapp-relatorios-setup.md`

---

## Visão Geral

A feature automatiza o envio de relatórios semanais de performance de Meta Ads para grupos de WhatsApp dos clientes. A cada segunda-feira às 08h (BRT), o sistema busca os insights da semana anterior via Meta Graph API e envia uma mensagem formatada em cada grupo cadastrado. O envio usa Baileys — automação de WhatsApp Web via protocolo multi-device — com um número dedicado separado do atendimento principal.

---

## Contexto Multi-tenant

- **Dados isolados por cliente (`clientId`):** grupos de WhatsApp, contas de anúncio, logs de despacho
- **Dados globais:** sessão Baileys (`whatsapp_sessions`) — existe exatamente **uma** sessão para o número dedicado de toda a plataforma; não é por tenant

---

## Arquitetura: 3 Módulos Interdependentes

```
                          ┌─────────────────────────────┐
                          │   WhatsAppSessionModule      │  @Global()
                          │   (singleton Baileys socket) │
                          └──────────────┬──────────────┘
                                         │ sendMessage()
              ┌──────────────────────────▼──────────────────────────┐
              │              ReportDispatchesModule                   │
              │  ┌─────────────────────┐  ┌────────────────────────┐ │
              │  │ ReportDispatches    │  │ ReportDispatch         │ │
              │  │ Service             │  │ SchedulerService       │ │
              │  │ (orchestration)     │  │ @Cron segunda 08h BRT  │ │
              │  └──────┬──────────────┘  └────────────────────────┘ │
              └─────────┼────────────────────────────────────────────┘
                        │
         ┌──────────────┼────────────────────┐
         │              │                    │
         ▼              ▼                    ▼
  WhatsApp        CampaignReports      AdAccounts
  GroupsService   Service              Service
  (CRUD grupos)   (Meta Insights API)  (contas de anúncio)
```

---

## Fluxo de Dados

### Disparo automático (cron)

```
Segunda-feira 08h BRT
    ↓ @Cron('0 8 * * 1', { timeZone: 'America/Sao_Paulo' })
ReportDispatchSchedulerService.handleWeeklyCron()
    ↓
ReportDispatchesService.triggerAll()
    ↓ findAllActiveGroupedByClientId() → Map<clientId, grupos[]>
    ↓ adAccountsService.findAll(clientId) — por cliente
    ↓ campaignReportsService.getInsights(adAccountId, { level: 'account', since, until })
    ↓ aggregateInsights(rows) — soma spend/impressões/cliques, recalcula CTR e CPM
    ↓ formatReportText() / formatErrorText()
    ↓ [per group] whatsAppSessionService.sendMessage(groupJid, text)
    ↓ logRepo.save({ status: 'sent' | 'failed' })
    ↓ randomDelay() — 5-15s entre grupos
```

### Disparo manual

```
POST /api/v1/report-dispatches/trigger
    ↓ ApiKeyGuard
ReportDispatchesController.trigger(dto)
    ↓ TriggerDispatchDto { clientId?: uuid, weekStartDate?: ISO8601 }
ReportDispatchesService.triggerForClient(dto)
    ↓ (mesmo fluxo acima, filtrando por clientId se fornecido)
← { dispatched: N, failed: N }
```

### Inicialização da sessão Baileys

```
App bootstrap
    ↓ OnApplicationBootstrap
WhatsAppSessionService.onApplicationBootstrap()
    ↓ startSocket()
    ↓ hydrateSessionDir() — decripta credsJson do DB → /tmp/wa-session/creds.json
    ↓ makeWASocket({ auth: state, printQRInTerminal: false })
    ↓ on 'qr': requestPairingCode(digits) → loga código ABCD-1234
    ↓ on 'connection open': persistConnectionStatus(true), upsert DB
    ↓ on 'creds.update': saveCreds() → persistCreds() → AesCrypto.encrypt → upsert DB
    ↓ on 'connection close (not loggedOut)': scheduleReconnect() — backoff exponencial
```

---

## Regras de Negócio Identificadas

### RN-01: Semana de referência é sempre a semana anterior, nunca a atual
**Onde no código:** `report-dispatches.service.ts:253-261` — `getLastMonday()`
**Descrição:** O cron roda na segunda-feira da semana atual. Para calcular a semana do relatório, subtrai `diff + 7` dias do UTC atual, garantindo que o `since` seja a segunda-feira da semana passada (não a de hoje).
**Condição:** Sempre que `weekStartDate` não for fornecido manualmente no `trigger` endpoint.

### RN-02: CTR e CPM são recalculados a partir dos totais agregados
**Onde no código:** `report-dispatches.service.ts:198-199`
**Descrição:** Em vez de fazer média de CTR/CPM por linha da API, soma spend, impressões e cliques individualmente e recalcula: `CTR = (clicks/impressions) * 100`, `CPM = (spend/impressions) * 1000`. Isso produz valores corretos quando há múltiplos conjuntos de anúncios ou campanhas.
**Condição:** Sempre que `rows.length > 0` em `aggregateInsights()`.

### RN-03: Falha na busca de insights não bloqueia o envio
**Onde no código:** `report-dispatches.service.ts:100-106`
**Descrição:** Se `campaignReportsService.getInsights()` lançar exceção, `insights` permanece `null` e o serviço envia `formatErrorText()` — uma mensagem de aviso sem métricas. O grupo ainda recebe a mensagem, e o log registra `status: sent`.
**Condição:** Qualquer erro na chamada à Meta API (token expirado, rate limit, erro de rede).

### RN-04: groupJid aceita dois formatos de JID de grupo WhatsApp
**Onde no código:** `dto/create-whatsapp-group.dto.ts:8`
**Descrição:** A regex `^\d+(-\d+)?@g\.us$` aceita tanto o formato novo (`120363000000@g.us`) quanto o legado com hífen (`553199999999-1499800546@g.us`). O formato legado usa `telefone-timestamp@g.us`.
**Condição:** Validação no `POST /whatsapp-groups`.

### RN-05: Delay aleatório entre envios para reduzir detecção de automação
**Onde no código:** `report-dispatches.service.ts:267-270`
**Descrição:** Entre o envio para cada grupo há um delay de 5-15 segundos gerado por `randomDelay()`. Evita padrão de envio simultâneo que o WhatsApp identifica como bot.
**Condição:** Sempre entre envios de grupos na mesma execução de dispatch.

### RN-06: Sessão Baileys é persistida criptografada no banco
**Onde no código:** `whatsapp-session.service.ts:138-152`
**Descrição:** A cada `creds.update`, as credenciais do Baileys são lidas de `/tmp/wa-session/creds.json`, criptografadas com `AesCryptoService` e upsertadas na tabela `whatsapp_sessions` por `phone_number`. Na inicialização, o processo inverso restaura a sessão sem exigir novo emparelhamento.
**Condição:** Toda vez que o Baileys atualiza credenciais (conexão, rotação de chave).

### RN-07: Máximo de 5 tentativas de reconexão com backoff exponencial
**Onde no código:** `whatsapp-session.service.ts:178-187`
**Descrição:** Em caso de desconexão não intencional (sem `loggedOut`), o socket tenta reconectar com delay `min(1000 * 2^n, 30000)ms` — 1s, 2s, 4s, 8s, 16s. Após 5 falhas, para e loga erro.
**Condição:** `connection close` com `statusCode !== DisconnectReason.loggedOut`.

### RN-08: Soft delete em grupos de WhatsApp
**Onde no código:** `whatsapp-groups.service.ts:68-72`
**Descrição:** `remove()` chama `repo.softRemove()` — o registro permanece no banco com `deletedAt` preenchido, mas `findAll()` e `findAllActiveGroupedByClientId()` filtram por `isActive: true`. Histórico de despachos mantém a referência.
**Condição:** `DELETE /whatsapp-groups/:id`.

### RN-09: Um grupo (groupJid) é global — não pode ser cadastrado para dois clientes
**Onde no código:** `whatsapp-group.entity.ts:14` — `unique: true` em `groupJid`
**Descrição:** A unicidade é no nível de banco. `create()` captura o erro PostgreSQL `23505` e lança `ConflictException`. Um grupo de WhatsApp físico pertence a um único cliente.

---

## Endpoints Expostos

### `whatsapp-session`

| Método | Path | Guard | Resposta |
|--------|------|-------|----------|
| `GET` | `/whatsapp-session/status` | ApiKeyGuard | `{ connected: bool, qrCode?: string, pairingCode?: string }` |
| `GET` | `/whatsapp-session/pairing-code` | ApiKeyGuard | `{ pairingCode: string }` |
| `GET` | `/whatsapp-session/groups` | ApiKeyGuard | `[{ jid, subject, participantCount }]` |

### `whatsapp-groups`

| Método | Path | Guard | DTO | Resposta |
|--------|------|-------|-----|----------|
| `POST` | `/whatsapp-groups` | ApiKeyGuard | `CreateWhatsAppGroupDto` | `WhatsAppGroupEntity` (201) |
| `GET` | `/whatsapp-groups?clientId=` | ApiKeyGuard | — | `WhatsAppGroupEntity[]` |
| `PATCH` | `/whatsapp-groups/:id` | ApiKeyGuard | `UpdateWhatsAppGroupDto` | `WhatsAppGroupEntity` |
| `DELETE` | `/whatsapp-groups/:id` | ApiKeyGuard | — | 204 |

### `report-dispatches`

| Método | Path | Guard | DTO | Resposta |
|--------|------|-------|-----|----------|
| `POST` | `/report-dispatches/trigger` | ApiKeyGuard | `TriggerDispatchDto` | `{ dispatched: N, failed: N }` (200) |
| `GET` | `/report-dispatches?clientId=` | ApiKeyGuard | — | `ReportDispatchLogEntity[]` |

---

## Entidades PostgreSQL

### `whatsapp_groups`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid (PK) | Identificador único |
| `client_id` | varchar | FK → `clients.id` |
| `group_jid` | varchar (UNIQUE) | JID do grupo no WhatsApp |
| `label` | varchar(200) | Rótulo descritivo (opcional) |
| `is_active` | boolean | Se o grupo está ativo para envios |
| `created_at` | timestamptz | — |
| `updated_at` | timestamptz | — |
| `deleted_at` | timestamptz | Soft delete |

### `whatsapp_sessions`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid (PK) | — |
| `phone_number` | varchar (UNIQUE) | Número dedicado com DDI (+55...) |
| `creds_json` | text | Credenciais Baileys criptografadas com AES |
| `is_connected` | boolean | Estado atual da sessão |
| `last_connected_at` | timestamptz | Último `connection: open` |

### `report_dispatch_logs`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid (PK) | — |
| `client_id` | varchar | Cliente dono do relatório |
| `group_jid` | varchar | Grupo destino |
| `ad_account_id` | varchar | Conta de anúncio usada |
| `week_start_date` | date | Segunda-feira da semana do relatório |
| `status` | enum(sent, failed) | Resultado do envio |
| `error_message` | text | Detalhe do erro (se `failed`) |
| `sent_at` | timestamptz | Momento do envio bem-sucedido |

---

## Estratégia de Cache Redis

Módulo `whatsapp-groups`:

| Chave | TTL | Quando invalida |
|-------|-----|-----------------|
| `whatsapp:group:id:{id}` | 300s | update / remove |
| `whatsapp:groups:client:{clientId}` | 300s | create / update / remove |

Módulos `whatsapp-session` e `report-dispatches` não usam cache Redis.

---

## Variáveis de Ambiente

| Variável | Descrição | Obrigatório | Exemplo |
|----------|-----------|-------------|---------|
| `WHATSAPP_DEDICATED_PHONE` | Número dedicado com DDI | Sim (sem isso a sessão é desativada) | `+5511999999999` |
| `WHATSAPP_SESSION_DIR` | Diretório para credenciais Baileys | Não (default: `/tmp/wa-session`) | `/app/wa-session` |

---

## Dependências Externas

- **`@whiskeysockets/baileys`** — automação WhatsApp Web multi-device (ESM-only; importado via `import()` dinâmico para compatibilidade com CJS)
- **`pino`** — logger required pelo Baileys (também ESM; mesmo padrão de import dinâmico)
- **Meta Graph API** — via `CampaignReportsService` existente; endpoint `/{adAccountId}/insights` com parâmetros `level=account`, `since`, `until`
- **AesCryptoService** (interno) — encriptação das credenciais Baileys no banco

### Módulos NestJS importados

- `WhatsAppSessionModule` → `WhatsAppGroupsModule` → `ReportDispatchesModule` (nesta ordem em `app.module.ts`)
- `WhatsAppSessionModule` é `@Global()` — expõe `WhatsAppSessionService` sem precisar importar o módulo explicitamente
- `CampaignReportsModule` exporta `CampaignReportsService` para injeção em `ReportDispatchesModule`
- `AdAccountsModule` exporta `AdAccountsService` para injeção em `ReportDispatchesModule`
- `ScheduleModule` (já registrado) — suporta o `@Cron` no scheduler

---

## Critérios de Aceitação

```gherkin
Feature: WhatsApp Weekly Reports

  Scenario: Emparelhamento do número dedicado
    Given WHATSAPP_DEDICATED_PHONE configurado no .env
    And servidor iniciado
    When o QR é gerado internamente pelo Baileys
    Then requestPairingCode() é chamado automaticamente
    And um código de 8 caracteres (ABCD-1234) aparece no log
    And GET /whatsapp-session/pairing-code retorna { pairingCode: "ABCD-1234" }

  Scenario: Sessão persiste entre reinicializações
    Given sessão já emparelhada (credsJson salvo no banco)
    When o servidor é reiniciado
    Then hydrateSessionDir() restaura /tmp/wa-session/creds.json
    And WhatsApp conecta sem novo emparelhamento

  Scenario: Cadastrar grupo de cliente
    Given clientId UUID válido existente
    And groupJid no formato 120363XXXXXX@g.us ou 553199999999-1499800546@g.us
    When POST /whatsapp-groups com body válido
    Then retorna 201 com o grupo criado
    And cache whatsapp:groups:client:{clientId} é invalidado

  Scenario: Rejeitar groupJid com formato inválido
    When POST /whatsapp-groups com groupJid "grupo-teste"
    Then retorna 400 com mensagem de validação

  Scenario: Disparo semanal automático
    Given segunda-feira às 08h BRT
    And existem clientes com grupos ativos e contas de anúncio ativas
    When cron executa handleWeeklyCron()
    Then insights da semana anterior são buscados na Meta API
    And mensagem formatada é enviada para cada grupo
    And cada envio é registrado em report_dispatch_logs

  Scenario: Fallback quando Meta API falha
    Given conta de anúncio com token expirado
    When cron executa ou trigger é chamado
    Then mensagem de aviso (formatErrorText) é enviada ao grupo
    And log registra status: sent (não failed — a mensagem chegou)

  Scenario: Disparo manual para cliente específico
    When POST /report-dispatches/trigger { "clientId": "UUID" }
    Then apenas os grupos e contas desse cliente são processados
    And retorna { dispatched: N, failed: N }

  Scenario: Disparo manual com semana específica
    When POST /report-dispatches/trigger { "weekStartDate": "2026-06-23" }
    Then insights do período 2026-06-23 a 2026-06-29 são buscados

  Scenario: Reconexão automática após queda
    Given sessão conectada
    When conexão cai por instabilidade de rede
    Then scheduleReconnect() tenta reconectar com backoff exponencial
    And após 5 falhas loga erro e para
```

---

## Dívida Técnica e Pontos de Atenção

1. **Baileys viola ToS do WhatsApp** — risco real de banimento do número dedicado, especialmente se o volume escalar além de 30 grupos/semana. Monitorar e ter plano B de envio manual.

2. **`/tmp/wa-session` perde estado em reinicializações de container** — em produção com Docker/Cloud Run, usar volume persistente ou definir `WHATSAPP_SESSION_DIR` em path montado. Do contrário, toda reinicialização exige novo emparelhamento.

3. **Sem deduplicação de envio** — se o cron executar duas vezes na mesma semana (e.g., por bug de scheduler), dois relatórios idênticos serão enviados. Não há verificação de `report_dispatch_logs` antes do envio.

4. **`triggerForClient` usa `findAllActiveGroupedByClientId()` (sem cache) mesmo para dispatch de cliente único** — busca todos os grupos ativos globalmente só para filtrar pelo `clientId`. Em escala maior, considerar query direta por `clientId`.

5. **`getLastMonday()` usa UTC** — o cron dispara às 08h BRT (UTC-3), então `getLastMonday()` baseado em UTC pode diferir em 3h do horário local. Para relatórios semanais isso é irrelevante (a segunda-feira correta é a mesma), mas é um detalhe a ter em mente.

6. **`loggedOut` reinicia socket imediatamente** — quando o número é deslogado do WhatsApp, `clearSessionDir()` e `startSocket()` são chamados automaticamente, gerando novo QR/pairing code. Isso é correto, mas o operador precisa estar atento aos logs para agir.

7. **Sem rate limiting no endpoint `trigger`** — qualquer client com API key pode disparar relatórios ilimitadas vezes. Em produção, considerar throttle ou flag de execução em andamento.
