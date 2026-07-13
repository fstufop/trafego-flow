# Plano de Implementação: WhatsApp Weekly Reports

**Spec:** `tasks/specs/whatsapp_weekly_reports_spec.md`
**Data:** 2026-07-03

---

## Análise de Alternativas

### Persistência da sessão Baileys

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| **A (Escolhida)** | `useMultiFileAuthState` apontando para diretório temporário em disco; `creds.update` re-encripta e persiste em `whatsapp_sessions` no banco | Simples, compatível 100% com a API Baileys, sem reimplementar o state handler | Requer diretório gravável no servidor; ao reiniciar, rehidrata do banco para o disco antes de conectar |
| B | Implementar `AuthenticationState` customizado lendo/gravando diretamente no banco | Sem disco; state totalmente encapsulado | API interna do Baileys instável entre versões, alto risco de quebra em atualizações |
| C | `useMultiFileAuthState` puro (sem banco) | Mínimo código | Credenciais perdem-se em deploys stateless (Cloud Run); sem backup |

**Decisão:** Alternativa A — hidratação do banco → disco no startup, e persistência banco no `creds.update`. Seguro, compatível e funciona em Cloud Run com volume efêmero ou diretório `/tmp`.

---

### Nível de agregação do relatório (Meta Insights)

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| **A (Escolhida)** | `level = account`, `datePreset = last_7d`, soma todos os campos no serviço | Um único registro agregado por conta; simples de formatar | Não detalha por campanha |
| B | `level = campaign`, agregar no código | Visibilidade por campanha | Múltiplos registros, lógica de soma extra, mensagem mais longa |

**Decisão:** Alternativa A — o relatório semanal é um resumo executivo; nível de conta é suficiente nesta fase.

---

### `MetaDatePreset` para "semana passada"

`MetaDatePreset` não tem `last_week`. O enum existente tem apenas `last_7d` (7 dias corridos) e `last_month`.

| Alternativa | Descrição |
|---|---|
| **A (Escolhida)** | Computar `since` / `until` (segunda a domingo anteriores) dinamicamente no `ReportDispatchesService` |
| B | Usar `last_7d` (7 dias corridos) | Simples, mas não é "segunda a domingo" |

**Decisão:** Alternativa A — o relatório é "semana passada" (Seg-Dom), então calcular as datas corretas dá mais precisão e contexto ao cliente.

---

## Recursos Reutilizáveis Identificados

| Recurso | Localização | Uso |
|---|---|---|
| `ApiKeyGuard` | `src/common/guards/api-key.guard.ts` | Todos os controllers novos |
| `AesCryptoService` | `src/common/crypto/aes.service.ts` | Encriptar `credsJson` da sessão Baileys |
| `CryptoModule` | `src/common/crypto/crypto.module.ts` | Importar no `WhatsAppSessionModule` |
| `BaseEntity` | `src/common/database/base.entity.ts` | Herdar nas 3 novas entities |
| `AdAccountsService` | `src/modules/ad-accounts/` | Buscar contas ativas por `clientId` (já exportado) |
| `CampaignReportsService` | `src/modules/campaign-reports/` | Buscar insights — **precisa ser exportado** (ver T0) |
| `ScheduleModule` | já registrado globalmente | `@Cron` no scheduler |
| `CACHE_MANAGER` | global via `CacheModule` | Cache de grupos e status da sessão |

---

## Diagrama de Fluxo

```
Cron toda Segunda 08h BRT
    ↓
ReportDispatchSchedulerService.dispatchWeeklyReports()
    ↓
ReportDispatchesService.triggerAll()
    ├── WhatsAppGroupsService.findAllActiveGroupedByClient()
    ├── AdAccountsService.findAll(clientId)          ← por cliente
    ├── CampaignReportsService.getInsights(           ← por conta
    │       adAccountId, { level: account, since, until })
    ├── formatReportText(insights, client, account)
    ├── WhatsAppSessionService.sendMessage(groupJid, text)
    │       └── sock.sendMessage() via Baileys
    └── ReportDispatchLogRepository.save({ status: sent | failed })

POST /report-dispatches/trigger
    ↓ ApiKeyGuard
    ↓ ValidationPipe (TriggerDispatchDto)
ReportDispatchesController
    ↓
ReportDispatchesService.triggerForClient(dto)
    └── [mesmo fluxo acima, filtrado por clientId]

GET /whatsapp-session/status
    ↓ ApiKeyGuard
WhatsAppSessionController
    ↓
WhatsAppSessionService.getStatus()
    ├── cache hit → { connected, qrCode? }
    └── cache miss → lê estado em memória do BaileysService

POST /whatsapp-groups
    ↓ ApiKeyGuard → ValidationPipe → WhatsAppGroupsController
    ↓
WhatsAppGroupsService.create(dto)
    ├── QueryFailedError 23505 → ConflictException
    ├── cache.set(`whatsapp:groups:client:{clientId}`)
    └── WhatsAppGroupEntity salvo no banco
```

---

## Tarefas Sequenciais

### T0 — [Pré-requisito] Exportar `CampaignReportsService`
**Arquivo:** `src/modules/campaign-reports/campaign-reports.module.ts`
**O que fazer:** Adicionar `CampaignReportsService` ao array `exports` do módulo. Necessário para que `ReportDispatchesModule` possa injetá-lo.
**Depende de:** nada
**Testável:** `npm run build` sem erro

---

### T1 — [Setup] Instalar dependências NPM
**Comando:**
```bash
npm install @whiskeysockets/baileys pino qrcode
npm install --save-dev @types/qrcode
```
**O que fazer:** Instalar Baileys (ESM, compatível com NodeNext), pino (logger requerido pelo Baileys) e qrcode (para geração do QR base64).
**Depende de:** nada
**Risco:** Baileys usa ESM puro. Com `"moduleResolution": "NodeNext"` já configurado, o import direto deve funcionar. Validar se o `package.json` do projeto tem `"type": "module"` — se sim, ok; se não, pode precisar de import dinâmico.
**Testável:** `npm run build` sem erro

---

### T2 — [Config] Adicionar variável `WHATSAPP_DEDICATED_PHONE`
**Arquivos:**
- `src/config/configuration.ts` — adicionar `WHATSAPP_DEDICATED_PHONE` ao `validationSchema` como `Joi.string().required()`
- `src/config/app.config.ts` (ou criar `src/config/whatsapp.config.ts`) — expor `whatsapp.dedicatedPhone`
- `.env.example` — documentar a variável
**O que fazer:** Registrar e validar a env var do número dedicado usado na sessão Baileys.
**Depende de:** nada (paralelo com T1)
**Testável:** `npm run start:dev` valida o schema sem lançar erro (com a var no `.env`)

---

### T3 — [Migration] Criar tabelas `whatsapp_groups`, `whatsapp_sessions`, `report_dispatch_logs`
**Arquivo:** `src/database/migrations/<timestamp>-CreateWhatsAppTables.ts`
**O que fazer:** Uma única migration com as três tabelas. Campos conforme spec seção 6. Índice único em `whatsapp_groups.group_jid`. FK de `client_id` em `whatsapp_groups` e `report_dispatch_logs`.
**Depende de:** T1, T2
**Testável:** `npm run migration:run` sem erro

---

### T4 — [Entity] `WhatsAppGroupEntity`
**Arquivo:** `src/modules/whatsapp-groups/entities/whatsapp-group.entity.ts`
```typescript
@Entity('whatsapp_groups')
export class WhatsAppGroupEntity extends BaseEntity {
  @Column({ name: 'client_id' })          clientId: string;
  @ManyToOne(() => ClientEntity)
  @JoinColumn({ name: 'client_id' })      client: ClientEntity;
  @Column({ name: 'group_jid', unique: true }) groupJid: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) label: string | null;
  @Column({ default: true })              isActive: boolean;
}
```
**Depende de:** T3
**Testável:** compilação sem erro

---

### T5 — [Entity] `WhatsAppSessionEntity`
**Arquivo:** `src/modules/whatsapp-session/entities/whatsapp-session.entity.ts`
```typescript
@Entity('whatsapp_sessions')
export class WhatsAppSessionEntity extends BaseEntity {
  @Column({ name: 'phone_number' })       phoneNumber: string;
  @Exclude()
  @Column({ name: 'creds_json', type: 'text', nullable: true }) credsJson: string | null;
  @Column({ name: 'is_connected', default: false }) isConnected: boolean;
  @Column({ name: 'last_connected_at', type: 'timestamptz', nullable: true }) lastConnectedAt: Date | null;
}
```
**Depende de:** T3
**Testável:** compilação sem erro

---

### T6 — [Entity] `ReportDispatchLogEntity`
**Arquivo:** `src/modules/report-dispatches/entities/report-dispatch-log.entity.ts`
```typescript
export enum DispatchStatus { SENT = 'sent', FAILED = 'failed' }

@Entity('report_dispatch_logs')
export class ReportDispatchLogEntity extends BaseEntity {
  @Column({ name: 'client_id' })          clientId: string;
  @Column({ name: 'group_jid' })          groupJid: string;
  @Column({ name: 'ad_account_id' })      adAccountId: string;
  @Column({ name: 'week_start_date', type: 'date' }) weekStartDate: Date;
  @Column({ type: 'enum', enum: DispatchStatus }) status: DispatchStatus;
  @Column({ name: 'error_message', type: 'text', nullable: true }) errorMessage: string | null;
  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true }) sentAt: Date | null;
}
```
**Depende de:** T3
**Testável:** compilação sem erro

---

### T7 — [DTOs + Interface] WhatsApp Groups
**Arquivos:**
- `src/modules/whatsapp-groups/dto/create-whatsapp-group.dto.ts`
- `src/modules/whatsapp-groups/dto/update-whatsapp-group.dto.ts`
- `src/modules/whatsapp-groups/interfaces/whatsapp-groups-service.interface.ts`

**DTOs:** conforme spec seção 9 — `@Matches(/^\d+@g\.us$/)` no `groupJid`, `@IsUUID()` no `clientId`.
**Interface:**
```typescript
export interface IWhatsAppGroupsService {
  create(dto: CreateWhatsAppGroupDto): Promise<WhatsAppGroupEntity>;
  findAll(clientId: string): Promise<WhatsAppGroupEntity[]>;
  findOne(id: string): Promise<WhatsAppGroupEntity>;
  update(id: string, dto: UpdateWhatsAppGroupDto): Promise<WhatsAppGroupEntity>;
  remove(id: string): Promise<void>;
}
```
**Depende de:** T4
**Testável:** compilação sem erro

---

### T8 — [DTOs + Interface] WhatsApp Session
**Arquivos:**
- `src/modules/whatsapp-session/interfaces/whatsapp-session-service.interface.ts`

```typescript
export interface IWhatsAppSessionService {
  getStatus(): Promise<{ connected: boolean; qrCode?: string }>;
  sendMessage(groupJid: string, text: string): Promise<void>;
  reconnect(): Promise<void>;
}
```
**Depende de:** T5
**Testável:** compilação sem erro

---

### T9 — [DTOs + Interface] Report Dispatches
**Arquivos:**
- `src/modules/report-dispatches/dto/trigger-dispatch.dto.ts`
- `src/modules/report-dispatches/interfaces/report-dispatches-service.interface.ts`

```typescript
// TriggerDispatchDto
@IsOptional() @IsUUID()       clientId?: string;
@IsOptional() @IsISO8601()    weekStartDate?: string;

// IReportDispatchesService
triggerForClient(dto: TriggerDispatchDto): Promise<{ dispatched: number; failed: number }>;
triggerAll(): Promise<void>;
findLogs(clientId: string): Promise<ReportDispatchLogEntity[]>;
```
**Depende de:** T6
**Testável:** compilação sem erro

---

### T10 — [Service] `WhatsAppGroupsService`
**Arquivo:** `src/modules/whatsapp-groups/whatsapp-groups.service.ts`

**Lógica:**
- `create`: salva, detecta 23505 → ConflictException, invalida cache do cliente
- `findAll(clientId)`: cache `whatsapp:groups:client:{clientId}` TTL 300s; busca `{ clientId, isActive: true }`
- `findOne(id)`: cache `whatsapp:group:id:{id}` TTL 300s; NotFoundException se não encontrado
- `update`: atualiza, invalida caches
- `remove`: softRemove, invalida caches

**Depende de:** T4, T7
**Testável:** testes unitários com repositório mockado

---

### T11 — [Service] `WhatsAppSessionService` (BaileysService)
**Arquivo:** `src/modules/whatsapp-session/whatsapp-session.service.ts`

**Implementa `OnApplicationBootstrap`:**
```
onApplicationBootstrap()
  1. Busca WhatsAppSessionEntity pelo phoneNumber (config)
  2. Se credsJson existe: descriptografa, escreve em /tmp/wa-session/creds.json
  3. Chama useMultiFileAuthState('/tmp/wa-session')
  4. makeWASocket({ auth: state, logger: pino({ level: 'silent' }) })
  5. Subscreve 'connection.update':
     - qr → gera base64 com qrcode.toDataURL(), armazena em this.currentQr
     - open → this.isConnected = true, persiste no banco, limpa this.currentQr
     - close (não loggedOut) → reconnect com backoff exponencial (max 5 tentativas)
  6. Subscreve 'creds.update':
     - saveCreds() → encripta → upsert WhatsAppSessionEntity
```

**`getStatus()`:** retorna `{ connected: this.isConnected, qrCode?: this.currentQr }`

**`sendMessage(groupJid, text)`:**
- Verifica `this.isConnected`; se false, lança `ServiceUnavailableException`
- `await this.sock.sendMessage(groupJid, { text })`

**`reconnect()`:** reinicia o socket com backoff.

**Depende de:** T5, T8, T1
**Testável:** unitário com mock do socket; integração manual via QR

---

### T12 — [Service] `ReportDispatchesService`
**Arquivo:** `src/modules/report-dispatches/report-dispatches.service.ts`

**Método central `buildAndSend(client, adAccount, groups, weekStart)`:**
```typescript
1. Calcula since = weekStart (segunda), until = weekStart + 6 dias (domingo)
2. Chama campaignReportsService.getInsights(adAccountId, { level: account, since, until })
3. Agrega: soma spend, impressions, clicks de todos os registros retornados
4. Formata o texto (ReportFormatter helper inline)
5. Para cada group: sendMessage(groupJid, text) → log sent
   Catch: log failed + errorMessage
```

**`triggerForClient(dto)`:**
- clientId passado → filtra; weekStartDate passado → usa; senão calcula última segunda
- Retorna `{ dispatched, failed }`

**`triggerAll()`:**
- Busca todos os clientes distintos em `whatsapp_groups` com `isActive = true`
- Itera, chama `buildAndSend` para cada cliente/conta/grupo com delay 5–15s entre grupos

**`findLogs(clientId)`:** retorna logs ordenados por `createdAt DESC`

**Depende de:** T6, T9, T10, T11, T0
**Testável:** testes unitários com mocks de `WhatsAppGroupsService`, `AdAccountsService`, `CampaignReportsService`, `WhatsAppSessionService`

---

### T13 — [Service] `ReportDispatchSchedulerService`
**Arquivo:** `src/modules/report-dispatches/report-dispatch-scheduler.service.ts`

```typescript
@Injectable()
export class ReportDispatchSchedulerService {
  constructor(private readonly reportDispatchesService: ReportDispatchesService) {}

  @Cron('0 8 * * 1', { timeZone: 'America/Sao_Paulo' })
  async handleWeeklyCron() {
    await this.reportDispatchesService.triggerAll();
  }
}
```

**Depende de:** T12
**Testável:** unitário mockando `ReportDispatchesService`; integração via `/report-dispatches/trigger`

---

### T14 — [Controller] `WhatsAppGroupsController`
**Arquivo:** `src/modules/whatsapp-groups/whatsapp-groups.controller.ts`

Segue o padrão de `AdAccountsController`:
- `@UseGuards(ApiKeyGuard)` na classe
- `POST /` → `create(@Body() dto: CreateWhatsAppGroupDto)` → 201
- `GET /?clientId=` → `findAll(@Query('clientId', ParseUUIDPipe))` → 200
- `PATCH /:id` → `update(@Param('id', ParseUUIDPipe), @Body())` → 200
- `DELETE /:id` → `remove(@Param('id', ParseUUIDPipe))` → 204

**Depende de:** T10
**Testável:** testes e2e

---

### T15 — [Controller] `WhatsAppSessionController`
**Arquivo:** `src/modules/whatsapp-session/whatsapp-session.controller.ts`

- `@UseGuards(ApiKeyGuard)` na classe
- `GET /whatsapp-session/status` → `getStatus()` → 200

**Depende de:** T11
**Testável:** compilação; teste manual

---

### T16 — [Controller] `ReportDispatchesController`
**Arquivo:** `src/modules/report-dispatches/report-dispatches.controller.ts`

- `@UseGuards(ApiKeyGuard)` na classe
- `POST /report-dispatches/trigger` → `triggerForClient(@Body())` → 200
- `GET /report-dispatches?clientId=` → `findLogs(@Query('clientId', ParseUUIDPipe))` → 200

**Depende de:** T12
**Testável:** testes e2e

---

### T17 — [Module] `WhatsAppGroupsModule`
**Arquivo:** `src/modules/whatsapp-groups/whatsapp-groups.module.ts`

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([WhatsAppGroupEntity])],
  controllers: [WhatsAppGroupsController],
  providers: [WhatsAppGroupsService],
  exports: [WhatsAppGroupsService],
})
```

**Depende de:** T14
**Testável:** `npm run start:dev` sem erro de injeção

---

### T18 — [Module] `WhatsAppSessionModule`
**Arquivo:** `src/modules/whatsapp-session/whatsapp-session.module.ts`

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([WhatsAppSessionEntity]), CryptoModule],
  controllers: [WhatsAppSessionController],
  providers: [WhatsAppSessionService],
  exports: [WhatsAppSessionService],
})
```

**Nota:** `WhatsAppSessionService` deve ser `@Global()` ou o módulo deve ser global para garantir singleton do socket Baileys — definir `@Global()` no módulo.

**Depende de:** T15
**Testável:** `npm run start:dev` sem erro de injeção; QR exibido no log se sem sessão

---

### T19 — [Module] `ReportDispatchesModule`
**Arquivo:** `src/modules/report-dispatches/report-dispatches.module.ts`

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([ReportDispatchLogEntity]),
    WhatsAppGroupsModule,
    WhatsAppSessionModule,
    AdAccountsModule,
    CampaignReportsModule,
  ],
  controllers: [ReportDispatchesController],
  providers: [ReportDispatchesService, ReportDispatchSchedulerService],
})
```

**Depende de:** T16, T13, T17, T18

---

### T20 — [App] Registrar os 3 módulos em `app.module.ts`
**Arquivo:** `src/app.module.ts`
**O que fazer:** Importar `WhatsAppGroupsModule`, `WhatsAppSessionModule`, `ReportDispatchesModule`.
**Depende de:** T17, T18, T19
**Testável:** `npm run start:dev` sobe sem erro

---

### T21 — [Testes] Unitários `WhatsAppGroupsService`
**Arquivo:** `src/modules/whatsapp-groups/whatsapp-groups.service.spec.ts`

Cenários:
- `create` retorna entidade salva
- `create` com JID duplicado lança ConflictException
- `findAll` retorna do cache na segunda chamada
- `findOne` lança NotFoundException para id inexistente
- `remove` chama softRemove e invalida cache

**Depende de:** T10
**Testável:** `npm run test`

---

### T22 — [Testes] Unitários `ReportDispatchesService`
**Arquivo:** `src/modules/report-dispatches/report-dispatches.service.spec.ts`

Cenários:
- `triggerForClient` com sessão conectada → dispatched = N, failed = 0
- `triggerForClient` com sessão desconectada → dispatched = 0, failed = N, log salvo com errorMessage
- `triggerForClient` sem `weekStartDate` → usa a última segunda-feira
- `findLogs` retorna lista ordenada

**Depende de:** T12
**Testável:** `npm run test`

---

### T23 — [Testes] E2E `WhatsAppGroupsController`
**Arquivo:** `test/whatsapp-groups.e2e-spec.ts`

Cenários:
- `POST /whatsapp-groups` com body válido → 201
- `POST /whatsapp-groups` com `groupJid = "abc"` → 400
- `POST /whatsapp-groups` sem API key → 401
- `GET /whatsapp-groups?clientId=<uuid>` → 200 com array
- `DELETE /whatsapp-groups/:id` → 204

**Depende de:** T14
**Testável:** `npm run test:e2e`

---

## Ordem de Execução Recomendada

```
T0 (exportar CampaignReportsService)
  ↓
T1 + T2 (paralelos: npm install + config env)
  ↓
T3 (migration)
  ↓
T4 + T5 + T6 (paralelos: entities)
  ↓
T7 + T8 + T9 (paralelos: DTOs + interfaces)
  ↓
T10 (WhatsAppGroupsService)
T11 (WhatsAppSessionService — Baileys)   ← mais complexo, isolar
T12 (ReportDispatchesService)            ← depende de T10 e T11
T13 (ReportDispatchSchedulerService)
  ↓
T14 + T15 + T16 (paralelos: controllers)
  ↓
T17 + T18 (paralelos: modules groups + session)
  ↓
T19 (ReportDispatchesModule)
  ↓
T20 (app.module.ts)
  ↓
T21 + T22 + T23 (paralelos: testes)
```

---

## Estimativa

| Tarefa | Descrição | Complexidade | Estimativa |
|---|---|---|---|
| T0 | Export CampaignReportsService | Baixa | 5 min |
| T1 | npm install | Baixa | 10 min |
| T2 | Config env var | Baixa | 15 min |
| T3 | Migration 3 tabelas | Baixa | 30 min |
| T4–T6 | 3 entities | Baixa | 30 min |
| T7–T9 | DTOs + interfaces | Baixa | 40 min |
| T10 | WhatsAppGroupsService | Média | 45 min |
| T11 | WhatsAppSessionService (Baileys) | **Alta** | 2–3h |
| T12 | ReportDispatchesService | **Alta** | 2h |
| T13 | ReportDispatchSchedulerService | Baixa | 20 min |
| T14–T16 | 3 controllers | Média | 1h |
| T17–T19 | 3 modules | Baixa | 30 min |
| T20 | app.module.ts | Baixa | 5 min |
| T21–T23 | Testes (unit + e2e) | Média | 2h |
| **Total** | | | **~11–12h** |

---

## Riscos e Dependências

### Riscos Técnicos

| Risco | Probabilidade | Mitigação |
|---|---|---|
| **Baileys ESM vs NodeNext**: alguma dependência transitiva usa `require()` e quebra | Média | Verificar `package.json` do Baileys; usar `import()` dinâmico se necessário |
| **Banimento do número**: volume baixo mas padrão mecânico detectável | Baixa | Delay aleatório 5–15s entre grupos; variação de horário em ±15 min com `Math.random()` |
| **Sessão Baileys expira**: WhatsApp força novo login periodicamente | Média | `reconnect()` automático + alerta via log; endpoint `/status` para monitorar |
| **`last_7d` vs período exato**: Meta API pode não retornar exatamente Seg-Dom | Baixa | Usar `since`/`until` com datas calculadas (conforme decisão T12) |
| **Cloud Run stateless**: `/tmp` é efêmero mas persiste durante a instância | Baixa | Rehidratação do banco sempre no `onApplicationBootstrap` |

### Dependências Externas

- Meta Marketing API — campo `spend` retornado como string (`"123.45"`), conversão necessária na formatação
- `@whiskeysockets/baileys` ≥ 6.x — verificar changelog antes de instalar (API pode diferir de exemplos na spec)
- `qrcode` ≥ 1.x — para `toDataURL()` que retorna `data:image/png;base64,...`

### Módulo que precisa ser modificado (além dos novos)

- `src/modules/campaign-reports/campaign-reports.module.ts` — adicionar `exports: [CampaignReportsService]` (T0)

### Variáveis de ambiente a adicionar

```
WHATSAPP_DEDICATED_PHONE="+5511999999999"   # número dedicado para a sessão Baileys
```
