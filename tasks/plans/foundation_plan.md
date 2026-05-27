# Plano de Implementação: Fundação da API

**Spec:** `tasks/specs/foundation_spec.md`
**Data:** 2026-05-26
**Estado:** Pronto para execução

---

## Análise de Alternativas

### ORM

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| **TypeORM (Escolhida)** | ORM nativo do NestJS, decorator-based | Integração perfeita com NestJS, migrations CLI, `@nestjs/typeorm` oficial | Menos type-safe que Prisma em queries complexas |
| Prisma | ORM moderno, schema-first | Excelente DX, queries 100% type-safe | Integração com NestJS requer boilerplate extra, migration workflow diferente |
| Drizzle | SQL-first, ultra leve | Alta performance, SQL explícito | Pouca integração com NestJS, ecossistema menor |

**Decisão:** TypeORM — alinhado com NestJS 11, `@nestjs/typeorm` v11 disponível, toda a equipe já conhece o padrão decorator.

### Cache Redis

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| **@nestjs/cache-manager + @keyv/redis (Escolhida)** | Cache module oficial NestJS v3 + adapter Keyv | API declarativa, injeção nativa, padrão atual do NestJS 11 | API Keyv é nova (cache-manager v7), menos exemplos online |
| ioredis direto | Cliente Redis sem abstração | Total controle, API madura | Mais boilerplate, perde integração com DI do NestJS |
| cache-manager-ioredis-yet | Adapter Redis para cache-manager v5 | Muito documentado | Incompatível com cache-manager v7 (@nestjs/cache-manager v3) |

**Decisão:** `@nestjs/cache-manager` v3 + `@keyv/redis` — é o stack correto para NestJS 11. A API mudou mas é simples.

### Health Check

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| **@nestjs/terminus (Escolhida)** | Biblioteca oficial de health | Health indicators prontos para TypeORM e Redis, padrão Render/K8s | Dependência extra |
| Controller manual | GET /health customizado | Zero dependência | Reimplementa o que terminus já faz |

**Decisão:** `@nestjs/terminus` v11 — possui `TypeOrmHealthIndicator` e `MicroserviceHealthIndicator` prontos.

---

## Recursos Reutilizáveis Identificados

**Estado atual:** `src/common/` e `src/config/` não existem — serão criados do zero neste plano.

Após a implementação, os seguintes recursos estarão disponíveis para todos os módulos futuros:
- `BaseEntity` — uuid, timestamps, soft delete
- `ApiKeyGuard` — proteção de rotas internas via `x-api-key`
- `ConfigModule` global — `ConfigService` injetável em qualquer módulo
- `CacheModule` global — `CACHE_MANAGER` injetável em qualquer service
- `TypeOrmModule` global — `getRepositoryToken()` disponível para todas as entities

---

## Diagrama de Fluxo

```
POST /api/v1/clients
    ↓ ApiKeyGuard  →  401 se x-api-key inválido
ClientsController
    ↓ ValidationPipe (CreateClientDto)  →  400 se inválido
ClientsService.create()
    ↓ clientsRepository.save()  →  409 se email duplicado (unique constraint)
    ↓ cache.del('client:id:{id}')     (invalidação preventiva)
    ↓ retorna ClientEntity  →  201

GET /api/v1/clients/:id
    ↓ ApiKeyGuard
ClientsController
ClientsService.findOne()
    ↓ cache.get('client:id:{id}')  →  hit: retorna direto
    ↓ miss: clientsRepository.findOneOrFail()  →  404 se não existe
    ↓ cache.set('client:id:{id}', entity, 3600s)
    ↓ retorna ClientEntity  →  200

GET /health
    ↓ (sem guard)
HealthController
    ↓ TypeOrmHealthIndicator.pingCheck()
    ↓ RedisHealthIndicator (ping manual via CACHE_MANAGER)
    ↓ 200 ok | 503 degraded
```

---

## Tarefas Sequenciais

### Tarefa 1 — [Deps] Instalar dependências
**O que fazer:**
```bash
npm install @nestjs/config @nestjs/typeorm typeorm pg
npm install @nestjs/cache-manager @keyv/redis keyv
npm install @nestjs/terminus
npm install @nestjs/swagger swagger-ui-express
npm install class-validator class-transformer
npm install joi
```
**Depende de:** nada
**Testável:** `npm run build` sem erros de módulo não encontrado

---

### Tarefa 2 — [Config] ConfigModule + validação Joi
**Arquivos:**
- `src/config/app.config.ts`
- `src/config/database.config.ts`
- `src/config/redis.config.ts`
- `src/config/configuration.ts` (barrel)

**O que fazer:**
- `app.config.ts` — expõe `port`, `nodeEnv`, `masterApiKey`
- `database.config.ts` — expõe `databaseUrl`
- `redis.config.ts` — expõe `redisUrl`, `cacheTtlSeconds`
- `configuration.ts` — junta tudo em um objeto com schema Joi para validação na startup

Schema Joi valida obrigatórios: `PORT`, `DATABASE_URL`, `REDIS_URL`, `MASTER_API_KEY`

**Depende de:** Tarefa 1
**Testável:** `npm run start:dev` falha com mensagem clara se env var obrigatória estiver ausente

---

### Tarefa 3 — [Common] BaseEntity abstrata
**Arquivo:** `src/common/database/base.entity.ts`

**O que fazer:**
```typescript
@Entity()  // NÃO usar — é abstrata
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
  @DeleteDateColumn() deletedAt: Date | null;
}
```
Usar decorator `@Entity()` somente nas subclasses. A base deve ser marcada com `abstract`.

**Depende de:** Tarefa 1
**Testável:** ClientEntity herda sem erro de compilação

---

### Tarefa 4 — [TypeORM] DataSource + scripts de migration
**Arquivos:**
- `src/config/datasource.ts` — DataSource standalone para o TypeORM CLI
- `package.json` — adicionar scripts de migration

**O que fazer:**
O TypeORM CLI precisa de um arquivo `DataSource` separado do módulo NestJS:
```typescript
// src/config/datasource.ts
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
```

Scripts a adicionar em `package.json`:
```json
"migration:generate": "typeorm-ts-node-commonjs migration:generate src/database/migrations/migration -d src/config/datasource.ts",
"migration:run":      "typeorm-ts-node-commonjs migration:run -d src/config/datasource.ts",
"migration:revert":   "typeorm-ts-node-commonjs migration:revert -d src/config/datasource.ts",
"migration:show":     "typeorm-ts-node-commonjs migration:show -d src/config/datasource.ts"
```

Criar pasta `src/database/migrations/` (vazia com `.gitkeep`).

**Depende de:** Tarefa 2
**Testável:** `npm run migration:show` conecta no Postgres e lista (sem erro)

---

### Tarefa 5 — [AppModule] Registrar ConfigModule, TypeOrmModule, CacheModule
**Arquivo:** `src/app.module.ts`

**O que fazer:**
```typescript
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: JoiSchema }),
    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
        synchronize: false,
        logging: config.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: (config: ConfigService) => ({
        stores: [createKeyv(config.get('REDIS_URL'))],
        ttl: config.get<number>('CACHE_TTL_SECONDS') * 1000,
      }),
      inject: [ConfigService],
    }),
  ],
})
```

**Depende de:** Tarefas 2, 3, 4
**Testável:** `npm run start:dev` sobe sem erros de conexão (Docker deve estar rodando)

---

### Tarefa 6 — [main.ts] ValidationPipe, prefixo, CORS, Swagger
**Arquivo:** `src/main.ts`

**O que fazer:**
```typescript
app.setGlobalPrefix('api/v1');
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
app.enableCors();

// Swagger — disponível em /docs
const config = new DocumentBuilder()
  .setTitle('TrafegoFlow API')
  .setVersion('1.0')
  .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'x-api-key')
  .build();
SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
```

**Depende de:** Tarefa 5
**Testável:** `GET /docs` retorna o Swagger UI; `POST /api/v1/clients` com body inválido retorna 400

---

### Tarefa 7 — [Guard] ApiKeyGuard
**Arquivo:** `src/common/guards/api-key.guard.ts`

**O que fazer:**
```typescript
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['x-api-key'];
    return key === this.config.get('MASTER_API_KEY');
  }
}
```

**Depende de:** Tarefa 2
**Testável:** aplicar no controller de teste e verificar 401 sem header

---

### Tarefa 8 — [Health] HealthModule
**Arquivos:**
- `src/modules/health/health.module.ts`
- `src/modules/health/health.controller.ts`

**O que fazer:**
- Importar `TerminusModule` e `HttpModule`
- `HealthController` usa `TypeOrmHealthIndicator.pingCheck('database')` e faz ping manual no Redis via `CACHE_MANAGER`
- Rota: `GET /health` (sem prefixo `/api/v1`, sem guard)
- Registrar `HealthModule` em `app.module.ts`

**Depende de:** Tarefas 5, 6
**Testável:** `GET /health` retorna `{ status: "ok", ... }` com Docker rodando

---

### Tarefa 9 — [Entity] ClientEntity
**Arquivo:** `src/modules/clients/entities/client.entity.ts`

**O que fazer:**
```typescript
@Entity('clients')
export class ClientEntity extends BaseEntity {
  @Column({ length: 200 })
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ default: true })
  isActive: boolean;
}
```

Sem relacionamentos com `IntegrationEntity` e `LeadEntity` por agora — essas entities não existem ainda e causariam erro de compilação.

**Depende de:** Tarefa 3
**Testável:** compilação sem erro

---

### Tarefa 10 — [Migration] Gerar migration para tabela `clients`
**Arquivo gerado:** `src/database/migrations/{timestamp}-CreateClientsTable.ts`

**O que fazer:**
```bash
npm run migration:generate -- --name=CreateClientsTable
```
Revisar o arquivo gerado e confirmar que contém: `CREATE TABLE "clients"`, colunas corretas, índice único em `email`, `deleted_at` para soft delete.

**Depende de:** Tarefa 9 + Docker rodando
**Testável:** `npm run migration:run` executa sem erro; tabela aparece no Postgres

---

### Tarefa 11 — [Interface + DTOs] Contratos do módulo Clients
**Arquivos:**
- `src/modules/clients/interfaces/clients-service.interface.ts`
- `src/modules/clients/dto/create-client.dto.ts`
- `src/modules/clients/dto/update-client.dto.ts`

**O que fazer:** Conforme spec seções 8 e 9. `UpdateClientDto` usa `PartialType(CreateClientDto)` do `@nestjs/swagger` + campo `isActive` extra.

**Depende de:** Tarefa 1
**Testável:** compilação sem erro

---

### Tarefa 12 — [Service] ClientsService
**Arquivo:** `src/modules/clients/clients.service.ts`

**O que fazer:** Implementar `IClientsService`:
- `create`: `repository.save()` → lança `ConflictException` se `QueryFailedError` com código `23505` (unique violation)
- `findAll`: `repository.find({ where: { isActive: true } })` (sem soft-deleted)
- `findOne`: cache hit → retorna; miss → `repository.findOneOrFail()` → lança `NotFoundException` → seta cache
- `update`: `findOne()` → `repository.save()` → invalida cache
- `remove`: `repository.softRemove()` → invalida cache

**Depende de:** Tarefas 9, 11
**Testável:** testes unitários com mock do repositório (Tarefa 13)

---

### Tarefa 13 — [Testes] ClientsService unit tests
**Arquivo:** `src/modules/clients/clients.service.spec.ts`

**Cenários a cobrir:**
- `create` — sucesso retorna entity
- `create` — email duplicado lança `ConflictException`
- `findOne` — cache hit não chama repositório
- `findOne` — cache miss chama repositório e seta cache
- `findOne` — id inexistente lança `NotFoundException`
- `update` — sucesso invalida cache
- `remove` — sucesso invalida cache

**Depende de:** Tarefa 12
**Testável:** `npm run test` passa todos os cenários

---

### Tarefa 14 — [Controller] ClientsController
**Arquivo:** `src/modules/clients/clients.controller.ts`

**O que fazer:**
```typescript
@Controller('clients')
@UseGuards(ApiKeyGuard)
@ApiSecurity('x-api-key')
export class ClientsController {
  @Post()          @HttpCode(201)  create(@Body() dto: CreateClientDto)
  @Get()                           findAll()
  @Get(':id')                      findOne(@Param('id', ParseUUIDPipe) id: string)
  @Patch(':id')                    update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClientDto)
  @Delete(':id')   @HttpCode(204)  remove(@Param('id', ParseUUIDPipe) id: string)
}
```

`ParseUUIDPipe` já faz validação de formato uuid (400 se inválido).

**Depende de:** Tarefas 7, 12
**Testável:** testes e2e (Tarefa 16)

---

### Tarefa 15 — [Module] ClientsModule + registrar no AppModule
**Arquivos:**
- `src/modules/clients/clients.module.ts`
- `src/app.module.ts` (modificação)

**O que fazer:**
```typescript
@Module({
  imports: [TypeOrmModule.forFeature([ClientEntity])],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
```
Importar `ClientsModule` e `HealthModule` em `app.module.ts`.

**Depende de:** Tarefas 8, 14
**Testável:** `npm run start:dev` sobe sem erros de DI

---

### Tarefa 16 — [Testes] e2e do fluxo completo
**Arquivo:** `test/clients.e2e-spec.ts`

**Cenários a cobrir:**
- `POST /api/v1/clients` sem x-api-key → 401
- `POST /api/v1/clients` com body inválido → 400
- `POST /api/v1/clients` com dados válidos → 201 + body com id
- `POST /api/v1/clients` com email duplicado → 409
- `GET /api/v1/clients` → 200 com array
- `GET /api/v1/clients/:id` válido → 200
- `GET /api/v1/clients/{uuid-inexistente}` → 404
- `PATCH /api/v1/clients/:id` → 200 com dados atualizados
- `DELETE /api/v1/clients/:id` → 204

**Depende de:** Tarefa 15
**Testável:** `npm run test:e2e` (requer Docker rodando + migration executada)

---

## Estimativa

| # | Tarefa | Complexidade | Estimativa |
|---|--------|--------------|------------|
| 1 | Instalar dependências | Baixa | 10 min |
| 2 | ConfigModule + Joi | Baixa | 30 min |
| 3 | BaseEntity abstrata | Baixa | 15 min |
| 4 | DataSource + migration scripts | Média | 30 min |
| 5 | AppModule (TypeORM + Cache) | Média | 45 min |
| 6 | main.ts (pipes, swagger, cors) | Baixa | 20 min |
| 7 | ApiKeyGuard | Baixa | 15 min |
| 8 | HealthModule | Baixa | 30 min |
| 9 | ClientEntity | Baixa | 15 min |
| 10 | Gerar e executar migration | Baixa | 20 min |
| 11 | Interface + DTOs | Baixa | 20 min |
| 12 | ClientsService | Alta | 1h |
| 13 | Testes unitários Service | Média | 45 min |
| 14 | ClientsController | Média | 30 min |
| 15 | ClientsModule + AppModule | Baixa | 15 min |
| 16 | Testes e2e | Média | 45 min |

**Total estimado:** ~7h de implementação

---

## Riscos e Dependências

### Riscos técnicos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| API do `@keyv/redis` com `@nestjs/cache-manager` v3 é nova e pode ter breaking changes | Média | Alto | Verificar docs oficiais NestJS 11 antes de implementar Tarefa 5; fallback: usar `ioredis` direto com wrapper manual |
| `typeorm-ts-node-commonjs` pode não resolver paths com `NodeNext` module resolution | Média | Médio | Ajustar `tsconfig` do datasource se necessário; alternativa: usar `ts-node` com `esm` |
| Soft delete com `@DeleteDateColumn` requer `withDeleted: false` explícito nos finds | Baixa | Médio | Usar `repository.find({ withDeleted: false })` ou configurar `softDelete: true` globalmente |

### Dependências externas

- **Docker deve estar rodando** antes das Tarefas 10 e 16 (`npm run migration:run` e e2e precisam de Postgres real)
- **Porta 5432 e 6379 livres** no host (docker-compose faz binding direto)

### Pontos de atenção

- `synchronize: false` é obrigatório — nunca usar `synchronize: true` mesmo em dev, para garantir que o fluxo de migrations funcione desde o início
- O `HealthModule` **não deve ter prefixo `/api/v1`** — o Render usa `/health` diretamente
- `ApiKeyGuard` deve ser aplicado por controller, não globalmente, pois `/health` e `/docs` devem ser públicos
- Os relacionamentos `OneToMany` com `IntegrationEntity` e `LeadEntity` serão adicionados à `ClientEntity` quando esses módulos forem implementados — por ora a entity fica sem esses campos para evitar erro de compilação

---

## Ordem de execução visual

```
[1] npm install
     ↓
[2] ConfigModule     [3] BaseEntity       (paralelo)
     ↓                    ↓
[4] DataSource + scripts migration
     ↓
[5] AppModule (TypeORM + Cache registrados)
     ↓
[6] main.ts          [7] ApiKeyGuard      (paralelo)
     ↓                    ↓
[8] HealthModule     [9] ClientEntity     (paralelo)
                          ↓
                     [10] Migration run
                          ↓
                     [11] Interface + DTOs
                          ↓
                     [12] ClientsService
                      ↓          ↓
                [13] Unit tests  [14] Controller  (paralelo)
                                      ↓
                                 [15] Module + AppModule
                                      ↓
                                 [16] e2e tests
```
