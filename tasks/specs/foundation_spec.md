# Spec: Fundação da API — Estrutura Inicial

**Data:** 2026-05-26
**Status:** Rascunho v2 (atualizado com diagramas do README)

---

## 1. Objetivo

Estruturar a API NestJS do TrafegoFlow com todas as fundações necessárias para suportar o ciclo de desenvolvimento local e o deploy em cloud (Render ou similar). Essa spec cobre a infraestrutura base e os primeiros módulos funcionais que habilitam os demais fluxos da plataforma.

**Fluxo central:**
Meta envia webhook → plataforma identifica o client pelo `external_id` (phone_id ou page_id) → busca o token criptografado em `INTEGRATION` → processa a mensagem via IA → qualifica ou continua triagem → cria lead no CRM do client se qualificado.

---

## 2. Contexto Multi-tenant

| Dado                          | Escopo        |
|-------------------------------|---------------|
| Integrações Meta (tokens)     | Por client    |
| Conversas ativas              | Por client    |
| Leads capturados              | Por client    |
| Configuração do bot           | Por client    |
| Configuração de ambiente      | Global        |
| Health / métricas             | Global        |

Toda entidade de negócio possui `clientId: string (uuid)` como chave de isolamento entre tenants.

---

## 3. Descrição Funcional

Dividida em **5 blocos** a serem implementados em ordem:

### Bloco 1 — Configuração e Ambiente
- Variáveis de ambiente validadas via `@nestjs/config` + `Joi`
- `.env.example` documentando todas as variáveis necessárias
- Separação entre `development` e `production`
- Port configurável via `PORT` env var (padrão 3000)

### Bloco 2 — Banco de Dados (PostgreSQL + TypeORM)
- Conexão com PostgreSQL via `@nestjs/typeorm`
- Migrations habilitadas (`synchronize: false` em produção)
- `BaseEntity` abstrata com `id (uuid)`, `createdAt`, `updatedAt`

### Bloco 3 — Cache (Redis)
- Conexão com Redis via `@nestjs/cache-manager`
- Cache global disponível para injeção nos services
- TTL padrão configurável via env var
- **Uso crítico:** lookup de `INTEGRATION` por `external_id` a cada webhook recebido

### Bloco 4 — Health Check
- `GET /health` retornando status de PostgreSQL e Redis
- Usado pelo Render como readiness probe

### Bloco 5 — Módulo Clients (CRUD base)
- `Client` é a entidade central — representa cada cliente do traffic manager
- CRUD completo: criar, listar, buscar por id, atualizar, desativar (soft delete)
- Autenticação via API Key no header `x-api-key` (fase inicial, antes do JWT)
- Client possui: nome, email, status ativo/inativo
- As credenciais Meta do client ficam em `INTEGRATION` (módulo futuro)

---

## 4. Estrutura de Arquivos

### Novos arquivos

```
src/
├── common/
│   ├── database/
│   │   └── base.entity.ts                  # entidade abstrata com id, timestamps
│   ├── guards/
│   │   └── api-key.guard.ts                # guard de API Key
│   └── decorators/
│       └── client-id.decorator.ts          # extrai clientId do contexto
│
├── config/
│   ├── app.config.ts
│   ├── database.config.ts
│   ├── redis.config.ts
│   └── configuration.ts                    # barrel — junta todas as configs
│
├── modules/
│   ├── health/
│   │   ├── health.module.ts
│   │   └── health.controller.ts
│   │
│   └── clients/
│       ├── clients.module.ts
│       ├── clients.controller.ts
│       ├── clients.service.ts
│       ├── clients.service.spec.ts
│       ├── dto/
│       │   ├── create-client.dto.ts
│       │   └── update-client.dto.ts
│       ├── entities/
│       │   └── client.entity.ts
│       └── interfaces/
│           └── clients-service.interface.ts
│
tasks/
└── specs/
    └── foundation_spec.md

.env.example
```

### Arquivos modificados

- `src/app.module.ts` — importar `ConfigModule`, `TypeOrmModule`, `CacheModule`, `HealthModule`, `ClientsModule`
- `src/main.ts` — `ValidationPipe` global, prefixo `/api/v1`, CORS, Swagger

---

## 5. Contrato de API

### Health Check

| Campo    | Valor                                        |
|----------|----------------------------------------------|
| Método   | GET                                          |
| Path     | `/health`                                    |
| Auth     | Nenhuma                                      |
| Resposta | `{ status, database, redis, uptime }`        |

```json
// 200 OK
{ "status": "ok", "database": "up", "redis": "up", "uptime": 3600 }

// 503 Service Unavailable
{ "status": "degraded", "database": "down", "redis": "up", "uptime": 3600 }
```

### Clients

| Método | Path                   | Auth      | Body DTO          | Resposta         |
|--------|------------------------|-----------|-------------------|------------------|
| POST   | `/api/v1/clients`      | x-api-key | `CreateClientDto` | `ClientEntity`   |
| GET    | `/api/v1/clients`      | x-api-key | —                 | `ClientEntity[]` |
| GET    | `/api/v1/clients/:id`  | x-api-key | —                 | `ClientEntity`   |
| PATCH  | `/api/v1/clients/:id`  | x-api-key | `UpdateClientDto` | `ClientEntity`   |
| DELETE | `/api/v1/clients/:id`  | x-api-key | —                 | `void` (204)     |

**Header obrigatório:** `x-api-key: <MASTER_API_KEY>`

---

## 6. Entidades (PostgreSQL)

### BaseEntity (`src/common/database/base.entity.ts`)

```typescript
@PrimaryGeneratedColumn('uuid')
id: string;

@CreateDateColumn()
createdAt: Date;

@UpdateDateColumn()
updatedAt: Date;

@DeleteDateColumn()   // soft delete
deletedAt: Date | null;
```

### ClientEntity (`src/modules/clients/entities/client.entity.ts`)

```typescript
// Herda: id, createdAt, updatedAt, deletedAt

@Column()
name: string;                   // Nome do cliente / empresa

@Column({ unique: true })
email: string;                  // Email do traffic manager

@Column({ default: true })
isActive: boolean;              // Soft enable/disable

// Relacionamentos (mapeados mas implementados nos módulos futuros)
@OneToMany(() => IntegrationEntity, (i) => i.client)
integrations: IntegrationEntity[];

@OneToMany(() => LeadEntity, (l) => l.client)
leads: LeadEntity[];
```

### Entidades futuras (apenas referência para esta spec)

```
INTEGRATION
  id            uuid PK
  client_id     uuid FK → CLIENT
  platform      enum: 'whatsapp' | 'instagram'
  external_id   string  — Phone Number ID (WA) ou Page ID (IG)
  access_token  text    — criptografado em AES-256
  expires_at    timestamp

CONVERSATION
  id              uuid PK
  integration_id  uuid FK → INTEGRATION
  remote_user_id  string  — ID do usuário no WA/IG
  last_state      enum: 'Aguardando Triagem' | 'Finalizado'
  updated_at      timestamp

LEAD
  id          uuid PK
  client_id   uuid FK → CLIENT
  name        string
  phone_email string
  metadata    jsonb   — dados coletados durante a triagem
```

---

## 7. Cache (Redis)

### Integration por external_id (crítico para roteamento de webhook)

- **Chave:** `integration:external:{externalId}`
- **TTL:** 3600 segundos
- **Quando invalidar:** token atualizado, integração desativada
- **Justificativa:** cada mensagem recebida via webhook precisa encontrar o client e o token — sem cache seriam N queries/segundo em pico de tráfego pago

### Client por ID

- **Chave:** `client:id:{clientId}`
- **TTL:** 3600 segundos
- **Quando invalidar:** client atualizado ou desativado

> Nesta fase (foundation), apenas o cache de Client por ID é implementado.
> O cache de Integration será implementado no módulo `integrations`.

---

## 8. Interface do Service

```typescript
// src/modules/clients/interfaces/clients-service.interface.ts

export interface IClientsService {
  create(dto: CreateClientDto): Promise<ClientEntity>;
  findAll(): Promise<ClientEntity[]>;
  findOne(id: string): Promise<ClientEntity>;
  update(id: string, dto: UpdateClientDto): Promise<ClientEntity>;
  remove(id: string): Promise<void>;
}
```

---

## 9. DTOs e Validações

```typescript
// CreateClientDto
export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsEmail()
  email: string;
}

// UpdateClientDto — todos os campos de CreateClientDto opcionais + isActive
export class UpdateClientDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
```

---

## 10. Variáveis de Ambiente

```bash
# .env.example

# App
PORT=3000
NODE_ENV=development
MASTER_API_KEY=change-me-in-production

# PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/trafegoflow

# Redis
REDIS_URL=redis://localhost:6379
CACHE_TTL_SECONDS=3600

# (Futuro — módulo Integrations)
# ENCRYPTION_KEY=            # AES-256 key para tokens Meta

# (Futuro — módulo Webhook)
# META_APP_SECRET=
# META_VERIFY_TOKEN=

# (Futuro — módulo Bot)
# OPENAI_API_KEY=
```

---

## 11. Critérios de Aceitação (BDD)

```gherkin
Feature: Health Check

  Scenario: Todos os serviços estão up
    Given a API está rodando com PostgreSQL e Redis conectados
    When faço GET /health
    Then retorna 200 com { status: "ok", database: "up", redis: "up" }

  Scenario: PostgreSQL está down
    Given PostgreSQL está inacessível
    When faço GET /health
    Then retorna 503 com { status: "degraded", database: "down" }

Feature: Gerenciamento de Clients

  Scenario: Criar client com dados válidos
    Given tenho o MASTER_API_KEY no header x-api-key
    When faço POST /api/v1/clients com name e email válidos
    Then retorna 201 com o client criado incluindo id gerado

  Scenario: Criar client com email duplicado
    Given já existe um client com o mesmo email
    When faço POST /api/v1/clients com o mesmo email
    Then retorna 409 Conflict

  Scenario: Criar client sem autenticação
    Given não envio o header x-api-key
    When faço POST /api/v1/clients
    Then retorna 401 Unauthorized

  Scenario: Criar client com email inválido
    Given tenho o MASTER_API_KEY válido
    When faço POST com email = "nao-e-um-email"
    Then retorna 400 com mensagem de validação do campo email

  Scenario: Buscar client inexistente
    Given tenho o MASTER_API_KEY válido
    When faço GET /api/v1/clients/{uuid-inexistente}
    Then retorna 404 Not Found

  Scenario: Desativar client (soft delete)
    Given existe um client ativo com id válido
    When faço DELETE /api/v1/clients/{id}
    Then retorna 204
    And o client não aparece no GET /api/v1/clients
    And o registro permanece no banco com deletedAt preenchido
```

---

## 12. Definition of Done

- [ ] `.env.example` criado e documentado
- [ ] `ConfigModule` global com validação Joi das envs obrigatórias
- [ ] `TypeOrmModule` conectado ao PostgreSQL com migration support
- [ ] `CacheModule` conectado ao Redis com TTL configurável
- [ ] `GET /health` retornando status real de DB e Redis
- [ ] `BaseEntity` abstrata com uuid, timestamps e soft delete
- [ ] `ClientEntity` com campos: name, email, isActive
- [ ] Migration de criação da tabela `clients` gerada
- [ ] CRUD de Clients completo com `ApiKeyGuard`
- [ ] Cache de client por id implementado no service
- [ ] `ValidationPipe` global em `main.ts`
- [ ] Prefixo `/api/v1` em `main.ts`
- [ ] Swagger disponível em `/docs`
- [ ] Testes unitários de `ClientsService` com repositório mockado (≥ 80% coverage)
- [ ] Teste e2e do fluxo criação + busca + deleção de client

---

## 13. Dependências a Instalar

```bash
# Core
npm install @nestjs/config @nestjs/typeorm typeorm pg
npm install @nestjs/cache-manager cache-manager ioredis

# Validação
npm install class-validator class-transformer

# Health
npm install @nestjs/terminus

# Swagger
npm install @nestjs/swagger swagger-ui-express

# Validação de env
npm install joi

# Criptografia (para tokens Meta — módulo Integrations)
npm install @nestjs/jwt bcrypt
npm install -D @types/bcrypt
```

---

## 14. Ordem de Implementação Sugerida

1. Instalar dependências
2. Criar `.env.example` e `.env` local
3. `ConfigModule` + validação Joi
4. `BaseEntity` abstrata
5. `TypeOrmModule` (PostgreSQL)
6. `CacheModule` (Redis)
7. Ajustar `main.ts` (ValidationPipe, prefixo, Swagger)
8. `HealthModule`
9. `ClientsModule` completo (entity → migration → service → controller)
10. Testes unitários e e2e

---

## 15. Próximas Specs (fora do escopo desta)

| Módulo         | Responsabilidade                                              |
|----------------|---------------------------------------------------------------|
| `integrations` | CRUD de integrações Meta por client + criptografia de tokens  |
| `webhook`      | Receiver do Meta (verificação + ingestão de mensagens)        |
| `conversations`| Estado da conversa por usuário final                          |
| `bot`          | Triagem via OpenAI + lógica de qualificação                   |
| `leads`        | Criação de leads qualificados + push para CRM                 |
