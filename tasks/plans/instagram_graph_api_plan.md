# Plano de Implementação: Instagram Graph API

**Spec:** `tasks/specs/instagram_graph_api_spec.md`
**Data:** 2026-05-27

---

## Análise de Alternativas

### Exclusão do `accessToken` nas respostas

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| A (Escolhida) | `@Exclude()` na entidade + `ClassSerializerInterceptor` global | Automático, sem esquecer campo em nenhum endpoint | Exige `excludeExtraneousValues` e atenção à serialização em testes |
| B | DTO de resposta separado (`IntegrationResponseDto`) | Explícito, sem magia | Duplica estrutura, verboso |

**Decisão:** Alternativa A — `@Exclude()` é o padrão NestJS para campos sensíveis; o interceptor já está disponível via `ClassSerializerInterceptor` do `@nestjs/common`.

---

### Roteamento do webhook fora do prefixo `/api/v1`

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| A (Escolhida) | `app.setGlobalPrefix('api/v1', { exclude: ['webhook/(.*)'] })` em `main.ts` | Webhook acessível em `/webhook/instagram` sem prefixo | Requer ajuste em `main.ts` |
| B | Controller decorado com path absoluto via `@Controller('api/v1/webhook/instagram')` | Sem mudança em `main.ts` | Acoplado ao prefixo, quebra se prefixo mudar |

**Decisão:** Alternativa A — o Meta configura a URL do webhook no painel e não espera prefixo de versionamento; o `exclude` em `setGlobalPrefix` é a abordagem idiomática do NestJS.

---

### HTTP client para Graph API

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| A (Escolhida) | `@nestjs/axios` + `HttpModule` | Integrado com DI do NestJS, testável com mock do `HttpService` | Dependência nova |
| B | `fetch` nativo (Node 18+) | Zero dependência | Sem integração com DI; difícil de mockar em testes unitários |

**Decisão:** Alternativa A — `HttpService` do `@nestjs/axios` permite mock limpo via `jest.spyOn` nos testes unitários.

---

## Recursos Reutilizáveis Identificados

| Recurso | Arquivo | Uso nesta feature |
|---|---|---|
| `ApiKeyGuard` | `src/common/guards/api-key.guard.ts` | Proteger todos os endpoints de `/api/v1/integrations` |
| `BaseEntity` | `src/common/database/base.entity.ts` | Base para `IntegrationEntity` (id uuid, timestamps, soft delete) |
| Padrão `cacheKey` | `src/modules/clients/clients.service.ts` | Mesmo padrão para `integration:page:{pageId}` e `integration:id:{id}` |
| Padrão mock de testes | `src/modules/clients/clients.service.spec.ts` | Template para specs de `IntegrationsService` e webhook services |
| `ConfigService` | já global via `ConfigModule.forRoot({ isGlobal: true })` | Ler `ENCRYPTION_KEY`, `META_APP_SECRET`, `META_VERIFY_TOKEN` |

---

## Diagrama de Fluxo

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUXO INTEGRATIONS CRUD                      │
│                                                                 │
│  POST /api/v1/integrations                                      │
│      ↓ ApiKeyGuard (x-api-key)                                  │
│  IntegrationsController                                         │
│      ↓ ValidationPipe (CreateIntegrationDto)                    │
│  IntegrationsService.create()                                   │
│      ↓ AesCryptoService.encrypt(accessToken)                    │
│      ↓ IntegrationRepository.save()  → PostgreSQL               │
│      ↓ cache.set('integration:id:{id}')  → Redis               │
│      ↓ ClassSerializerInterceptor omite accessToken             │
│  → 201 IntegrationEntity (sem accessToken)                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    FLUXO WEBHOOK INSTAGRAM                      │
│                                                                 │
│  POST /webhook/instagram                                        │
│      ↓ Extrai rawBody antes do JSON parser                      │
│  InstagramWebhookController                                     │
│      ↓ InstagramWebhookService.handleEvent(payload, rawBody)    │
│      ├── validateSignature(rawBody, X-Hub-Signature-256)        │
│      │       ↓ HMAC-SHA256(appSecret, rawBody) com timingSafeEqual
│      │   → 403 se inválida                                      │
│      ├── Para cada entry.messaging:                             │
│      │   ↓ IntegrationsService.findByPageId(pageId)             │
│      │       ↓ cache.get('integration:page:{pageId}') → Redis   │
│      │       ↓ (miss) repo.findOne({ pageId }) → PostgreSQL     │
│      │   ↓ AesCryptoService.decrypt(accessToken)                │
│      │   ↓ [processar evento — fase 1: log + echo]              │
│      └── → 200 OK imediato                                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  FLUXO ENVIO DE RESPOSTA                        │
│                                                                 │
│  InstagramGraphService.sendTextMessage(pageId, igsid, text)     │
│      ↓ IntegrationsService.findByPageId(pageId)                 │
│      ↓ AesCryptoService.decrypt(accessToken)                    │
│      ↓ HttpService.post(                                        │
│            `${GRAPH_API_URL}/${VERSION}/me/messages`,           │
│            { recipient: { id: igsid }, message: { text } },     │
│            { params: { access_token } }                         │
│        )                                                        │
│      ↓ Se erro 190 → throw OAuthTokenExpiredException           │
│      → void                                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tarefas Sequenciais

### Tarefa 1 — [Deps] Instalar dependências e variáveis de ambiente
**O que fazer:**
1. Instalar `@nestjs/axios` e `axios`:
   ```bash
   npm install @nestjs/axios axios
   ```
2. Adicionar ao `.env` e `.env.example`:
   ```bash
   ENCRYPTION_KEY=<openssl rand -hex 32>
   META_APP_SECRET=<do Facebook Developer Console>
   META_VERIFY_TOKEN=<string aleatória>
   META_GRAPH_API_URL=https://graph.facebook.com
   META_GRAPH_API_VERSION=v21.0
   ```
3. Criar `src/config/meta.config.ts`:
   ```typescript
   export default registerAs('meta', () => ({
     appSecret: process.env.META_APP_SECRET,
     verifyToken: process.env.META_VERIFY_TOKEN,
     graphApiUrl: process.env.META_GRAPH_API_URL ?? 'https://graph.facebook.com',
     graphApiVersion: process.env.META_GRAPH_API_VERSION ?? 'v21.0',
   }));
   ```
4. Adicionar `encryptionKey` ao `app.config.ts`
5. Adicionar as novas envs ao `validationSchema` Joi em `configuration.ts`
6. Registrar `metaConfig` em `configLoads` em `configuration.ts`

**Depende de:** nada
**Testável:** `npm run start:dev` sem erro de validação Joi

---

### Tarefa 2 — [main.ts] Habilitar rawBody e excluir webhook do prefixo
**Arquivo:** `src/main.ts`
**O que fazer:**
1. Adicionar `rawBody: true` ao `NestFactory.create`:
   ```typescript
   const app = await NestFactory.create(AppModule, { rawBody: true });
   ```
2. Excluir rota webhook do prefixo global:
   ```typescript
   app.setGlobalPrefix('api/v1', {
     exclude: [{ path: 'webhook/(.*)', method: RequestMethod.ALL }],
   });
   ```
   Importar `RequestMethod` de `@nestjs/common`.
3. Adicionar `ClassSerializerInterceptor` global:
   ```typescript
   app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
   ```
   Importar `ClassSerializerInterceptor`, `Reflector` de `@nestjs/common`/`@nestjs/core`.

**Depende de:** nada (paralelo com Tarefa 1)
**Testável:** `npm run start:dev` sem erro; `GET /health` responde normalmente

---

### Tarefa 3 — [Crypto] AesCryptoService
**Arquivo:** `src/common/crypto/aes.service.ts`
**O que fazer:**
```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, createDecipheriv } from 'crypto';

@Injectable()
export class AesCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.get<string>('app.encryptionKey')!, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // formato: iv(12B):tag(16B):ciphertext — tudo em base64
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  decrypt(ciphertext: string): string {
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }
}
```
Criar também `src/common/crypto/crypto.module.ts` exportando `AesCryptoService` para ser importado pelos outros módulos.

**Depende de:** Tarefa 1 (env var `ENCRYPTION_KEY`)
**Testável:** `npm run test` — spec unitário com roundtrip encrypt/decrypt

---

### Tarefa 4 — [Entity] IntegrationEntity + Migration
**Arquivos:**
- `src/modules/integrations/entities/integration.entity.ts`
- Migration gerada via `npm run migration:generate`

**O que fazer:**
```typescript
export enum MetaPlatform {
  INSTAGRAM = 'instagram',
  WHATSAPP = 'whatsapp',
}

@Entity('integrations')
export class IntegrationEntity extends BaseEntity {
  @Column({ name: 'client_id' })
  clientId: string;

  @ManyToOne(() => ClientEntity)
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ type: 'enum', enum: MetaPlatform })
  platform: MetaPlatform;

  @Column({ name: 'page_id', unique: true })
  pageId: string;

  @Column({ name: 'access_token', type: 'text' })
  @Exclude()                              // nunca serializar em resposta JSON
  accessToken: string;

  @Column({ name: 'token_expires_at', type: 'timestamptz', nullable: true })
  tokenExpiresAt: Date | null;

  @Column({ default: true })
  isActive: boolean;
}
```
Após criar a entity, rodar:
```bash
npm run migration:generate
```

**Depende de:** Tarefa 1
**Testável:** migration roda sem erro (`npm run migration:run`)

---

### Tarefa 5 — [Interface + DTOs] Contratos do módulo Integrations
**Arquivos:**
- `src/modules/integrations/interfaces/integrations-service.interface.ts`
- `src/modules/integrations/dto/create-integration.dto.ts`
- `src/modules/integrations/dto/update-integration.dto.ts`

**O que fazer:**

Interface:
```typescript
export interface IIntegrationsService {
  create(dto: CreateIntegrationDto): Promise<IntegrationEntity>;
  findAll(clientId: string): Promise<IntegrationEntity[]>;
  findOne(id: string): Promise<IntegrationEntity>;
  findByPageId(pageId: string): Promise<IntegrationEntity>;
  update(id: string, dto: UpdateIntegrationDto): Promise<IntegrationEntity>;
  remove(id: string): Promise<void>;
}
```

Create DTO:
```typescript
export class CreateIntegrationDto {
  @IsUUID()
  clientId: string;

  @IsEnum(MetaPlatform)
  platform: MetaPlatform;

  @IsString() @IsNotEmpty()
  pageId: string;

  @IsString() @IsNotEmpty()
  accessToken: string;          // plaintext — criptografado no service

  @IsOptional() @IsDateString()
  tokenExpiresAt?: string;
}
```

Update DTO — só campos mutáveis:
```typescript
export class UpdateIntegrationDto {
  @IsString() @IsOptional()
  accessToken?: string;

  @IsDateString() @IsOptional()
  tokenExpiresAt?: string;

  @IsBoolean() @IsOptional()
  isActive?: boolean;
}
```

**Depende de:** Tarefa 4 (enum `MetaPlatform`)
**Testável:** compilação sem erro

---

### Tarefa 6 — [Service] IntegrationsService
**Arquivo:** `src/modules/integrations/integrations.service.ts`
**O que fazer:**

Implementar `IIntegrationsService` seguindo o mesmo padrão de `ClientsService`:
- `create`: criptografar `accessToken` antes de salvar; popular cache `integration:id:{id}` após salvar
- `findAll(clientId)`: `repo.find({ where: { clientId, isActive: true } })`
- `findOne(id)`: cache hit em `integration:id:{id}` → miss → query → popular cache
- `findByPageId(pageId)`: cache hit em `integration:page:{pageId}` → miss → query → popular ambas as chaves de cache
- `update(id, dto)`: se `dto.accessToken` presente, criptografar antes de salvar; invalidar `integration:id:{id}` e `integration:page:{pageId}`
- `remove(id)`: `repo.softRemove`; invalidar ambas as chaves de cache

Tratar erro `23505` (pageId único) → `ConflictException`.

**Depende de:** Tarefas 3, 4, 5
**Testável:** `npm run test` — spec unitário

---

### Tarefa 7 — [Controller + Module] IntegrationsController e IntegrationsModule
**Arquivos:**
- `src/modules/integrations/integrations.controller.ts`
- `src/modules/integrations/integrations.module.ts`

**Controller** — seguir padrão de `ClientsController`:
```
POST   /integrations         → create (201)
GET    /integrations?clientId → findAll
GET    /integrations/:id      → findOne
PATCH  /integrations/:id      → update
DELETE /integrations/:id      → remove (204)
```
- `@ApiTags('integrations')`, `@ApiSecurity('x-api-key')`, `@UseGuards(ApiKeyGuard)`
- Query param `clientId` no `findAll`: `@Query('clientId', ParseUUIDPipe) clientId: string`

**Module:**
```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([IntegrationEntity]),
    CryptoModule,
  ],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],       // WebhookModule vai importar
})
export class IntegrationsModule {}
```

**Depende de:** Tarefas 3, 6
**Testável:** `npm run start:dev`; `POST /api/v1/integrations` retorna 201

---

### Tarefa 8 — [Webhook] Interfaces e Controller de verificação
**Arquivos:**
- `src/modules/webhook/instagram/interfaces/instagram-webhook-event.interface.ts`
- `src/modules/webhook/instagram/interfaces/instagram-graph.interface.ts`
- `src/modules/webhook/instagram/instagram-webhook.controller.ts`

**Interfaces do payload:**
```typescript
export interface InstagramWebhookPayload {
  object: 'instagram';
  entry: InstagramEntry[];
}

export interface InstagramEntry {
  id: string;          // pageId
  time: number;
  messaging: InstagramMessagingEvent[];
}

export interface InstagramMessagingEvent {
  sender: { id: string };      // IGSID do usuário
  recipient: { id: string };   // pageId
  timestamp: number;
  message?: { mid: string; text?: string };
  reaction?: { mid: string; action: string; emoji?: string };
  read?: { mid: string };
}
```

**Controller — verificação GET:**
```typescript
@Controller('webhook/instagram')
export class InstagramWebhookController {
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    return this.webhookService.verifyWebhook(mode, token, challenge);
  }

  @Post()
  @HttpCode(200)
  handleEvent(
    @Body() payload: InstagramWebhookPayload,
    @RawBody() rawBody: Buffer,
    @Headers('x-hub-signature-256') signature: string,
  ): Promise<void> {
    return this.webhookService.handleEvent(payload, rawBody, signature);
  }
}
```

Nota: `@RawBody()` é o decorator nativo do NestJS quando `rawBody: true` está habilitado — importar de `@nestjs/common`.

**Depende de:** Tarefa 2 (rawBody em main.ts)
**Testável:** compilação sem erro

---

### Tarefa 9 — [Service] InstagramWebhookService
**Arquivo:** `src/modules/webhook/instagram/instagram-webhook.service.ts`
**O que fazer:**

```typescript
@Injectable()
export class InstagramWebhookService implements IInstagramWebhookService {
  constructor(
    private readonly config: ConfigService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  verifyWebhook(mode: string, token: string, challenge: string): string {
    if (mode !== 'subscribe' || token !== this.config.get('meta.verifyToken')) {
      throw new ForbiddenException('Webhook verification failed');
    }
    return challenge;
  }

  async handleEvent(
    payload: InstagramWebhookPayload,
    rawBody: Buffer,
    signature: string,
  ): Promise<void> {
    this.validateSignature(rawBody, signature);    // lança ForbiddenException se falhar

    for (const entry of payload.entry) {
      for (const event of entry.messaging ?? []) {
        await this.processEvent(entry.id, event).catch((err) =>
          // pageId desconhecido → warn e continua; nunca deixa o Meta receber erro
          Logger.warn(`Skipping event for unknown pageId ${entry.id}: ${err.message}`, 'InstagramWebhook'),
        );
      }
    }
  }

  private validateSignature(rawBody: Buffer, signature: string): void {
    const expected = createHmac('sha256', this.config.get<string>('meta.appSecret')!)
      .update(rawBody)
      .digest('hex');
    const safe = timingSafeEqual(
      Buffer.from(`sha256=${expected}`),
      Buffer.from(signature ?? ''),
    );
    if (!safe) throw new ForbiddenException('Invalid webhook signature');
  }

  private async processEvent(pageId: string, event: InstagramMessagingEvent): Promise<void> {
    const integration = await this.integrationsService.findByPageId(pageId);
    if (!integration.isActive) return;
    // Fase 1: apenas log estruturado — bot logic virá no módulo conversations/bot
    Logger.log(
      `[${integration.clientId}] msg from ${event.sender.id}: ${event.message?.text ?? '[no-text]'}`,
      'InstagramWebhook',
    );
  }
}
```

**Depende de:** Tarefas 6, 8
**Testável:** testes unitários com mock de `ConfigService` e `IntegrationsService`

---

### Tarefa 10 — [Service] InstagramGraphService
**Arquivo:** `src/modules/webhook/instagram/instagram-graph.service.ts`
**O que fazer:**

```typescript
@Injectable()
export class InstagramGraphService implements IInstagramGraphService {
  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly integrationsService: IntegrationsService,
    private readonly crypto: AesCryptoService,
  ) {}

  async sendTextMessage(pageId: string, recipientIgsid: string, text: string): Promise<void> {
    const token = await this.getDecryptedToken(pageId);
    const url = `${this.baseUrl}/me/messages`;
    await this.post(url, token, {
      recipient: { id: recipientIgsid },
      message: { text },
    });
  }

  async sendQuickReplies(pageId: string, recipientIgsid: string, text: string, options: string[]): Promise<void> {
    const token = await this.getDecryptedToken(pageId);
    await this.post(`${this.baseUrl}/me/messages`, token, {
      recipient: { id: recipientIgsid },
      message: {
        text,
        quick_replies: options.map((title) => ({ content_type: 'text', title, payload: title })),
      },
    });
  }

  async markSeen(pageId: string, recipientIgsid: string): Promise<void> {
    const token = await this.getDecryptedToken(pageId);
    await this.post(`${this.baseUrl}/me/messages`, token, {
      recipient: { id: recipientIgsid },
      sender_action: 'mark_seen',
    });
  }

  private get baseUrl(): string {
    const url = this.config.get<string>('meta.graphApiUrl');
    const version = this.config.get<string>('meta.graphApiVersion');
    return `${url}/${version}`;
  }

  private async getDecryptedToken(pageId: string): Promise<string> {
    const integration = await this.integrationsService.findByPageId(pageId);
    return this.crypto.decrypt(integration.accessToken);
  }

  private async post(url: string, token: string, body: object): Promise<void> {
    await firstValueFrom(
      this.httpService.post(url, body, { params: { access_token: token } }),
    ).catch((err) => {
      const code = err?.response?.data?.error?.code;
      if (code === 190) throw new OAuthTokenExpiredException(pageId);
      throw err;
    });
  }
}
```

Criar `src/modules/webhook/instagram/exceptions/oauth-token-expired.exception.ts`:
```typescript
export class OAuthTokenExpiredException extends Error {
  constructor(pageId: string) {
    super(`OAuth token expired for pageId ${pageId}`);
  }
}
```

**Depende de:** Tarefas 3, 6, 9
**Testável:** testes unitários com mock de `HttpService`

---

### Tarefa 11 — [Module] WebhookModule
**Arquivo:** `src/modules/webhook/webhook.module.ts`
**O que fazer:**
```typescript
@Module({
  imports: [
    HttpModule,                    // @nestjs/axios
    IntegrationsModule,            // para IntegrationsService
    CryptoModule,                  // para AesCryptoService
  ],
  controllers: [InstagramWebhookController],
  providers: [InstagramWebhookService, InstagramGraphService],
  exports: [InstagramGraphService],
})
export class WebhookModule {}
```

**Depende de:** Tarefas 7, 9, 10
**Testável:** `npm run start:dev` sem erros de injeção

---

### Tarefa 12 — [App] Registrar módulos em app.module.ts
**Arquivo:** `src/app.module.ts`
**O que fazer:**
```typescript
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { WebhookModule } from './modules/webhook/webhook.module.js';

// Adicionar no array imports:
IntegrationsModule,
WebhookModule,
```

**Depende de:** Tarefas 7, 11
**Testável:** `npm run start:dev`; todos os endpoints respondem; `POST /webhook/instagram` retorna 200 com assinatura válida

---

### Tarefa 13 — [Testes] AesCryptoService
**Arquivo:** `src/common/crypto/aes.service.spec.ts`
**Cenários:**
- encrypt/decrypt roundtrip retorna o mesmo texto
- dois encrypts do mesmo texto produzem ciphertexts diferentes (IV aleatório)
- decrypt com ciphertext adulterado lança erro (GCM auth tag falha)

**Depende de:** Tarefa 3
**Testável:** `npm run test`

---

### Tarefa 14 — [Testes] IntegrationsService
**Arquivo:** `src/modules/integrations/integrations.service.spec.ts`
**Cenários:** seguir padrão de `clients.service.spec.ts`
- `create`: criptografa token antes de salvar; retorna entity; 409 em pageId duplicado
- `findAll(clientId)`: filtra por clientId e isActive
- `findOne(id)`: cache hit sem query; miss popula cache; 404 em inexistente
- `findByPageId(pageId)`: cache hit; miss com dupla população de cache
- `update`: se `accessToken` no dto, criptografa; invalida ambas as chaves de cache
- `remove`: soft remove; invalida ambas as chaves

**Mocks necessários:** `getRepositoryToken(IntegrationEntity)`, `CACHE_MANAGER`, `AesCryptoService`

**Depende de:** Tarefa 6
**Testável:** `npm run test`

---

### Tarefa 15 — [Testes] InstagramWebhookService
**Arquivo:** `src/modules/webhook/instagram/instagram-webhook.service.spec.ts`
**Cenários:**
- `verifyWebhook`: retorna challenge com token correto; lança `ForbiddenException` com token errado
- `handleEvent`: lança `ForbiddenException` com assinatura inválida; processa e loga mensagem com assinatura válida; descarta silenciosamente pageId desconhecido (sem relançar erro)

**Mocks:** `ConfigService`, `IntegrationsService`

**Depende de:** Tarefa 9
**Testável:** `npm run test`

---

### Tarefa 16 — [Testes] InstagramGraphService
**Arquivo:** `src/modules/webhook/instagram/instagram-graph.service.spec.ts`
**Cenários:**
- `sendTextMessage`: chama `HttpService.post` com URL, body e access_token corretos
- `sendTextMessage` com erro 190: lança `OAuthTokenExpiredException`
- `sendQuickReplies`: formata `quick_replies` corretamente
- `markSeen`: envia `sender_action: 'mark_seen'`

**Mock:** `HttpService` via `jest.spyOn(httpService, 'post').mockReturnValue(of({ data: {} }))`

**Depende de:** Tarefa 10
**Testável:** `npm run test`

---

## Estimativa

| Tarefa | Descrição | Complexidade | Estimativa |
|---|---|---|---|
| 1 | Deps + env vars + meta.config | Baixa | 20 min |
| 2 | main.ts (rawBody + exclude + interceptor) | Baixa | 15 min |
| 3 | AesCryptoService | Média | 30 min |
| 4 | IntegrationEntity + migration | Baixa | 20 min |
| 5 | Interface + DTOs | Baixa | 25 min |
| 6 | IntegrationsService | Alta | 1h |
| 7 | IntegrationsController + Module | Média | 30 min |
| 8 | Interfaces webhook + Controller | Média | 30 min |
| 9 | InstagramWebhookService | Alta | 1h |
| 10 | InstagramGraphService | Alta | 1h |
| 11 | WebhookModule | Baixa | 15 min |
| 12 | Registrar em app.module.ts | Baixa | 5 min |
| 13 | Testes AesCryptoService | Baixa | 20 min |
| 14 | Testes IntegrationsService | Média | 45 min |
| 15 | Testes InstagramWebhookService | Média | 40 min |
| 16 | Testes InstagramGraphService | Média | 40 min |
| **Total** | | | **~8h** |

---

## Riscos e Dependências Externas

### Riscos técnicos

| Risco | Probabilidade | Mitigação |
|---|---|---|
| `timingSafeEqual` exige Buffers do mesmo tamanho | Alta | Garantir que o header `X-Hub-Signature-256` sempre chegue; tratar ausência com `ForbiddenException` antes de chamar `timingSafeEqual` |
| `rawBody` não disponível se `NestFactory.create` sem opção | Alta | Tarefa 2 obrigatória antes de qualquer teste do webhook |
| Token GCM com IV embutido: formato `iv:tag:cipher` deve ser consistente | Média | Definir na Tarefa 3 e usar apenas via `AesCryptoService` — nunca manipular diretamente |
| Meta pode mudar estrutura do payload entre versões da Graph API | Baixa | Interfaces definem apenas campos usados; campos extras são ignorados |
| `ClassSerializerInterceptor` global pode afetar serialização de outros módulos | Baixa | Verificar que `ClientEntity` não tem campos com `@Expose()` conflitantes após ativar |

### Pacotes a instalar antes de começar

```bash
npm install @nestjs/axios axios
```

### Envs obrigatórias para rodar localmente

```bash
ENCRYPTION_KEY=    # openssl rand -hex 32
META_APP_SECRET=   # qualquer string nos testes; real no painel Meta
META_VERIFY_TOKEN= # qualquer string; mesma configurada no painel Meta
```

### Pontos de incerteza (a validar com o webhook real do Meta)

1. O Meta inclui `X-Hub-Signature-256` em **todos** os POSTs ou só em alguns tipos de evento?
2. O campo `messaging` é sempre presente em `entry` ou apenas para eventos de mensagem? — coberto na interface com `messaging?: InstagramMessagingEvent[]`
3. Story replies chegam via `messaging` ou via campo separado `changes`? — verificar na documentação do Meta antes da Tarefa 9

---

## Ordem de Execução Visual

```
Tarefa 1 ──┬── Tarefa 2
           │
           ├── Tarefa 3 ──── Tarefa 6 ──┬── Tarefa 7 ──┬── Tarefa 12
           │                            │              │
           └── Tarefa 4 ──── Tarefa 5 ──┘              │
                                                       │
           Tarefa 2 ──── Tarefa 8 ──── Tarefa 9 ───────┤
                                                       │
                         Tarefa 10 ────────────────────┤
                                                       │
                         Tarefa 11 ────────────────────┘

Testes (paralelos após implementação):
  Tarefa 3 → Tarefa 13
  Tarefa 6 → Tarefa 14
  Tarefa 9 → Tarefa 15
  Tarefa 10 → Tarefa 16
```
