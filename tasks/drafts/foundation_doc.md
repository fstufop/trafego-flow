# Documentação: Fundação da API

**Data:** 2026-05-27
**Tipo:** Módulo Novo
**Arquivos analisados:**
- `src/app.module.ts`
- `src/main.ts`
- `src/config/app.config.ts`, `database.config.ts`, `redis.config.ts`, `configuration.ts`, `datasource.ts`
- `src/common/database/base.entity.ts`
- `src/common/guards/api-key.guard.ts`
- `src/modules/health/health.module.ts`, `health.controller.ts`
- `src/modules/clients/clients.module.ts`, `clients.controller.ts`, `clients.service.ts`
- `src/modules/clients/entities/client.entity.ts`
- `src/modules/clients/dto/create-client.dto.ts`, `update-client.dto.ts`
- `src/modules/clients/interfaces/clients-service.interface.ts`
- `src/database/migrations/1779911649000-CreateClientsTable.ts`

---

## Visão Geral

A fundação é a camada de infraestrutura da API TrafegoFlow. Ela provisiona as conexões com PostgreSQL e Redis, configura e valida variáveis de ambiente, expõe um endpoint de health check para readiness probe (Render), e entrega o CRUD completo da entidade `Client` — que representa cada cliente do gestor de tráfego e é a âncora de todo o modelo de dados multi-tenant da plataforma.

---

## Contexto Multi-tenant

- **Dados isolados por client:** integrações Meta, conversas, leads (módulos futuros)
- **`Client` é o próprio tenant:** toda entidade futura referencia `clientId` como FK
- **Dados globais:** configuração de ambiente, Swagger, health check

---

## Módulo 1 — Configuração e Ambiente

### Fluxo de inicialização

```
NestFactory.create(AppModule)
    ↓ ConfigModule.forRoot({ validationSchema })
        ↓ Joi valida PORT, DATABASE_URL, REDIS_URL, MASTER_API_KEY
        ↓ Falha com mensagem clara se env var obrigatória ausente
    ↓ TypeOrmModule conecta ao PostgreSQL (DATABASE_URL)
    ↓ CacheModule conecta ao Redis (REDIS_URL via @keyv/redis)
    ↓ app.setGlobalPrefix('api/v1')
    ↓ app.useGlobalPipes(ValidationPipe)
    ↓ SwaggerModule.setup('/docs')
← API pronta em PORT (default: 3000)
```

### Variáveis de Ambiente

| Variável | Obrigatória | Descrição | Exemplo |
|----------|-------------|-----------|---------|
| `PORT` | Não | Porta da API | `3000` |
| `NODE_ENV` | Não | Ambiente de execução | `development` |
| `MASTER_API_KEY` | **Sim** | Chave de autenticação interna | `minha-chave-secreta` |
| `DATABASE_URL` | **Sim** | Connection string PostgreSQL | `postgresql://user:pass@localhost:5432/trafegoflow` |
| `REDIS_URL` | **Sim** | Connection string Redis | `redis://:senha@localhost:6379` |
| `CACHE_TTL_SECONDS` | Não | TTL padrão do cache | `3600` |

### Regras

**RN-01: Falha na startup com env inválida**
**Onde:** `src/config/configuration.ts` — schema Joi
**Descrição:** Se qualquer variável obrigatória (`MASTER_API_KEY`, `DATABASE_URL`, `REDIS_URL`) estiver ausente, a aplicação recusa a subir e lança uma exceção descritiva antes de aceitar qualquer requisição.

---

## Módulo 2 — Guard de Autenticação (ApiKeyGuard)

### Fluxo

```
HTTP Request
    ↓ ApiKeyGuard.canActivate()
        ↓ Lê header 'x-api-key'
        ↓ Compara com ConfigService.get('app.masterApiKey')
        ↓ Não bate → lança UnauthorizedException (HTTP 401)
        ↓ Bate → retorna true → passa para o controller
```

### Regras

**RN-02: API Key como mecanismo de auth inicial**
**Onde:** `src/common/guards/api-key.guard.ts:12`
**Descrição:** Todas as rotas internas são protegidas por uma API Key global configurada via `MASTER_API_KEY`. Este é o mecanismo de fase inicial — será substituído por JWT quando a autenticação de usuários for implementada.
**Condição:** Aplicado por controller (não global), para que `/health` e `/docs` permaneçam públicos.

**RN-03: Lança exceção, não retorna false**
**Onde:** `src/common/guards/api-key.guard.ts:13`
**Descrição:** O guard lança `UnauthorizedException` em vez de retornar `false`. Isso garante HTTP 401 (não 403), com mensagem `"Invalid or missing API key"`.

---

## Módulo 3 — Health Check

### Fluxo

```
GET /health  (sem prefixo /api/v1, sem guard)
    ↓ HealthController.check()
        ↓ TypeOrmHealthIndicator.pingCheck('database')
            ↓ Executa SELECT 1 no PostgreSQL
        ↓ HealthController.pingRedis()
            ↓ cache.set('__health_ping__', 1, 5000ms)
            ↓ cache.get('__health_ping__')
← 200 { status: "ok", info: { database: { status: "up" }, redis: { status: "up" } } }
← 503 { status: "error", ... } se qualquer serviço falhar
```

### Endpoints

| Método | Path | Guard | Descrição |
|--------|------|-------|-----------|
| GET | `/health` | Nenhum | Retorna status de PostgreSQL e Redis |

### Regras

**RN-04: Health check sem autenticação**
**Onde:** `src/modules/health/health.controller.ts` — ausência de `@UseGuards`
**Descrição:** `/health` é público intencionalmente. O Render (e qualquer orquestrador) precisa acessá-lo para readiness/liveness probe sem credenciais.

**RN-05: Rota fora do prefixo global**
**Onde:** `@Controller('health')` sem prefixo adicional
**Descrição:** O `setGlobalPrefix('api/v1')` se aplica apenas a controllers sem prefixo explícito. O `HealthController` usa `@Controller('health')`, que resulta em `/health` — não `/api/v1/health`.

---

## Módulo 4 — Clients (CRUD)

### Visão Geral

`Client` é a entidade central da plataforma. Representa cada cliente do gestor de tráfego. As credenciais Meta (tokens, IDs de integração) são armazenadas em `Integration` (módulo futuro), não diretamente no `Client`.

### Fluxo de dados — POST /api/v1/clients

```
POST /api/v1/clients
    ↓ ApiKeyGuard → 401 se x-api-key inválido
ClientsController.create(@Body() dto)
    ↓ ValidationPipe → 400 se DTO inválido
ClientsService.create(dto)
    ↓ repo.create(dto) → instancia entidade
    ↓ repo.save(entity) → INSERT no PostgreSQL
        ↓ Unique constraint em email viola → PostgreSQL lança código 23505
        ↓ QueryFailedError capturado → ConflictException (409)
← ClientEntity (201)
```

### Fluxo de dados — GET /api/v1/clients/:id

```
GET /api/v1/clients/:id
    ↓ ApiKeyGuard
    ↓ ParseUUIDPipe → 400 se id não é UUID válido
ClientsService.findOne(id)
    ↓ cache.get('client:id:{id}')
        ↓ HIT → retorna imediatamente (sem query ao banco)
        ↓ MISS → repo.findOne({ where: { id } })
            ↓ null → NotFoundException (404)
            ↓ encontrado → cache.set('client:id:{id}', entity)
← ClientEntity (200)
```

### Fluxo de dados — PATCH /api/v1/clients/:id

```
PATCH /api/v1/clients/:id
    ↓ ApiKeyGuard + ParseUUIDPipe
ClientsService.update(id, dto)
    ↓ findOne(id)           ← verifica existência (+ usa cache)
    ↓ repo.save({ ...client, ...dto })   ← UPDATE no PostgreSQL
    ↓ cache.del('client:id:{id}')        ← invalida cache
← ClientEntity atualizado (200)
```

### Fluxo de dados — DELETE /api/v1/clients/:id

```
DELETE /api/v1/clients/:id
    ↓ ApiKeyGuard + ParseUUIDPipe
ClientsService.remove(id)
    ↓ findOne(id)           ← verifica existência
    ↓ repo.softRemove(client)   ← SET deleted_at = now()
    ↓ cache.del('client:id:{id}')
← 204 No Content
```

### Endpoints

| Método | Path | Guard | DTO | Resposta | Descrição |
|--------|------|-------|-----|----------|-----------|
| POST | `/api/v1/clients` | x-api-key | `CreateClientDto` | `ClientEntity` (201) | Cria novo client |
| GET | `/api/v1/clients` | x-api-key | — | `ClientEntity[]` (200) | Lista clients ativos |
| GET | `/api/v1/clients/:id` | x-api-key | — | `ClientEntity` (200) | Busca por ID |
| PATCH | `/api/v1/clients/:id` | x-api-key | `UpdateClientDto` | `ClientEntity` (200) | Atualiza campos |
| DELETE | `/api/v1/clients/:id` | x-api-key | — | `void` (204) | Soft delete |

### Entidade PostgreSQL — `clients`

| Campo | Tipo | Constraints | Descrição |
|-------|------|-------------|-----------|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` | Identificador único |
| `name` | `varchar(200)` | NOT NULL | Nome do cliente / empresa |
| `email` | `varchar` | NOT NULL, UNIQUE (parcial*) | Email do gestor de tráfego |
| `is_active` | `boolean` | NOT NULL, DEFAULT true | Flag de ativação |
| `created_at` | `timestamp` | NOT NULL, DEFAULT now() | Data de criação |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT now() | Data da última atualização |
| `deleted_at` | `timestamp` | NULLABLE | Preenchido no soft delete |

*O índice unique em `email` é parcial: `WHERE deleted_at IS NULL`. Isso permite que um email de client deletado seja reutilizado em um novo cadastro.

### Estratégia de Cache Redis

| Chave | TTL | Invalidado quando |
|-------|-----|-------------------|
| `client:id:{id}` | 3600s (configurável via `CACHE_TTL_SECONDS`) | `update()` ou `remove()` |

### Regras de Negócio

**RN-06: Email único entre clientes ativos**
**Onde:** `src/database/migrations/...ts` — índice parcial; `clients.service.ts:25`
**Descrição:** Dois clientes ativos não podem ter o mesmo email. A validação é feita no banco (constraint), capturada no service via `QueryFailedError` com código PostgreSQL `23505` e relançada como `ConflictException` (409).
**Detalhe:** A unicidade é parcial (`WHERE deleted_at IS NULL`), então um email de client deletado pode ser reutilizado.

**RN-07: Soft delete — dados preservados**
**Onde:** `clients.service.ts:55-57`; `base.entity.ts:13`
**Descrição:** `DELETE /api/v1/clients/:id` não remove o registro do banco. Preenche `deleted_at` com o timestamp atual. O client desaparece do `GET /api/v1/clients` (TypeORM filtra `WHERE deleted_at IS NULL` automaticamente) mas permanece na tabela para auditoria e integridade referencial com módulos futuros (integrations, leads).

**RN-08: `findAll` retorna apenas clients ativos**
**Onde:** `clients.service.ts:32-34`
**Descrição:** `findAll()` filtra por `isActive: true`. Um client pode ser desativado via `PATCH` com `{ isActive: false }` sem ser deletado — útil para suspensão temporária sem perda de dados.

**RN-09: Cache somente na leitura por ID**
**Onde:** `clients.service.ts:36-44`
**Descrição:** O cache Redis é utilizado apenas no `findOne()`. O `findAll()` sempre vai ao banco — intencionalmente, pois listas podem mudar frequentemente e o volume de dados é pequeno nesta fase.

---

## BaseEntity — Contrato de Herança

Todas as entidades futuras do projeto **devem** herdar de `BaseEntity`:

```typescript
// src/common/database/base.entity.ts
export abstract class BaseEntity {
  id: string;         // uuid, PK
  createdAt: Date;    // auto
  updatedAt: Date;    // auto
  deletedAt: Date | null;  // soft delete
}
```

Ao herdar `BaseEntity`, a entidade automaticamente:
- Recebe UUID gerado pelo banco (`gen_random_uuid()`)
- Tem timestamps gerenciados pelo TypeORM
- Suporta soft delete via `repo.softRemove()` / `repo.restore()`

---

## Dependências Externas

| Dependência | Versão | Uso |
|-------------|--------|-----|
| `@nestjs/typeorm` + `typeorm` | 11.0.1 / 1.0.0 | ORM PostgreSQL |
| `@nestjs/cache-manager` + `@keyv/redis` | 3.1.2 / 5.1.6 | Cache Redis |
| `@nestjs/config` + `joi` | 4.0.4 / 18.x | Configuração e validação de env |
| `@nestjs/terminus` | 11.1.1 | Health check |
| `@nestjs/swagger` | 11.4.4 | Documentação OpenAPI em `/docs` |
| `class-validator` + `class-transformer` | 0.15.1 / 0.5.1 | Validação de DTOs |

---

## Pontos de Atenção / Dívida Técnica

1. **`enableCors()` sem restrição de origem** (`main.ts:11`) — Aceitável para desenvolvimento local. Antes do deploy em produção, restringir com `origin: process.env.CORS_ORIGIN` para evitar requisições cross-origin não autorizadas.

2. **`ApiKeyGuard` é temporário** — Será substituído por JWT quando o módulo de autenticação de usuários for implementado. Ao migrar, todos os controllers que usam `@UseGuards(ApiKeyGuard)` precisam ser atualizados.

3. **`update()` pode gravar sobre dados de cache dessincronizados** (`clients.service.ts:49`) — `findOne()` retorna do cache (plain object), que é espalhado com `{ ...client, ...dto }` antes de `repo.save()`. O TypeORM lida bem com plain objects com `id` preenchido (faz UPDATE), mas a entidade retornada pelo `save()` é sempre fresh do banco. Risco baixo mas vale monitorar ao adicionar relacionamentos.

4. **Ausência de `@ApiResponse` no controller** — O Swagger em `/docs` documenta os endpoints mas não os schemas de resposta. Adicionar `@ApiResponse({ type: ClientEntity })` em cada endpoint melhora a experiência de quem consumir a API.

5. **Migration manual pode divergir do schema gerado pelo TypeORM** — A migration foi escrita manualmente porque o Docker Redis estava offline durante o desenvolvimento. Após subir os containers, rodar `npm run migration:show` para confirmar que o TypeORM não detecta diferenças entre a migration e o schema atual.

6. **Sem paginação em `findAll`** — `GET /api/v1/clients` retorna todos os clients de uma vez. Adequado para o volume inicial, mas deverá receber `limit`/`offset` (ou cursor-based pagination) antes do volume crescer.
