# Spec: Instagram Graph API — Integração Completa

**Data:** 2026-05-27
**Status:** Rascunho v1

---

## 1. Objetivo

Habilitar que cada client (tenant) conecte sua conta do Instagram Business à plataforma, receba mensagens dos usuários finais via webhook do Meta e envie respostas automáticas via Instagram Graph API.

**Fluxo central:**
Instagram → Webhook Meta → verificar assinatura → identificar client por `pageId` → processar mensagem → enviar resposta via Graph API

Este módulo resolve o núcleo do produto: automatizar o atendimento de mensagens que chegam do Instagram para os clientes do traffic manager.

---

## 2. Contexto Multi-tenant

| Dado                             | Escopo     | Campo de isolamento |
|----------------------------------|------------|---------------------|
| Credenciais Instagram (token)    | Por client | `clientId`          |
| Conversas ativas                 | Por client | `clientId`          |
| Histórico de mensagens recebidas | Por client | `clientId`          |
| Verify token do webhook          | Global     | —                   |
| App Secret do Meta               | Global     | —                   |
| Mapeamento pageId → clientId     | Cache      | `pageId`            |

Toda query de negócio filtra por `clientId`. O roteamento do webhook usa `pageId` como chave para encontrar o client correto.

---

## 3. Descrição Funcional

### Módulo `integrations`
- CRUD de integrações Meta por client (plataforma: `instagram` | `whatsapp`)
- Armazena `pageId` (Instagram Page ID), `accessToken` (criptografado com AES-256-GCM), `tokenExpiresAt`
- Expõe endpoint para o client registrar/atualizar token de longa duração
- Troca automaticamente token de curta duração por longa duração via Graph API (`/oauth/access_token`)
- Cache Redis: mapeamento `pageId → IntegrationEntity` (crítico para roteamento de webhook em alta frequência)

### Módulo `webhook`
- `GET /webhook/instagram` — verificação do webhook pelo Meta (hub.challenge)
- `POST /webhook/instagram` — recebe eventos do Instagram (mensagens, reações, story replies)
- Valida assinatura HMAC-SHA256 no header `X-Hub-Signature-256`
- Roteia cada evento para o client correto via `pageId`
- Publica evento no pipeline interno para processamento assíncrono (fase 1: processamento síncrono simples)

### Serviço `InstagramGraphService`
- Envia mensagens de texto de volta ao usuário via `POST /v21.0/me/messages`
- Envia templates e respostas rápidas (quick replies)
- Marca mensagem como lida (`POST /v21.0/me/messages` com `sender_action: "mark_seen"`)
- Gerencia rate limiting da Graph API (200 msg/hora por usuário)

---

## 4. Estrutura de Arquivos

### Novos arquivos

```
src/
├── common/
│   ├── crypto/
│   │   └── aes.service.ts                          # AES-256-GCM encrypt/decrypt
│   └── decorators/
│       └── raw-body.decorator.ts                   # extrai raw body para validar assinatura
│
├── modules/
│   ├── integrations/
│   │   ├── integrations.module.ts
│   │   ├── integrations.controller.ts
│   │   ├── integrations.service.ts
│   │   ├── integrations.service.spec.ts
│   │   ├── dto/
│   │   │   ├── create-integration.dto.ts
│   │   │   └── update-integration.dto.ts
│   │   ├── entities/
│   │   │   └── integration.entity.ts
│   │   └── interfaces/
│   │       └── integrations-service.interface.ts
│   │
│   └── webhook/
│       ├── webhook.module.ts
│       ├── instagram/
│       │   ├── instagram-webhook.controller.ts
│       │   ├── instagram-webhook.service.ts
│       │   ├── instagram-webhook.service.spec.ts
│       │   ├── instagram-graph.service.ts
│       │   ├── instagram-graph.service.spec.ts
│       │   └── interfaces/
│       │       ├── instagram-webhook-event.interface.ts
│       │       └── instagram-graph.interface.ts
│
├── database/
│   └── migrations/
│       └── Migration[timestamp]-CreateIntegrations.ts
│
src/config/
└── configuration.ts                                # adicionar META_APP_SECRET, META_VERIFY_TOKEN, ENCRYPTION_KEY
```

### Arquivos modificados

- `src/app.module.ts` — importar `IntegrationsModule` e `WebhookModule`
- `src/config/configuration.ts` — adicionar `meta.appSecret`, `meta.verifyToken`, `app.encryptionKey`
- `src/main.ts` — habilitar `rawBody: true` no `NestFactory.create` (necessário para validar assinatura)

---

## 5. Contrato de API / Webhook

### Integrations

| Campo    | Valor                                                               |
|----------|---------------------------------------------------------------------|
| Método   | POST                                                                |
| Path     | `/api/v1/integrations`                                              |
| Auth     | `x-api-key`                                                         |
| Body DTO | `CreateIntegrationDto`                                              |
| Resposta | `IntegrationEntity` (sem `accessToken` no retorno)                  |

| Campo    | Valor                                                               |
|----------|---------------------------------------------------------------------|
| Método   | GET                                                                 |
| Path     | `/api/v1/integrations`                                              |
| Auth     | `x-api-key`                                                         |
| Query    | `clientId: string`                                                  |
| Resposta | `IntegrationEntity[]` (sem `accessToken`)                           |

| Campo    | Valor                                                               |
|----------|---------------------------------------------------------------------|
| Método   | GET                                                                 |
| Path     | `/api/v1/integrations/:id`                                          |
| Auth     | `x-api-key`                                                         |
| Resposta | `IntegrationEntity` (sem `accessToken`)                             |

| Campo    | Valor                                                               |
|----------|---------------------------------------------------------------------|
| Método   | PATCH                                                               |
| Path     | `/api/v1/integrations/:id`                                          |
| Auth     | `x-api-key`                                                         |
| Body DTO | `UpdateIntegrationDto`                                              |
| Resposta | `IntegrationEntity`                                                 |

| Campo    | Valor                                                               |
|----------|---------------------------------------------------------------------|
| Método   | DELETE                                                              |
| Path     | `/api/v1/integrations/:id`                                          |
| Auth     | `x-api-key`                                                         |
| Resposta | `void` (204)                                                        |

### Webhook Instagram

#### Verificação (GET)

| Campo    | Valor                                                              |
|----------|--------------------------------------------------------------------|
| Método   | GET                                                                |
| Path     | `/webhook/instagram`                                               |
| Auth     | Nenhuma (query params do Meta)                                     |
| Query    | `hub.mode`, `hub.verify_token`, `hub.challenge`                    |
| Resposta | `hub.challenge` (plain text) se `verify_token` bater              |

#### Recepção de eventos (POST)

| Campo    | Valor                                                              |
|----------|--------------------------------------------------------------------|
| Método   | POST                                                               |
| Path     | `/webhook/instagram`                                               |
| Auth     | Assinatura `X-Hub-Signature-256: sha256=<hmac>`                    |
| Body     | `InstagramWebhookPayload`                                          |
| Resposta | `200 OK` imediato (processamento ocorre depois)                    |

**Payload esperado do Meta (Instagram message):**
```json
{
  "object": "instagram",
  "entry": [
    {
      "id": "PAGE_ID",
      "time": 1697000000,
      "messaging": [
        {
          "sender": { "id": "USER_IGSID" },
          "recipient": { "id": "PAGE_ID" },
          "timestamp": 1697000000,
          "message": {
            "mid": "MSG_ID",
            "text": "Olá, quero saber mais sobre o produto"
          }
        }
      ]
    }
  ]
}
```

**Outros tipos de evento suportados:**
- `message` — mensagem de texto
- `reaction` — reação a mensagem
- `read` — confirmação de leitura
- `story_mention` — menção em story (somente notificação)

---

## 6. Entidade (PostgreSQL)

```typescript
// IntegrationEntity — src/modules/integrations/entities/integration.entity.ts

@Entity('integrations')
export class IntegrationEntity extends BaseEntity {
  // Herda: id (uuid), createdAt, updatedAt, deletedAt

  @Column({ name: 'client_id' })
  clientId: string;                        // FK → ClientEntity.id

  @ManyToOne(() => ClientEntity)
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ type: 'enum', enum: MetaPlatform })
  platform: MetaPlatform;                  // 'instagram' | 'whatsapp'

  @Column({ name: 'page_id', unique: true })
  pageId: string;                          // Instagram Page ID ou WhatsApp Phone Number ID

  @Column({ name: 'access_token', type: 'text' })
  accessToken: string;                     // AES-256-GCM encrypted

  @Column({ name: 'token_expires_at', type: 'timestamptz', nullable: true })
  tokenExpiresAt: Date | null;             // null = token permanente

  @Column({ default: true })
  isActive: boolean;
}

// Enum
export enum MetaPlatform {
  INSTAGRAM = 'instagram',
  WHATSAPP = 'whatsapp',
}
```

**Migration:** cria tabela `integrations` com índice em `(page_id)` e `(client_id, platform)`.

---

## 7. Cache (Redis)

### Mapeamento pageId → Integration (crítico para webhook)

- **Chave:** `integration:page:{pageId}`
- **TTL:** 3600 segundos
- **Dados cacheados:** objeto completo `IntegrationEntity` (incluindo `accessToken` criptografado)
- **Quando invalidar:** token atualizado, integração desativada/deletada
- **Justificativa:** cada mensagem recebida via webhook precisa encontrar o client e o token — sem cache seria uma query por mensagem em pico de tráfego de campanha

### Integration por ID

- **Chave:** `integration:id:{integrationId}`
- **TTL:** 3600 segundos
- **Quando invalidar:** atualização ou deleção

---

## 8. Interface dos Services

```typescript
// IIntegrationsService
export interface IIntegrationsService {
  create(dto: CreateIntegrationDto): Promise<IntegrationEntity>;
  findAll(clientId: string): Promise<IntegrationEntity[]>;
  findOne(id: string): Promise<IntegrationEntity>;
  findByPageId(pageId: string): Promise<IntegrationEntity>;      // usado pelo webhook
  update(id: string, dto: UpdateIntegrationDto): Promise<IntegrationEntity>;
  remove(id: string): Promise<void>;
}

// IInstagramWebhookService
export interface IInstagramWebhookService {
  verifyWebhook(mode: string, token: string, challenge: string): string;
  handleEvent(payload: InstagramWebhookPayload, rawBody: Buffer): Promise<void>;
}

// IInstagramGraphService
export interface IInstagramGraphService {
  sendTextMessage(pageId: string, recipientIgsid: string, text: string): Promise<void>;
  sendQuickReplies(pageId: string, recipientIgsid: string, text: string, options: string[]): Promise<void>;
  markSeen(pageId: string, recipientIgsid: string): Promise<void>;
}
```

---

## 9. DTOs e Validações

```typescript
// CreateIntegrationDto
export class CreateIntegrationDto {
  @IsUUID()
  clientId: string;

  @IsEnum(MetaPlatform)
  platform: MetaPlatform;

  @IsString()
  @IsNotEmpty()
  pageId: string;                          // Instagram Page ID

  @IsString()
  @IsNotEmpty()
  accessToken: string;                     // token recebido em texto puro — será criptografado no service

  @IsOptional()
  @IsDateString()
  tokenExpiresAt?: string;
}

// UpdateIntegrationDto
export class UpdateIntegrationDto {
  @IsString()
  @IsOptional()
  accessToken?: string;                    // rotação de token

  @IsDateString()
  @IsOptional()
  tokenExpiresAt?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
```

**Segurança:** `accessToken` nunca retorna em plaintext nas respostas da API — o campo é omitido via `@Exclude()` / `ClassSerializerInterceptor`.

---

## 10. AesCryptoService

```typescript
// src/common/crypto/aes.service.ts
// AES-256-GCM com IV aleatório por operação

@Injectable()
export class AesCryptoService {
  encrypt(plaintext: string): string;        // retorna `iv:ciphertext:tag` em base64
  decrypt(ciphertext: string): string;       // reverte `iv:ciphertext:tag`
}
```

- Chave lida de `ENCRYPTION_KEY` (env var, 64 hex chars = 32 bytes)
- IV de 12 bytes aleatório por operação (seguro para GCM)
- Autenticação via GCM auth tag (detecta adulteração)

---

## 11. Validação de Assinatura do Webhook

```typescript
// instagram-webhook.service.ts
validateSignature(rawBody: Buffer, signature: string): boolean {
  const expected = createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  return timingSafeEqual(
    Buffer.from(`sha256=${expected}`),
    Buffer.from(signature),
  );
}
```

- Usa `timingSafeEqual` para prevenir timing attacks
- Rejeita com `403 Forbidden` se inválida
- `rawBody` requer `NestFactory.create(AppModule, { rawBody: true })`

---

## 12. Critérios de Aceitação (BDD)

```gherkin
Feature: Gerenciamento de Integrações Instagram

  Scenario: Registrar integração Instagram com token válido
    Given tenho o x-api-key e um clientId existente
    When faço POST /api/v1/integrations com platform=instagram, pageId e accessToken
    Then retorna 201 com a integração criada
    And o accessToken retornado é omitido da resposta
    And o token é salvo criptografado no banco

  Scenario: Registrar integração com pageId duplicado
    Given já existe uma integração com o mesmo pageId
    When faço POST /api/v1/integrations com o mesmo pageId
    Then retorna 409 Conflict

  Scenario: Listar integrações de um client
    Given existem 2 integrações para o clientId X
    When faço GET /api/v1/integrations?clientId=X
    Then retorna lista com 2 integrações sem accessToken

Feature: Webhook Instagram — Verificação

  Scenario: Verificação bem-sucedida pelo Meta
    Given META_VERIFY_TOKEN=meu-token-secreto está configurado
    When Meta faz GET /webhook/instagram?hub.mode=subscribe&hub.verify_token=meu-token-secreto&hub.challenge=ABC123
    Then retorna 200 com body "ABC123"

  Scenario: Verificação com token inválido
    When Meta faz GET /webhook/instagram com hub.verify_token errado
    Then retorna 403 Forbidden

Feature: Webhook Instagram — Recepção de Mensagem

  Scenario: Mensagem de texto recebida com assinatura válida
    Given existe uma integração ativa para pageId=PAGE123 associada ao clientId=X
    And a assinatura HMAC-SHA256 do payload é válida
    When Meta faz POST /webhook/instagram com evento de mensagem de texto
    Then retorna 200 imediatamente
    And o evento é processado: client X é identificado e o texto é extraído

  Scenario: Mensagem recebida com assinatura inválida
    When Meta faz POST /webhook/instagram com X-Hub-Signature-256 incorreto
    Then retorna 403 Forbidden
    And nenhum processamento ocorre

  Scenario: Mensagem de pageId desconhecido (sem integração cadastrada)
    Given não existe integração para pageId=PAGE_DESCONHECIDO
    When Meta faz POST com evento desse pageId
    Then retorna 200 (nunca retornar erro para o Meta)
    And o evento é descartado com log de warning

Feature: Envio de Resposta via Instagram Graph API

  Scenario: Enviar mensagem de texto com token válido
    Given existe integração ativa com accessToken descriptografado
    When InstagramGraphService.sendTextMessage é chamado
    Then faz POST para https://graph.facebook.com/v21.0/me/messages
    And retorna sem erro

  Scenario: Token expirado ou inválido
    When a Graph API retorna erro 190 (token inválido)
    Then lança OAuthTokenExpiredException
    And não tenta reenviar automaticamente
```

---

## 13. Definition of Done

- [ ] `AesCryptoService` implementado e testado (encrypt/decrypt roundtrip)
- [ ] `IntegrationEntity` com migration gerada e aplicada
- [ ] `IntegrationsModule` com CRUD completo e `ApiKeyGuard`
- [ ] `accessToken` nunca exposto em plaintext nas respostas (ClassSerializerInterceptor)
- [ ] Cache Redis implementado: `integration:page:{pageId}` e `integration:id:{id}`
- [ ] `WebhookModule` com `GET /webhook/instagram` (verificação)
- [ ] `WebhookModule` com `POST /webhook/instagram` (recepção + validação de assinatura)
- [ ] `rawBody: true` habilitado em `main.ts`
- [ ] `InstagramGraphService` envia mensagens de texto e quick replies
- [ ] Tratamento de erros da Graph API (token expirado, rate limit)
- [ ] Testes unitários: `IntegrationsService`, `InstagramWebhookService`, `InstagramGraphService`
- [ ] Variáveis de ambiente: `ENCRYPTION_KEY`, `META_APP_SECRET`, `META_VERIFY_TOKEN`
- [ ] `IntegrationsModule` e `WebhookModule` registrados em `app.module.ts`

---

## 14. Variáveis de Ambiente Adicionais

```bash
# Criptografia de tokens
ENCRYPTION_KEY=<64 hex chars — openssl rand -hex 32>

# Meta / Instagram
META_APP_SECRET=<app secret do Facebook Developer Console>
META_VERIFY_TOKEN=<string aleatória que você configura no painel do Meta>

# Instagram Graph API base URL (útil para mock em testes)
META_GRAPH_API_URL=https://graph.facebook.com
META_GRAPH_API_VERSION=v21.0
```

---

## 15. Dependências a Instalar

```bash
# HTTP client para chamadas à Graph API
npm install @nestjs/axios axios

# Criptografia (nativo no Node.js — sem dependência extra)
# Usa: import { createHmac, createCipheriv, timingSafeEqual } from 'crypto'
```

---

## 16. Ordem de Implementação Sugerida

1. `AesCryptoService` (base para tudo que envolve token)
2. `IntegrationEntity` + migration
3. `IntegrationsModule` (CRUD + cache)
4. Ajustar `main.ts` com `rawBody: true`
5. `WebhookModule` — verificação GET
6. `WebhookModule` — recepção POST + validação de assinatura
7. `InstagramGraphService` — envio de mensagem de texto
8. Testes unitários de cada service
9. Registrar módulos em `app.module.ts`

---

## 17. Próximas Specs (fora do escopo desta)

| Módulo          | Responsabilidade                                                    |
|-----------------|---------------------------------------------------------------------|
| `conversations` | Estado da conversa por usuário final (IGSID)                        |
| `bot`           | Triagem via OpenAI + lógica de qualificação de lead                 |
| `leads`         | Criação de lead qualificado + push para CRM (Pipedrive / HubSpot)   |
| `whatsapp`      | Webhook e messaging para WhatsApp Cloud API (paralelo ao Instagram) |
