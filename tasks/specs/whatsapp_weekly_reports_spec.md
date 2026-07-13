# Spec: WhatsApp Weekly Reports — Grupos por Cliente

## 1. Objetivo

Automatizar o envio de relatórios semanais de Meta Ads para os grupos de WhatsApp de cada cliente. O sistema busca os dados de performance da semana anterior via Marketing API, formata um resumo e envia para o grupo correspondente toda segunda-feira, usando uma sessão Baileys (WhatsApp Web protocol) com número dedicado.

---

## 2. Contexto Multi-tenant

| Dado | Escopo |
|---|---|
| `WhatsAppGroupEntity` | Por tenant (`clientId`) — cada grupo pertence a um cliente |
| `WhatsAppSessionEntity` | **Global** — há um único número WhatsApp dedicado para todos os envios |
| Métricas Meta Ads | Por tenant (`adAccountId` já isolado por `clientId` via `AdAccountEntity`) |
| Histórico de envios (`ReportDispatchLogEntity`) | Por tenant (`clientId`) |

---

## 3. Descrição Funcional

- **CRUD de grupos**: permite cadastrar, listar, atualizar e remover os grupos de WhatsApp de cada cliente, identificados pelo JID do grupo (ex.: `120363XXXXXX@g.us`).
- **Sessão Baileys**: um serviço singleton gerencia a conexão com o número dedicado, emitindo QR code no startup quando sem sessão, salvando credenciais em banco (tabela `whatsapp_sessions`) e reconectando automaticamente em caso de queda.
- **Job semanal**: toda segunda-feira às 08h (horário de Brasília), o dispatcher itera sobre todos os clientes ativos que possuem grupos cadastrados, gera o relatório semanal de cada conta de anúncio vinculada e envia para cada grupo do cliente com delay aleatório entre os envios (5–15 s).
- **Relatório formatado**: texto com emojis (sem PDF nesta fase), contendo: período, investimento total, impressões, cliques, CTR e CPM. Se o cliente tiver múltiplas contas de anúncio, agrega tudo num único bloco ou envia um bloco por conta.
- **Log de despachos**: registra cada tentativa de envio (status: `sent` | `failed`), mensagem de erro quando aplicável, para auditoria e re-envio manual.
- **Endpoint de disparo manual**: `POST /report-dispatches/trigger` permite forçar o envio de um cliente específico fora do ciclo semanal.
- **Endpoint de status da sessão**: `GET /whatsapp-session/status` retorna se o número está conectado ou aguardando QR.

---

## 4. Estrutura de Arquivos

### Novos arquivos

```
src/modules/whatsapp-groups/
  whatsapp-groups.module.ts
  whatsapp-groups.controller.ts
  whatsapp-groups.service.ts
  whatsapp-groups.service.spec.ts
  dto/
    create-whatsapp-group.dto.ts
    update-whatsapp-group.dto.ts
  entities/
    whatsapp-group.entity.ts
  interfaces/
    whatsapp-groups-service.interface.ts

src/modules/whatsapp-session/
  whatsapp-session.module.ts
  whatsapp-session.controller.ts
  whatsapp-session.service.ts
  whatsapp-session.service.spec.ts
  entities/
    whatsapp-session.entity.ts
  interfaces/
    whatsapp-session-service.interface.ts

src/modules/report-dispatches/
  report-dispatches.module.ts
  report-dispatches.controller.ts
  report-dispatches.service.ts
  report-dispatches.service.spec.ts
  report-dispatch-scheduler.service.ts
  dto/
    trigger-dispatch.dto.ts
  entities/
    report-dispatch-log.entity.ts
  interfaces/
    report-dispatches-service.interface.ts
```

### Arquivos modificados

- `src/app.module.ts` — importar `WhatsAppGroupsModule`, `WhatsAppSessionModule`, `ReportDispatchesModule`
- `src/database/migrations/` — nova migration para as três tabelas

---

## 5. Contrato de API

### WhatsApp Groups

| Campo    | Valor |
|----------|-------|
| Método   | POST |
| Path     | `/whatsapp-groups` |
| Auth     | API Key (`X-Api-Key`) |
| Body DTO | `CreateWhatsAppGroupDto` |
| Resposta | `WhatsAppGroupEntity` (201) |

| Campo    | Valor |
|----------|-------|
| Método   | GET |
| Path     | `/whatsapp-groups?clientId=:clientId` |
| Auth     | API Key |
| Resposta | `WhatsAppGroupEntity[]` (200) |

| Campo    | Valor |
|----------|-------|
| Método   | PATCH |
| Path     | `/whatsapp-groups/:id` |
| Auth     | API Key |
| Body DTO | `UpdateWhatsAppGroupDto` |
| Resposta | `WhatsAppGroupEntity` (200) |

| Campo    | Valor |
|----------|-------|
| Método   | DELETE |
| Path     | `/whatsapp-groups/:id` |
| Auth     | API Key |
| Resposta | `void` (204) |

---

### WhatsApp Session

| Campo    | Valor |
|----------|-------|
| Método   | GET |
| Path     | `/whatsapp-session/status` |
| Auth     | API Key |
| Resposta | `{ connected: boolean; qrCode?: string }` (200) |

> `qrCode` é retornado como string base64 quando a sessão está aguardando pareamento. O operador escaneia uma vez; após isso o campo desaparece.

---

### Report Dispatches

| Campo    | Valor |
|----------|-------|
| Método   | POST |
| Path     | `/report-dispatches/trigger` |
| Auth     | API Key |
| Body DTO | `TriggerDispatchDto` |
| Resposta | `{ dispatched: number; failed: number }` (200) |

| Campo    | Valor |
|----------|-------|
| Método   | GET |
| Path     | `/report-dispatches?clientId=:clientId` |
| Auth     | API Key |
| Resposta | `ReportDispatchLogEntity[]` (200) |

---

## 6. Entidades (PostgreSQL)

```typescript
// whatsapp_groups
@Entity('whatsapp_groups')
class WhatsAppGroupEntity extends BaseEntity {
  clientId: string;            // FK → clients.id
  groupJid: string;            // ex: "120363XXXXXX@g.us" (unique)
  label: string | null;        // nome amigável ex: "Grupo Cliente ABC"
  isActive: boolean;           // default true
}

// whatsapp_sessions
@Entity('whatsapp_sessions')
class WhatsAppSessionEntity extends BaseEntity {
  phoneNumber: string;         // número dedicado, ex: "+5511999999999"
  credsJson: string;           // JSON encriptado das credenciais Baileys (AES)
  isConnected: boolean;        // atualizado pelo BaileysService
  lastConnectedAt: Date | null;
}

// report_dispatch_logs
@Entity('report_dispatch_logs')
class ReportDispatchLogEntity extends BaseEntity {
  clientId: string;            // FK → clients.id
  groupJid: string;            // destino do envio
  adAccountId: string;         // conta de anúncio do relatório
  weekStartDate: Date;         // início da semana coberta (monday)
  status: 'sent' | 'failed';
  errorMessage: string | null;
  sentAt: Date | null;
}
```

---

## 7. Cache (Redis)

| Dado | Chave | TTL | Invalidação |
|---|---|---|---|
| Status da sessão WhatsApp | `whatsapp:session:status` | 30 s | Ao mudar `isConnected` |
| Grupos por cliente | `whatsapp:groups:client:{clientId}` | 300 s | Ao criar/atualizar/remover grupo |
| Relatório semanal já calculado | `weekly-report:{adAccountId}:{weekStartDate}` | 3600 s | Nunca (imutável dentro da semana) |

---

## 8. Interface dos Services

```typescript
interface IWhatsAppGroupsService {
  create(dto: CreateWhatsAppGroupDto): Promise<WhatsAppGroupEntity>;
  findAll(clientId: string): Promise<WhatsAppGroupEntity[]>;
  findOne(id: string): Promise<WhatsAppGroupEntity>;
  update(id: string, dto: UpdateWhatsAppGroupDto): Promise<WhatsAppGroupEntity>;
  remove(id: string): Promise<void>;
}

interface IWhatsAppSessionService {
  getStatus(): Promise<{ connected: boolean; qrCode?: string }>;
  sendMessage(groupJid: string, text: string): Promise<void>;
  reconnect(): Promise<void>;
}

interface IReportDispatchesService {
  triggerForClient(dto: TriggerDispatchDto): Promise<{ dispatched: number; failed: number }>;
  triggerAll(): Promise<void>;                // chamado pelo cron
  findLogs(clientId: string): Promise<ReportDispatchLogEntity[]>;
}
```

---

## 9. DTOs e Validações

```typescript
// CreateWhatsAppGroupDto
class CreateWhatsAppGroupDto {
  @IsUUID()
  clientId: string;

  @IsString()
  @Matches(/^\d+@g\.us$/, { message: 'groupJid deve ter formato numérico@g.us' })
  groupJid: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

// UpdateWhatsAppGroupDto
class UpdateWhatsAppGroupDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// TriggerDispatchDto
class TriggerDispatchDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;           // omitir = dispara para todos os clientes ativos

  @IsOptional()
  @IsISO8601()
  weekStartDate?: string;      // omitir = semana anterior
}
```

---

## 10. Comportamento do BaileysService

```
startup
  └── carrega WhatsAppSessionEntity do banco
        ├── sem registro → emite QR, aguarda scan → salva credsJson
        └── com registro → restaura sessão (useMultiFileAuthState in-memory)
              └── conexão OK → isConnected = true

evento 'connection.update'
  ├── qr emitido → armazena em memória, responde em GET /whatsapp-session/status
  ├── connection = 'open' → isConnected = true, limpa qrCode da memória
  └── connection = 'close' (não loggedOut) → agenda reconexão com backoff

envio de mensagem
  └── sock.sendMessage(groupJid, { text }) com delay aleatório entre grupos
```

Credenciais (`credsJson`) são encriptadas com `AesCryptoService` antes de persistir.

---

## 11. Job Semanal (Cron)

```
@Cron('0 8 * * 1', { timeZone: 'America/Sao_Paulo' })
async dispatchWeeklyReports()
  1. Busca todos os clientes ativos com grupos de WhatsApp ativos
  2. Para cada cliente:
     a. Busca AdAccounts ativos do cliente
     b. Para cada conta: chama CampaignReportsService.getInsights() com datePreset = 'last_week'
     c. Formata o texto do relatório
     d. Para cada WhatsAppGroup do cliente:
         i. Chama WhatsAppSessionService.sendMessage(group.groupJid, texto)
         ii. Aguarda delay aleatório 5–15 s
         iii. Registra ReportDispatchLog (status: sent | failed)
```

### Formato do relatório (texto)

```
📊 *Relatório Semanal — [Nome do Cliente]*
📅 Semana: [dd/MM] a [dd/MM/yyyy]
💼 Conta: [accountName]

💰 Investimento: R$ X.XXX,XX
👁 Impressões: X.XXX.XXX
🖱 Cliques: X.XXX
📈 CTR: X,XX%
💵 CPM: R$ XX,XX

_Enviado automaticamente por TráfegoFlow_
```

---

## 12. Critérios de Aceitação (BDD)

```gherkin
Feature: Cadastro de grupos de WhatsApp

  Scenario: Cadastrar grupo com sucesso
    Given existe um cliente com id válido
    When faço POST /whatsapp-groups com clientId e groupJid válidos
    Then retorna 201 com o grupo criado

  Scenario: JID com formato inválido
    Given existe um cliente com id válido
    When faço POST /whatsapp-groups com groupJid = "abc123"
    Then retorna 400 com mensagem de validação do campo groupJid

  Scenario: JID duplicado
    Given já existe um grupo com o mesmo groupJid
    When faço POST /whatsapp-groups com o mesmo groupJid
    Then retorna 409 Conflict

Feature: Status da sessão WhatsApp

  Scenario: Sessão conectada
    Given o BaileysService está conectado
    When faço GET /whatsapp-session/status
    Then retorna 200 com { connected: true }

  Scenario: Aguardando QR
    Given nenhuma sessão foi estabelecida
    When faço GET /whatsapp-session/status
    Then retorna 200 com { connected: false, qrCode: "<base64>" }

Feature: Disparo manual de relatório

  Scenario: Disparar para cliente específico com sucesso
    Given existe cliente com grupos e conta de anúncio ativos
    And WhatsAppSession está conectada
    When faço POST /report-dispatches/trigger com clientId válido
    Then retorna 200 com { dispatched: N, failed: 0 }
    And registra N logs com status "sent"

  Scenario: WhatsApp desconectado no momento do disparo
    Given WhatsAppSession não está conectada
    When faço POST /report-dispatches/trigger
    Then retorna 200 com { dispatched: 0, failed: N }
    And registra logs com status "failed" e errorMessage

  Scenario: Sem autorização
    Given a requisição não contém X-Api-Key válido
    When faço POST /report-dispatches/trigger
    Then retorna 401

Feature: Job semanal automático

  Scenario: Segunda-feira 08h00 BRT com clientes configurados
    Given existem 2 clientes ativos com grupos e contas de anúncio
    And WhatsAppSession está conectada
    When o cron '0 8 * * 1' dispara
    Then cada grupo recebe uma mensagem com as métricas da semana anterior
    And todos os logs têm status "sent"
```

---

## 13. Dependências NPM a adicionar

```json
"@whiskeysockets/baileys": "^6.x",
"pino": "^9.x",
"qrcode": "^1.x"
```

> **Atenção**: Baileys usa ESM. Verificar compatibilidade com `NodeNext` module resolution já configurado no projeto — deve funcionar normalmente; monitorar se alguma dependência interna usa `require()` e precisar de workaround.

---

## 14. Definition of Done

- [ ] `WhatsAppGroupsModule` registrado em `app.module.ts`
- [ ] `WhatsAppSessionModule` registrado em `app.module.ts`
- [ ] `ReportDispatchesModule` registrado em `app.module.ts`
- [ ] Migration criada para `whatsapp_groups`, `whatsapp_sessions`, `report_dispatch_logs`
- [ ] `BaileysService` (dentro de `WhatsAppSessionModule`) gerencia conexão, QR, reconexão e persistência de credenciais encriptadas
- [ ] Controller com `ApiKeyGuard` em todos os endpoints
- [ ] DTOs com `class-validator` e validação de formato do JID
- [ ] Cache Redis implementado para grupos e status da sessão
- [ ] Cron job `@Cron('0 8 * * 1', { timeZone: 'America/Sao_Paulo' })` com delay entre envios
- [ ] `ReportDispatchLogEntity` registra sucesso e falha por grupo
- [ ] Testes unitários do `ReportDispatchesService` (mock de `WhatsAppSessionService` e `CampaignReportsService`)
- [ ] Testes unitários do `WhatsAppGroupsService` (mock do repositório)
- [ ] Testes e2e dos endpoints principais (groups CRUD + trigger)
- [ ] Variável de ambiente `WHATSAPP_DEDICATED_PHONE` documentada no `.env.example`
