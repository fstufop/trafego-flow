# Conversation Rules — Auto-reply Instagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `conversation-rules` module that closes the webhook cycle — when someone comments on a configured Instagram post or sends a DM with a keyword, the system automatically replies with a configured message.

**Architecture:** New `ConversationRulesModule` provides CRUD for rules and exposes `ConversationRulesService` (matching + `getRecentPosts`). Inside `WebhookModule`, two new services handle the bot logic: `ReplyBuilderService` (builds the Graph API call from a rule's JSONB reply) and `ConversationBotService` (orchestrates matching + sending). `InstagramWebhookService.handleEvent` is updated to fire-and-forget so it returns 200 before processing. The existing `entry[].changes[]` path (comments) is added alongside the existing `entry[].messaging[]` path (DMs).

**Tech Stack:** NestJS 11, TypeORM + PostgreSQL (JSONB), class-validator, Jest 30, `@nestjs/axios` HttpService

**Spec:** `docs/superpowers/specs/2026-09-09-conversation-rules-design.md`

## Global Constraints

- TypeScript + NodeNext resolution — all imports use `.js` extension (e.g. `./foo.js`)
- No `synchronize: true` — schema changes only through migrations
- All entities extend `BaseEntity` from `../../../common/database/base.entity.js`
- Soft delete via TypeORM `@DeleteDateColumn`; `find()` automatically excludes `deleted_at IS NOT NULL`
- New endpoints protected by `AuthGuard` from `../../common/guards/auth.guard.js`
- Test files: `jest.clearAllMocks()` in `beforeEach`, single `describe` level per class
- Run a single test file: `npx jest --testPathPattern=<filename> --no-coverage`
- Commit after each task passes its tests

---

## File Map

**New files:**
```
src/modules/conversation-rules/
├─ enums/rule-type.enum.ts
├─ entities/conversation-rule.entity.ts
├─ dto/create-conversation-rule.dto.ts
├─ dto/update-conversation-rule.dto.ts
├─ conversation-rules.service.ts
├─ conversation-rules.service.spec.ts
├─ conversation-rules.controller.ts
└─ conversation-rules.module.ts

src/modules/webhook/instagram/
├─ reply-builder.service.ts
├─ reply-builder.service.spec.ts
├─ conversation-bot.service.ts
└─ conversation-bot.service.spec.ts

src/database/migrations/
└─ 1783000000000-CreateConversationRulesTable.ts
```

**Modified files:**
```
src/modules/webhook/instagram/interfaces/instagram-webhook-event.interface.ts  ← add InstagramCommentChangeEvent + changes field to InstagramEntry
src/modules/webhook/instagram/instagram-webhook.service.ts                      ← fire-and-forget + dispatch comments
src/modules/webhook/instagram/instagram-webhook.service.spec.ts                 ← add 3 new test cases
src/modules/webhook/webhook.module.ts                                           ← add ConversationRulesModule + new providers
src/app.module.ts                                                                ← add ConversationRulesModule
```

---

### Task 1: Entity, enum, and migration

**Files:**
- Create: `src/modules/conversation-rules/enums/rule-type.enum.ts`
- Create: `src/modules/conversation-rules/entities/conversation-rule.entity.ts`
- Create: `src/database/migrations/1783000000000-CreateConversationRulesTable.ts`

**Interfaces:**
- Produces: `RuleType` enum, `ConversationReply` interface, `ConversationRuleEntity` class — used by Tasks 2, 3, 4, 5

- [ ] **Step 1: Create the enum**

```typescript
// src/modules/conversation-rules/enums/rule-type.enum.ts
export enum RuleType {
  POST_COMMENT = 'post_comment',
  KEYWORD_DM = 'keyword_dm',
  DEFAULT = 'default',
}
```

- [ ] **Step 2: Create the entity**

```typescript
// src/modules/conversation-rules/entities/conversation-rule.entity.ts
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { ClientEntity } from '../../clients/entities/client.entity.js';
import { RuleType } from '../enums/rule-type.enum.js';

export interface ConversationReply {
  text?: string;
  quickReplies?: string[];
  waLink?: string;
}

@Entity('conversation_rules')
export class ConversationRuleEntity extends BaseEntity {
  @Column({ name: 'client_id' })
  clientId: string;

  @ManyToOne(() => ClientEntity)
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ type: 'enum', enum: RuleType })
  type: RuleType;

  @Column({ name: 'trigger_value', type: 'varchar', nullable: true })
  triggerValue: string | null;

  @Column({ type: 'jsonb' })
  reply: ConversationReply;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
```

- [ ] **Step 3: Create the migration**

```typescript
// src/database/migrations/1783000000000-CreateConversationRulesTable.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConversationRulesTable1783000000000 implements MigrationInterface {
  name = 'CreateConversationRulesTable1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "rule_type_enum" AS ENUM ('post_comment', 'keyword_dm', 'default')
    `);

    await queryRunner.query(`
      CREATE TABLE "conversation_rules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "client_id" uuid NOT NULL,
        "type" "rule_type_enum" NOT NULL,
        "trigger_value" character varying,
        "reply" jsonb NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_conversation_rules" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_conv_rules_client_type_trigger"
      ON "conversation_rules" ("client_id", "type", COALESCE("trigger_value", ''))
      WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "conversation_rules"
        ADD CONSTRAINT "FK_conversation_rules_client_id"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversation_rules" DROP CONSTRAINT "FK_conversation_rules_client_id"`);
    await queryRunner.query(`DROP INDEX "UQ_conv_rules_client_type_trigger"`);
    await queryRunner.query(`DROP TABLE "conversation_rules"`);
    await queryRunner.query(`DROP TYPE "rule_type_enum"`);
  }
}
```

- [ ] **Step 4: Run the migration**

```bash
npm run migration:run
```

Expected: migration `CreateConversationRulesTable1783000000000` marked as executed with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/conversation-rules/enums/rule-type.enum.ts \
        src/modules/conversation-rules/entities/conversation-rule.entity.ts \
        src/database/migrations/1783000000000-CreateConversationRulesTable.ts
git commit -m "feat(conversation-rules): add entity, enum and migration"
```

---

### Task 2: ConversationRulesService

**Files:**
- Create: `src/modules/conversation-rules/conversation-rules.service.ts`
- Create: `src/modules/conversation-rules/conversation-rules.service.spec.ts`

**Interfaces:**
- Consumes: `ConversationRuleEntity`, `RuleType` (Task 1); `IntegrationsService.findByPageId(pageId)` (existing); `AesCryptoService.decrypt(ciphertext)` (existing); `HttpService.get(url, config)` (existing); `ConfigService.get('meta.graphApiUrl')`, `ConfigService.get('meta.graphApiVersion')` (existing)
- Produces:
  - `create(dto): Promise<ConversationRuleEntity>`
  - `findAll(clientId): Promise<ConversationRuleEntity[]>`
  - `update(id, dto): Promise<ConversationRuleEntity>`
  - `remove(id): Promise<void>`
  - `findKeywordRule(clientId, text): Promise<ConversationRuleEntity | null>`
  - `findDefaultRule(clientId): Promise<ConversationRuleEntity | null>`
  - `findPostRule(clientId, postId): Promise<ConversationRuleEntity | null>`
  - `getRecentPosts(pageId): Promise<Array<{id: string; caption: string | null; timestamp: string; permalink: string}>>`

- [ ] **Step 1: Write failing tests**

```typescript
// src/modules/conversation-rules/conversation-rules.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { of } from 'rxjs';
import { ConversationRulesService } from './conversation-rules.service.js';
import { ConversationRuleEntity } from './entities/conversation-rule.entity.js';
import { RuleType } from './enums/rule-type.enum.js';

const mockRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  softDelete: jest.fn(),
};

const mockIntegrationsService = {
  findByPageId: jest.fn(),
};

const mockCrypto = {
  decrypt: jest.fn().mockReturnValue('plain-token'),
};

const mockHttp = {
  get: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'meta.graphApiUrl') return 'https://graph.facebook.com';
    if (key === 'meta.graphApiVersion') return 'v21.0';
    return undefined;
  }),
};

describe('ConversationRulesService', () => {
  let service: ConversationRulesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationRulesService,
        { provide: getRepositoryToken(ConversationRuleEntity), useValue: mockRepo },
        { provide: 'IntegrationsService', useValue: mockIntegrationsService },
        { provide: 'AesCryptoService', useValue: mockCrypto },
        { provide: 'HttpService', useValue: mockHttp },
        { provide: 'ConfigService', useValue: mockConfig },
      ],
    }).compile();
    service = module.get<ConversationRulesService>(ConversationRulesService);
  });

  describe('create', () => {
    it('should throw ConflictException when duplicate rule exists', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create({ clientId: 'c1', type: RuleType.DEFAULT, reply: { text: 'hi' } } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should create rule when no duplicate exists', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      const rule = { id: 'new', clientId: 'c1', type: RuleType.DEFAULT };
      mockRepo.create.mockReturnValue(rule);
      mockRepo.save.mockResolvedValue(rule);
      const result = await service.create({ clientId: 'c1', type: RuleType.DEFAULT, reply: { text: 'hi' } } as any);
      expect(result).toEqual(rule);
    });

    it('should set triggerValue to null for default type', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({});
      await service.create({ clientId: 'c1', type: RuleType.DEFAULT, triggerValue: 'ignored', reply: { text: 'hi' } } as any);
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ triggerValue: null }),
      );
    });
  });

  describe('findKeywordRule', () => {
    it('should return null when no keyword rules exist', async () => {
      mockRepo.find.mockResolvedValue([]);
      const result = await service.findKeywordRule('c1', 'hello world');
      expect(result).toBeNull();
    });

    it('should return rule when keyword is contained in text (case-insensitive)', async () => {
      const rule = { id: 'r1', triggerValue: 'quero', type: RuleType.KEYWORD_DM };
      mockRepo.find.mockResolvedValue([rule]);
      const result = await service.findKeywordRule('c1', 'Eu Quero comprar');
      expect(result).toEqual(rule);
    });

    it('should return the longest matching keyword rule', async () => {
      const short = { id: 'r1', triggerValue: 'quero', type: RuleType.KEYWORD_DM };
      const long = { id: 'r2', triggerValue: 'quero preco', type: RuleType.KEYWORD_DM };
      mockRepo.find.mockResolvedValue([short, long]);
      const result = await service.findKeywordRule('c1', 'quero preco agora');
      expect(result).toEqual(long);
    });

    it('should return null when keyword not contained in text', async () => {
      const rule = { id: 'r1', triggerValue: 'quero', type: RuleType.KEYWORD_DM };
      mockRepo.find.mockResolvedValue([rule]);
      const result = await service.findKeywordRule('c1', 'olá tudo bem');
      expect(result).toBeNull();
    });
  });

  describe('findDefaultRule', () => {
    it('should return null when no default rule exists', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      const result = await service.findDefaultRule('c1');
      expect(result).toBeNull();
    });

    it('should return the default rule', async () => {
      const rule = { id: 'r1', type: RuleType.DEFAULT };
      mockRepo.findOne.mockResolvedValue(rule);
      const result = await service.findDefaultRule('c1');
      expect(result).toEqual(rule);
    });
  });

  describe('findPostRule', () => {
    it('should return null when no rule for post', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      const result = await service.findPostRule('c1', 'post123');
      expect(result).toBeNull();
    });

    it('should return rule matching postId', async () => {
      const rule = { id: 'r1', triggerValue: 'post123', type: RuleType.POST_COMMENT };
      mockRepo.findOne.mockResolvedValue(rule);
      const result = await service.findPostRule('c1', 'post123');
      expect(result).toEqual(rule);
      expect(mockRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ triggerValue: 'post123' }) }),
      );
    });
  });

  describe('getRecentPosts', () => {
    it('should call Graph API and return posts array', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue({ accessToken: 'enc' });
      mockHttp.get.mockReturnValue(
        of({ data: { data: [{ id: '123', caption: 'Test', timestamp: '2026-09-01T00:00:00Z', permalink: 'https://www.instagram.com/p/ABC/' }] } }),
      );
      const result = await service.getRecentPosts('PAGE123');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('123');
      expect(mockHttp.get).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/me/media',
        expect.objectContaining({ params: expect.objectContaining({ access_token: 'plain-token' }) }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=conversation-rules.service.spec --no-coverage
```

Expected: FAIL — `ConversationRulesService` not found.

- [ ] **Step 3: Implement the service**

```typescript
// src/modules/conversation-rules/conversation-rules.service.ts
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ConversationRuleEntity } from './entities/conversation-rule.entity.js';
import { RuleType } from './enums/rule-type.enum.js';
import { CreateConversationRuleDto } from './dto/create-conversation-rule.dto.js';
import { UpdateConversationRuleDto } from './dto/update-conversation-rule.dto.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';

@Injectable()
export class ConversationRulesService {
  constructor(
    @InjectRepository(ConversationRuleEntity)
    private readonly repo: Repository<ConversationRuleEntity>,
    private readonly integrationsService: IntegrationsService,
    private readonly crypto: AesCryptoService,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateConversationRuleDto): Promise<ConversationRuleEntity> {
    const triggerValue = dto.type === RuleType.DEFAULT ? null : (dto.triggerValue ?? null);

    const existing = await this.repo.findOne({
      where: { clientId: dto.clientId, type: dto.type, triggerValue },
    });
    if (existing) {
      throw new ConflictException(
        `A rule with type "${dto.type}" and trigger "${triggerValue ?? 'default'}" already exists for this client`,
      );
    }

    return this.repo.save(
      this.repo.create({ clientId: dto.clientId, type: dto.type, triggerValue, reply: dto.reply }),
    );
  }

  findAll(clientId: string): Promise<ConversationRuleEntity[]> {
    return this.repo.find({
      where: { clientId, isActive: true },
      order: { type: 'ASC', triggerValue: 'ASC' },
    });
  }

  async update(id: string, dto: UpdateConversationRuleDto): Promise<ConversationRuleEntity> {
    const rule = await this.repo.findOneByOrFail({ id });
    return this.repo.save({ ...rule, ...dto });
  }

  async remove(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }

  async findKeywordRule(clientId: string, text: string): Promise<ConversationRuleEntity | null> {
    const rules = await this.repo.find({
      where: { clientId, type: RuleType.KEYWORD_DM, isActive: true },
    });
    const lower = text.toLowerCase();
    const matched = rules.filter(r => r.triggerValue && lower.includes(r.triggerValue.toLowerCase()));
    if (!matched.length) return null;
    return matched.reduce((best, r) => r.triggerValue!.length > best.triggerValue!.length ? r : best);
  }

  findDefaultRule(clientId: string): Promise<ConversationRuleEntity | null> {
    return this.repo.findOne({ where: { clientId, type: RuleType.DEFAULT, isActive: true } });
  }

  findPostRule(clientId: string, postId: string): Promise<ConversationRuleEntity | null> {
    return this.repo.findOne({
      where: { clientId, type: RuleType.POST_COMMENT, triggerValue: postId, isActive: true },
    });
  }

  async getRecentPosts(
    pageId: string,
  ): Promise<Array<{ id: string; caption: string | null; timestamp: string; permalink: string }>> {
    const integration = await this.integrationsService.findByPageId(pageId);
    const token = this.crypto.decrypt(integration.accessToken);
    const base = `${this.config.get<string>('meta.graphApiUrl')}/${this.config.get<string>('meta.graphApiVersion')}`;
    const resp = await firstValueFrom(
      this.httpService.get(`${base}/me/media`, {
        params: { fields: 'id,caption,timestamp,permalink', access_token: token },
      }),
    );
    return (resp.data as { data?: Array<{ id: string; caption: string | null; timestamp: string; permalink: string }> }).data ?? [];
  }
}
```

- [ ] **Step 4: Fix provider tokens in test** (the test uses string tokens — update to use the actual class imports)

Replace the provider tokens in the spec with correct class-based tokens:

```typescript
// In the spec file, replace the string-keyed providers:
import { IntegrationsService } from '../integrations/integrations.service.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

// In providers array:
{ provide: IntegrationsService, useValue: mockIntegrationsService },
{ provide: AesCryptoService, useValue: mockCrypto },
{ provide: HttpService, useValue: mockHttp },
{ provide: ConfigService, useValue: mockConfig },
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=conversation-rules.service.spec --no-coverage
```

Expected: All 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/conversation-rules/conversation-rules.service.ts \
        src/modules/conversation-rules/conversation-rules.service.spec.ts
git commit -m "feat(conversation-rules): add service with CRUD, matching and getRecentPosts"
```

---

### Task 3: DTOs, Controller, Module, app.module registration

**Files:**
- Create: `src/modules/conversation-rules/dto/create-conversation-rule.dto.ts`
- Create: `src/modules/conversation-rules/dto/update-conversation-rule.dto.ts`
- Create: `src/modules/conversation-rules/conversation-rules.controller.ts`
- Create: `src/modules/conversation-rules/conversation-rules.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `ConversationRulesService` (Task 2)
- Produces: REST endpoints at `/api/v1/conversation-rules`

- [ ] **Step 1: Create CreateConversationRuleDto**

```typescript
// src/modules/conversation-rules/dto/create-conversation-rule.dto.ts
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RuleType } from '../enums/rule-type.enum.js';

export class ConversationReplyDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(13)
  @IsString({ each: true })
  @MaxLength(13, { each: true })
  quickReplies?: string[];

  @IsOptional()
  @IsUrl()
  waLink?: string;
}

export class CreateConversationRuleDto {
  @IsUUID()
  clientId: string;

  @IsEnum(RuleType)
  type: RuleType;

  @ValidateIf(o => o.type !== RuleType.DEFAULT)
  @IsString()
  triggerValue?: string;

  @ValidateNested()
  @Type(() => ConversationReplyDto)
  reply: ConversationReplyDto;
}
```

- [ ] **Step 2: Create UpdateConversationRuleDto**

```typescript
// src/modules/conversation-rules/dto/update-conversation-rule.dto.ts
import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ConversationReplyDto } from './create-conversation-rule.dto.js';

export class UpdateConversationRuleDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  triggerValue?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConversationReplyDto)
  reply?: ConversationReplyDto;
}
```

- [ ] **Step 3: Create the controller**

```typescript
// src/modules/conversation-rules/conversation-rules.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { ConversationRulesService } from './conversation-rules.service.js';
import { CreateConversationRuleDto } from './dto/create-conversation-rule.dto.js';
import { UpdateConversationRuleDto } from './dto/update-conversation-rule.dto.js';

@ApiTags('conversation-rules')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(AuthGuard)
@Controller('conversation-rules')
export class ConversationRulesController {
  constructor(private readonly rulesService: ConversationRulesService) {}

  @Get('posts')
  @ApiOperation({ summary: 'Listar posts recentes da página (para usar como triggerValue)' })
  @ApiQuery({ name: 'pageId', required: true, type: String })
  getPosts(@Query('pageId') pageId: string) {
    return this.rulesService.getRecentPosts(pageId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Criar regra de auto-reply' })
  create(@Body() dto: CreateConversationRuleDto) {
    return this.rulesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar regras ativas de um cliente' })
  @ApiQuery({ name: 'clientId', required: true, type: String })
  findAll(@Query('clientId', ParseUUIDPipe) clientId: string) {
    return this.rulesService.findAll(clientId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar regra (reply, isActive, triggerValue)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConversationRuleDto) {
    return this.rulesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover regra (soft delete)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.rulesService.remove(id);
  }
}
```

- [ ] **Step 4: Create the module**

```typescript
// src/modules/conversation-rules/conversation-rules.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConversationRuleEntity } from './entities/conversation-rule.entity.js';
import { ConversationRulesService } from './conversation-rules.service.js';
import { ConversationRulesController } from './conversation-rules.controller.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { CryptoModule } from '../../common/crypto/crypto.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConversationRuleEntity]),
    IntegrationsModule,
    CryptoModule,
    HttpModule,
  ],
  controllers: [ConversationRulesController],
  providers: [ConversationRulesService],
  exports: [ConversationRulesService],
})
export class ConversationRulesModule {}
```

- [ ] **Step 5: Register in app.module.ts**

In `src/app.module.ts`, add to the imports:

```typescript
import { ConversationRulesModule } from './modules/conversation-rules/conversation-rules.module.js';

// In the @Module imports array, add after MediaLibraryModule:
ConversationRulesModule,
```

- [ ] **Step 6: Start the server and verify the endpoints appear in Swagger**

```bash
npm run start:dev
```

Open `http://localhost:3002/docs` and confirm `conversation-rules` tag appears with 5 endpoints: `GET /posts`, `POST /`, `GET /`, `PATCH /:id`, `DELETE /:id`.

- [ ] **Step 7: Commit**

```bash
git add src/modules/conversation-rules/dto/ \
        src/modules/conversation-rules/conversation-rules.controller.ts \
        src/modules/conversation-rules/conversation-rules.module.ts \
        src/app.module.ts
git commit -m "feat(conversation-rules): add DTOs, controller, module and register in app"
```

---

### Task 4: ReplyBuilderService

**Files:**
- Create: `src/modules/webhook/instagram/reply-builder.service.ts`
- Create: `src/modules/webhook/instagram/reply-builder.service.spec.ts`

**Interfaces:**
- Consumes: `InstagramGraphService.sendTextMessage(pageId, recipientId, text)`, `InstagramGraphService.sendQuickReplies(pageId, recipientId, text, options)` (existing)
- Consumes: `ConversationReply` interface (Task 1)
- Produces: `ReplyBuilderService.send(pageId, recipientId, reply): Promise<void>`

- [ ] **Step 1: Write failing tests**

```typescript
// src/modules/webhook/instagram/reply-builder.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ReplyBuilderService } from './reply-builder.service.js';
import { InstagramGraphService } from './instagram-graph.service.js';

const mockGraph = {
  sendTextMessage: jest.fn(),
  sendQuickReplies: jest.fn(),
};

describe('ReplyBuilderService', () => {
  let service: ReplyBuilderService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReplyBuilderService,
        { provide: InstagramGraphService, useValue: mockGraph },
      ],
    }).compile();
    service = module.get<ReplyBuilderService>(ReplyBuilderService);
  });

  it('should call sendTextMessage when reply has only text', async () => {
    await service.send('PAGE1', 'USER1', { text: 'Olá!' });
    expect(mockGraph.sendTextMessage).toHaveBeenCalledWith('PAGE1', 'USER1', 'Olá!');
    expect(mockGraph.sendQuickReplies).not.toHaveBeenCalled();
  });

  it('should call sendQuickReplies when reply has text and quickReplies', async () => {
    await service.send('PAGE1', 'USER1', { text: 'Escolha:', quickReplies: ['Sim', 'Não'] });
    expect(mockGraph.sendQuickReplies).toHaveBeenCalledWith('PAGE1', 'USER1', 'Escolha:', ['Sim', 'Não']);
    expect(mockGraph.sendTextMessage).not.toHaveBeenCalled();
  });

  it('should append waLink to text with newline when reply has text and waLink', async () => {
    await service.send('PAGE1', 'USER1', { text: 'Fale conosco:', waLink: 'https://wa.me/5511999' });
    expect(mockGraph.sendTextMessage).toHaveBeenCalledWith('PAGE1', 'USER1', 'Fale conosco:\nhttps://wa.me/5511999');
  });

  it('should append waLink to text in sendQuickReplies when all three fields present', async () => {
    await service.send('PAGE1', 'USER1', {
      text: 'Opções:',
      quickReplies: ['Ver preços'],
      waLink: 'https://wa.me/5511999',
    });
    expect(mockGraph.sendQuickReplies).toHaveBeenCalledWith(
      'PAGE1', 'USER1', 'Opções:\nhttps://wa.me/5511999', ['Ver preços'],
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=reply-builder.service.spec --no-coverage
```

Expected: FAIL — `ReplyBuilderService` not found.

- [ ] **Step 3: Implement the service**

```typescript
// src/modules/webhook/instagram/reply-builder.service.ts
import { Injectable } from '@nestjs/common';
import { ConversationReply } from '../../conversation-rules/entities/conversation-rule.entity.js';
import { InstagramGraphService } from './instagram-graph.service.js';

@Injectable()
export class ReplyBuilderService {
  constructor(private readonly graph: InstagramGraphService) {}

  async send(pageId: string, recipientId: string, reply: ConversationReply): Promise<void> {
    const text = reply.waLink
      ? `${reply.text ?? ''}\n${reply.waLink}`.trim()
      : (reply.text ?? '');

    if (reply.quickReplies?.length) {
      await this.graph.sendQuickReplies(pageId, recipientId, text, reply.quickReplies);
    } else {
      await this.graph.sendTextMessage(pageId, recipientId, text);
    }
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=reply-builder.service.spec --no-coverage
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/webhook/instagram/reply-builder.service.ts \
        src/modules/webhook/instagram/reply-builder.service.spec.ts
git commit -m "feat(conversation-rules): add ReplyBuilderService"
```

---

### Task 5: ConversationBotService

**Files:**
- Create: `src/modules/webhook/instagram/conversation-bot.service.ts`
- Create: `src/modules/webhook/instagram/conversation-bot.service.spec.ts`

**Interfaces:**
- Consumes: `ConversationRulesService.findKeywordRule`, `.findDefaultRule`, `.findPostRule` (Task 2); `ReplyBuilderService.send` (Task 4); `IntegrationsService.findByPageId` (existing)
- Produces: `ConversationBotService.handleDm(pageId, senderId, text): Promise<void>` and `handleComment(pageId, postId, commenterId): Promise<void>`

- [ ] **Step 1: Write failing tests**

```typescript
// src/modules/webhook/instagram/conversation-bot.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ConversationBotService } from './conversation-bot.service.js';
import { ConversationRulesService } from '../../conversation-rules/conversation-rules.service.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import { ReplyBuilderService } from './reply-builder.service.js';

const mockRulesService = {
  findKeywordRule: jest.fn(),
  findDefaultRule: jest.fn(),
  findPostRule: jest.fn(),
};

const mockIntegrationsService = {
  findByPageId: jest.fn(),
};

const mockReplyBuilder = {
  send: jest.fn(),
};

const activeIntegration = { clientId: 'client-1', isActive: true };

describe('ConversationBotService', () => {
  let service: ConversationBotService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationBotService,
        { provide: ConversationRulesService, useValue: mockRulesService },
        { provide: IntegrationsService, useValue: mockIntegrationsService },
        { provide: ReplyBuilderService, useValue: mockReplyBuilder },
      ],
    }).compile();
    service = module.get<ConversationBotService>(ConversationBotService);
  });

  describe('handleDm', () => {
    it('should do nothing when senderId equals pageId (loop prevention)', async () => {
      await service.handleDm('PAGE1', 'PAGE1', 'quero');
      expect(mockIntegrationsService.findByPageId).not.toHaveBeenCalled();
    });

    it('should do nothing when text is undefined', async () => {
      await service.handleDm('PAGE1', 'USER1', undefined);
      expect(mockIntegrationsService.findByPageId).not.toHaveBeenCalled();
    });

    it('should send keyword rule reply when keyword matches', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      const rule = { reply: { text: 'Oi!' } };
      mockRulesService.findKeywordRule.mockResolvedValue(rule);
      await service.handleDm('PAGE1', 'USER1', 'quero comprar');
      expect(mockReplyBuilder.send).toHaveBeenCalledWith('PAGE1', 'USER1', rule.reply);
      expect(mockRulesService.findDefaultRule).not.toHaveBeenCalled();
    });

    it('should fall back to default rule when no keyword matches', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      mockRulesService.findKeywordRule.mockResolvedValue(null);
      const defaultRule = { reply: { text: 'Olá!' } };
      mockRulesService.findDefaultRule.mockResolvedValue(defaultRule);
      await service.handleDm('PAGE1', 'USER1', 'oi');
      expect(mockReplyBuilder.send).toHaveBeenCalledWith('PAGE1', 'USER1', defaultRule.reply);
    });

    it('should stay silent when no rules match at all', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      mockRulesService.findKeywordRule.mockResolvedValue(null);
      mockRulesService.findDefaultRule.mockResolvedValue(null);
      await service.handleDm('PAGE1', 'USER1', 'oi');
      expect(mockReplyBuilder.send).not.toHaveBeenCalled();
    });

    it('should stay silent when integration is not found', async () => {
      mockIntegrationsService.findByPageId.mockRejectedValue(new Error('Not found'));
      await service.handleDm('PAGE1', 'USER1', 'quero');
      expect(mockReplyBuilder.send).not.toHaveBeenCalled();
    });
  });

  describe('handleComment', () => {
    it('should send reply when post rule exists', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      const rule = { reply: { text: 'DM enviada!' } };
      mockRulesService.findPostRule.mockResolvedValue(rule);
      await service.handleComment('PAGE1', 'POST123', 'COMMENTER1');
      expect(mockReplyBuilder.send).toHaveBeenCalledWith('PAGE1', 'COMMENTER1', rule.reply);
    });

    it('should stay silent when no post rule exists', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      mockRulesService.findPostRule.mockResolvedValue(null);
      await service.handleComment('PAGE1', 'POST123', 'COMMENTER1');
      expect(mockReplyBuilder.send).not.toHaveBeenCalled();
    });

    it('should stay silent when integration not found', async () => {
      mockIntegrationsService.findByPageId.mockRejectedValue(new Error('Not found'));
      await service.handleComment('PAGE1', 'POST123', 'COMMENTER1');
      expect(mockReplyBuilder.send).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=conversation-bot.service.spec --no-coverage
```

Expected: FAIL — `ConversationBotService` not found.

- [ ] **Step 3: Implement the service**

```typescript
// src/modules/webhook/instagram/conversation-bot.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConversationRulesService } from '../../conversation-rules/conversation-rules.service.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import { ReplyBuilderService } from './reply-builder.service.js';

@Injectable()
export class ConversationBotService {
  private readonly logger = new Logger(ConversationBotService.name);

  constructor(
    private readonly rulesService: ConversationRulesService,
    private readonly integrationsService: IntegrationsService,
    private readonly replyBuilder: ReplyBuilderService,
  ) {}

  async handleDm(pageId: string, senderId: string, text: string | undefined): Promise<void> {
    if (senderId === pageId) return;
    if (!text) return;

    let clientId: string;
    try {
      const integration = await this.integrationsService.findByPageId(pageId);
      if (!integration.isActive) return;
      clientId = integration.clientId;
    } catch {
      return;
    }

    const rule =
      (await this.rulesService.findKeywordRule(clientId, text)) ??
      (await this.rulesService.findDefaultRule(clientId));

    if (!rule) return;

    await this.replyBuilder.send(pageId, senderId, rule.reply).catch((err: Error) => {
      this.logger.error(`Failed to send DM reply for pageId ${pageId}: ${err.message}`);
    });
  }

  async handleComment(pageId: string, postId: string, commenterId: string): Promise<void> {
    let clientId: string;
    try {
      const integration = await this.integrationsService.findByPageId(pageId);
      if (!integration.isActive) return;
      clientId = integration.clientId;
    } catch {
      return;
    }

    const rule = await this.rulesService.findPostRule(clientId, postId);
    if (!rule) return;

    await this.replyBuilder.send(pageId, commenterId, rule.reply).catch((err: Error) => {
      this.logger.error(`Failed to send comment reply for pageId ${pageId}: ${err.message}`);
    });
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=conversation-bot.service.spec --no-coverage
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/webhook/instagram/conversation-bot.service.ts \
        src/modules/webhook/instagram/conversation-bot.service.spec.ts
git commit -m "feat(conversation-rules): add ConversationBotService"
```

---

### Task 6: Wire the webhook — interface, service, module

**Files:**
- Modify: `src/modules/webhook/instagram/interfaces/instagram-webhook-event.interface.ts`
- Modify: `src/modules/webhook/instagram/instagram-webhook.service.ts`
- Modify: `src/modules/webhook/instagram/instagram-webhook.service.spec.ts`
- Modify: `src/modules/webhook/webhook.module.ts`

**Interfaces:**
- Consumes: `ConversationBotService.handleDm`, `.handleComment` (Task 5)
- Produces: `handleEvent` returns 200 immediately; DM events → `handleDm`; comment events (verb=add) → `handleComment`

- [ ] **Step 1: Update the webhook event interface**

Replace the contents of `src/modules/webhook/instagram/interfaces/instagram-webhook-event.interface.ts`:

```typescript
export interface InstagramWebhookPayload {
  object: 'instagram';
  entry: InstagramEntry[];
}

export interface InstagramEntry {
  id: string;
  time: number;
  messaging?: InstagramMessagingEvent[];
  changes?: InstagramCommentChangeEvent[];
}

export interface InstagramMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: { mid: string; text?: string; attachments?: InstagramAttachment[] };
  reaction?: { mid: string; action: string; emoji?: string };
  read?: { mid: string };
}

export interface InstagramAttachment {
  type: string;
  payload: { url?: string };
}

export interface InstagramCommentChangeEvent {
  field: 'comments';
  value: {
    from: { id: string; name: string };
    post_id: string;
    comment_id: string;
    message: string;
    item: 'comment';
    verb: 'add' | 'edited' | 'remove';
  };
}
```

- [ ] **Step 2: Update instagram-webhook.service.ts**

Replace the full file contents:

```typescript
// src/modules/webhook/instagram/instagram-webhook.service.ts
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { ConversationBotService } from './conversation-bot.service.js';
import {
  InstagramEntry,
  InstagramWebhookPayload,
} from './interfaces/instagram-webhook-event.interface.js';

@Injectable()
export class InstagramWebhookService {
  private readonly logger = new Logger(InstagramWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly botService: ConversationBotService,
  ) {}

  verifyWebhook(mode: string, token: string, challenge: string): string {
    if (mode !== 'subscribe' || token !== this.config.get<string>('meta.verifyToken')) {
      throw new ForbiddenException('Webhook verification failed');
    }
    return challenge;
  }

  handleEvent(
    payload: InstagramWebhookPayload,
    rawBody: Buffer,
    signature: string,
  ): void {
    this.validateSignature(rawBody, signature);
    setImmediate(() => this.dispatchEvents(payload));
  }

  private dispatchEvents(payload: InstagramWebhookPayload): void {
    for (const entry of payload.entry) {
      this.dispatchEntry(entry);
    }
  }

  private dispatchEntry(entry: InstagramEntry): void {
    for (const event of entry.messaging ?? []) {
      this.botService
        .handleDm(entry.id, event.sender.id, event.message?.text)
        .catch((err: Error) => this.logger.warn(`handleDm error pageId=${entry.id}: ${err.message}`));
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== 'comments' || change.value.verb !== 'add') continue;
      this.botService
        .handleComment(entry.id, change.value.post_id, change.value.from.id)
        .catch((err: Error) => this.logger.warn(`handleComment error pageId=${entry.id}: ${err.message}`));
    }
  }

  private validateSignature(rawBody: Buffer, signature: string): void {
    const appSecret = this.config.get<string>('meta.appSecret') ?? '';
    const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const expectedHeader = `sha256=${expected}`;
    const receivedHeader = signature ?? '';

    if (expectedHeader.length !== receivedHeader.length) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    const safe = timingSafeEqual(
      Buffer.from(expectedHeader),
      Buffer.from(receivedHeader),
    );
    if (!safe) throw new ForbiddenException('Invalid webhook signature');
  }
}
```

- [ ] **Step 3: Add 3 new test cases to instagram-webhook.service.spec.ts**

Open `src/modules/webhook/instagram/instagram-webhook.service.spec.ts` and make the following changes:

**3a.** Add `ConversationBotService` mock at the top alongside existing mocks:

```typescript
const mockBotService = {
  handleDm: jest.fn().mockResolvedValue(undefined),
  handleComment: jest.fn().mockResolvedValue(undefined),
};
```

**3b.** Remove `IntegrationsService` from the provider list (no longer injected here) and add `ConversationBotService`:

```typescript
{ provide: ConversationBotService, useValue: mockBotService },
```

**3c.** Add the import at the top:

```typescript
import { ConversationBotService } from './conversation-bot.service.js';
```

**3d.** Remove the old `processEvent` test cases if they exist (the `IntegrationsService` mock calls). Add these new test cases to the `handleEvent` describe block:

```typescript
it('should dispatch messaging events to handleDm (fire-and-forget)', (done) => {
  const payload = {
    object: 'instagram' as const,
    entry: [{ id: 'PAGE1', time: 1, messaging: [{ sender: { id: 'USER1' }, recipient: { id: 'PAGE1' }, timestamp: 1, message: { mid: 'm1', text: 'quero' } }] }],
  };
  service.handleEvent(payload, validBody, validSig);
  setImmediate(() => {
    expect(mockBotService.handleDm).toHaveBeenCalledWith('PAGE1', 'USER1', 'quero');
    done();
  });
});

it('should dispatch comment changes with verb=add to handleComment', (done) => {
  const payload = {
    object: 'instagram' as const,
    entry: [{
      id: 'PAGE1',
      time: 1,
      changes: [{ field: 'comments' as const, value: { from: { id: 'COMMENTER1', name: 'Ana' }, post_id: 'POST123', comment_id: 'C1', message: 'oi', item: 'comment' as const, verb: 'add' as const } }],
    }],
  };
  service.handleEvent(payload, validBody, validSig);
  setImmediate(() => {
    expect(mockBotService.handleComment).toHaveBeenCalledWith('PAGE1', 'POST123', 'COMMENTER1');
    done();
  });
});

it('should ignore comment changes with verb !== add', (done) => {
  const payload = {
    object: 'instagram' as const,
    entry: [{
      id: 'PAGE1',
      time: 1,
      changes: [{ field: 'comments' as const, value: { from: { id: 'COMMENTER1', name: 'Ana' }, post_id: 'POST123', comment_id: 'C1', message: 'oi', item: 'comment' as const, verb: 'edited' as const } }],
    }],
  };
  service.handleEvent(payload, validBody, validSig);
  setImmediate(() => {
    expect(mockBotService.handleComment).not.toHaveBeenCalled();
    done();
  });
});
```

> **Note:** The `validBody` and `validSig` variables are whatever the existing spec uses for a valid HMAC payload. Reuse those values.

- [ ] **Step 4: Run the updated webhook service spec**

```bash
npx jest --testPathPattern=instagram-webhook.service.spec --no-coverage
```

Expected: All tests PASS (existing + 3 new).

- [ ] **Step 5: Update webhook.module.ts**

Replace the full file:

```typescript
// src/modules/webhook/webhook.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { CryptoModule } from '../../common/crypto/crypto.module.js';
import { ConversationRulesModule } from '../conversation-rules/conversation-rules.module.js';
import { InstagramWebhookController } from './instagram/instagram-webhook.controller.js';
import { InstagramWebhookService } from './instagram/instagram-webhook.service.js';
import { InstagramGraphService } from './instagram/instagram-graph.service.js';
import { ReplyBuilderService } from './instagram/reply-builder.service.js';
import { ConversationBotService } from './instagram/conversation-bot.service.js';

@Module({
  imports: [HttpModule, IntegrationsModule, CryptoModule, ConversationRulesModule],
  controllers: [InstagramWebhookController],
  providers: [
    InstagramWebhookService,
    InstagramGraphService,
    ReplyBuilderService,
    ConversationBotService,
  ],
  exports: [InstagramGraphService],
})
export class WebhookModule {}
```

- [ ] **Step 6: Run the full test suite to confirm no regressions**

```bash
npm test
```

Expected: All tests PASS.

- [ ] **Step 7: Start the server and send a test webhook event**

```bash
npm run start:dev
```

Send a test DM event (replace `<HMAC>` with correct HMAC of the body using `META_APP_SECRET`):

```bash
curl -X POST http://localhost:3002/webhook/instagram \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: sha256=<HMAC>" \
  -d '{"object":"instagram","entry":[{"id":"PAGE_ID","time":1,"messaging":[{"sender":{"id":"USER1"},"recipient":{"id":"PAGE_ID"},"timestamp":1,"message":{"mid":"m1","text":"quero"}}]}]}'
```

Expected: HTTP 200 received immediately. If a keyword rule exists for `"quero"`, the bot sends a reply (check Graph API call in server logs).

- [ ] **Step 8: Commit**

```bash
git add src/modules/webhook/instagram/interfaces/instagram-webhook-event.interface.ts \
        src/modules/webhook/instagram/instagram-webhook.service.ts \
        src/modules/webhook/instagram/instagram-webhook.service.spec.ts \
        src/modules/webhook/webhook.module.ts
git commit -m "feat(conversation-rules): wire ConversationBotService into webhook — fire-and-forget, DMs + comments"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| Tabela `conversation_rules` com JSONB `reply` e índice único parcial | Task 1 |
| `ConversationRulesService`: CRUD, `findKeywordRule` (longest match), `findDefaultRule`, `findPostRule` | Task 2 |
| DTOs com validação (`quickReplies` máx 13, `waLink` url) | Task 3 |
| `GET /conversation-rules/posts?pageId=` | Task 3 (controller) + Task 2 (service `getRecentPosts`) |
| `POST/GET/PATCH/DELETE /conversation-rules` | Task 3 |
| `ReplyBuilderService`: 4 combinações de `reply` | Task 4 |
| `ConversationBotService.handleDm`: loop prevention, keyword, default, silence | Task 5 |
| `ConversationBotService.handleComment`: post rule, silence | Task 5 |
| `InstagramEntry.changes[]` interface + `InstagramCommentChangeEvent` | Task 6 |
| `handleEvent` fire-and-forget | Task 6 |
| Ignorar `verb !== 'add'` | Task 6 |
| `WebhookModule` importa `ConversationRulesModule` | Task 6 |
| `app.module.ts` registra `ConversationRulesModule` | Task 3 |

All spec requirements covered. ✓
