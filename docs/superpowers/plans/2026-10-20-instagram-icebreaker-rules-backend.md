# Instagram Icebreaker Rules — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th `conversation_rules` type, `icebreaker`, that registers up to 4 Instagram Icebreaker questions with the Meta API and replies to a tap with a clickable Button Template pointing at a WhatsApp group link. Replace the text-only `reply.waLink` field with a generic `reply.buttonText`/`reply.buttonUrl` pair across every rule type.

**Architecture:** `ConversationRulesService` keeps owning CRUD + matching, now with a 4th rule type whose `triggerValue` (the Icebreaker payload) is backend-generated and immutable. A new `IcebreakerSyncService` pushes the prospective set of active Icebreaker questions to Meta's `messenger_profile` endpoint *before* any icebreaker-affecting mutation is persisted — so a Meta rejection never leaves an orphan DB row. `InstagramGraphService` gains `sendButtonTemplate` and `setIceBreakers`. The webhook gains a `postback` event path (distinct from `message`), routed through a new BullMQ job name to a new `ConversationBotService.handleIcebreaker`.

**Tech Stack:** NestJS 11, TypeORM + PostgreSQL (JSONB), class-validator, Jest 30, `@nestjs/axios` HttpService, BullMQ

**Spec:** `docs/superpowers/specs/2026-10-20-instagram-icebreaker-rules-design.md`

## Global Constraints

- TypeScript + NodeNext resolution — all imports use `.js` extension
- No `synchronize: true` — schema changes only through migrations
- All entities extend `BaseEntity` (`src/common/database/base.entity.js`); soft delete via `@DeleteDateColumn`
- `jest.clearAllMocks()` in `beforeEach`, single top-level `describe` per class, matching the style already in every `*.spec.ts` in this module
- Run a single test file: `npx jest --testPathPattern=<filename> --no-coverage`
- Commit after each task passes its tests
- Max 4 active `icebreaker` rules per client (Meta's hard limit on `ice_breakers` call_to_actions)
- `icebreakerQuestion` max length: 80 chars (conservative default — not Meta-documented, flagged in spec as needing sandbox verification)
- `buttonText` max length: 20 chars (Messenger Platform button title convention — same caveat)
- `locale` sent to Meta is always the literal string `'default'`
- Icebreaker sync happens **before** persisting to the DB, and is **awaited** (not fire-and-forget) — a sync failure must leave the database untouched and propagate to the HTTP caller

## Review Focus

- A client with 4 active `icebreaker` rules deactivates one, creates a new 4th (now active again at 4), then `PATCH`es the deactivated one back to `isActive: true` — the 409 cap must still fire on that reactivation, not just on `create()`.
- A rule has `reply.buttonUrl`/`buttonText` set but no `reply.text` — must be rejected at validation time (400), not pass creation and fail only when the Button Template is actually sent to Meta.
- A client has both an active WhatsApp integration and an active Instagram integration — `IcebreakerSyncService` must resolve the Instagram one specifically, never send a WhatsApp `pageId`/token to the Instagram Graph API.
- A client has zero active Instagram integrations — creating/editing an `icebreaker` rule must fail with 400, not silently save a rule that can never be registered with Meta.
- A `PATCH` tries to change `triggerValue` on an existing `icebreaker` (or `default`) rule — must be rejected, since the uniqueness guarantee depends on the generated payload never changing.

---

## File Map

**New files:**
```
src/modules/conversation-rules/
├─ icebreaker-sync.service.ts
└─ icebreaker-sync.service.spec.ts

src/database/migrations/
└─ 1785000000000-AddIcebreakerSupportToConversationRules.ts
```

**Modified files:**
```
src/modules/conversation-rules/
├─ enums/rule-type.enum.ts
├─ entities/conversation-rule.entity.ts
├─ interfaces/conversation-reply.interface.ts
├─ dto/create-conversation-rule.dto.ts
├─ dto/update-conversation-rule.dto.ts
├─ conversation-rules.service.ts
├─ conversation-rules.service.spec.ts
└─ conversation-rules.module.ts

src/modules/webhook/instagram/
├─ interfaces/instagram-webhook-event.interface.ts
├─ interfaces/instagram-graph.interface.ts
├─ types/instagram-webhook-job.type.ts
├─ instagram-webhook.service.ts
├─ instagram-webhook.service.spec.ts
├─ processors/instagram-webhook.processor.ts
├─ processors/instagram-webhook.processor.spec.ts
├─ conversation-bot.service.ts
├─ conversation-bot.service.spec.ts
├─ reply-builder.service.ts
├─ reply-builder.service.spec.ts
├─ instagram-graph.service.ts
└─ instagram-graph.service.spec.ts
```

---

### Task 1: Enum, entity, reply interface, migration

**Files:**
- Modify: `src/modules/conversation-rules/enums/rule-type.enum.ts`
- Modify: `src/modules/conversation-rules/entities/conversation-rule.entity.ts`
- Modify: `src/modules/conversation-rules/interfaces/conversation-reply.interface.ts`
- Create: `src/database/migrations/1785000000000-AddIcebreakerSupportToConversationRules.ts`

**Interfaces:**
- Produces: `RuleType.ICEBREAKER`, `ConversationRuleEntity.icebreakerQuestion: string | null`, `ConversationReply { text?, quickReplies?, buttonText?, buttonUrl? }` (no `waLink`) — consumed by every later task

- [ ] **Step 1: Add `ICEBREAKER` to the enum**

```typescript
// rule-type.enum.ts
export enum RuleType {
  POST_COMMENT = 'post_comment',
  KEYWORD_DM = 'keyword_dm',
  ICEBREAKER = 'icebreaker',
  DEFAULT = 'default',
}
```

- [ ] **Step 2: Add `icebreakerQuestion` to the entity**

Add below `publicReply`:

```typescript
@Column({ name: 'icebreaker_question', type: 'varchar', nullable: true })
icebreakerQuestion: string | null;
```

- [ ] **Step 3: Replace `waLink` with `buttonText`/`buttonUrl` in the reply interface**

```typescript
// conversation-reply.interface.ts
export interface ConversationReply {
  text?: string;
  quickReplies?: string[];
  buttonText?: string;
  buttonUrl?: string;
}
```

- [ ] **Step 4: Write the migration**

Mirrors `1784000000000-AddCommentKeywordAndPublicReplyToConversationRules.ts`'s structure, but also extends the existing `rule_type_enum`. Postgres requires `ALTER TYPE ... ADD VALUE` to run outside any surrounding transaction in older versions — put it in its own `queryRunner.query()` call as the very first statement, same as every other raw-SQL migration in this project already does one statement per `query()` call.

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIcebreakerSupportToConversationRules1785000000000
  implements MigrationInterface
{
  name = 'AddIcebreakerSupportToConversationRules1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "rule_type_enum" ADD VALUE 'icebreaker'`);
    await queryRunner.query(`
      ALTER TABLE "conversation_rules" ADD COLUMN "icebreaker_question" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres cannot drop a single enum value; down() leaves the enum value in place
    // and only reverts the column, consistent with how an additive enum change is
    // normally handled in this codebase (there's no prior example of reverting one).
    await queryRunner.query(`
      ALTER TABLE "conversation_rules" DROP COLUMN "icebreaker_question"
    `);
  }
}
```

- [ ] **Step 5: Run the migration**

```bash
npm run migration:run
```

Expected: migration marked executed with no errors. **If Postgres rejects `ALTER TYPE ... ADD VALUE` for running inside a transaction block**, split it into its own migration file that runs and commits before the `ADD COLUMN` migration, and note that in the migration's name/comment.

- [ ] **Step 6: Commit**

```bash
git add src/modules/conversation-rules/enums/rule-type.enum.ts \
        src/modules/conversation-rules/entities/conversation-rule.entity.ts \
        src/modules/conversation-rules/interfaces/conversation-reply.interface.ts \
        src/database/migrations/1785000000000-AddIcebreakerSupportToConversationRules.ts
git commit -m "feat(conversation-rules): add icebreaker rule type, entity column and migration"
```

---

### Task 2: DTOs — icebreakerQuestion, buttonText/buttonUrl, text-required-with-button

**Files:**
- Modify: `src/modules/conversation-rules/dto/create-conversation-rule.dto.ts`
- Modify: `src/modules/conversation-rules/dto/update-conversation-rule.dto.ts`

**Interfaces:**
- Consumes: `RuleType` (Task 1)
- Produces: `ConversationReplyDto { text?, quickReplies?, buttonText?, buttonUrl? }`, `CreateConversationRuleDto.icebreakerQuestion?: string`, `UpdateConversationRuleDto.icebreakerQuestion?: string` — consumed by Task 4 (service validation reads these shapes)

No test file for this task — DTO validation is exercised end-to-end through `conversation-rules.service.spec.ts` in Task 4, which is the existing pattern in this module (the DTOs today have no dedicated spec either).

- [ ] **Step 1: Replace `waLink` with `buttonText`/`buttonUrl` in `ConversationReplyDto`, add icebreakerQuestion to `CreateConversationRuleDto`**

```typescript
// create-conversation-rule.dto.ts
export class ConversationReplyDto {
  @ValidateIf(o => !!o.buttonText || !!o.buttonUrl)
  @IsString()
  @IsNotEmpty({ message: 'text is required when buttonText/buttonUrl is set' })
  @MaxLength(2000)
  text?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(13)
  @IsString({ each: true })
  @MaxLength(13, { each: true })
  quickReplies?: string[];

  @ValidateIf(o => !!o.buttonUrl || !!o.buttonText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  buttonText?: string;

  @ValidateIf(o => !!o.buttonText || !!o.buttonUrl)
  @IsUrl({ protocols: ['https'] })
  buttonUrl?: string;
}

export class CreateConversationRuleDto {
  @IsUUID()
  clientId: string;

  @IsEnum(RuleType)
  type: RuleType;

  @ValidateIf(o => o.type !== RuleType.DEFAULT && o.type !== RuleType.ICEBREAKER)
  @IsString()
  triggerValue?: string;

  @ValidateNested()
  @Type(() => ConversationReplyDto)
  reply: ConversationReplyDto;

  @ValidateIf(o => o.type === RuleType.POST_COMMENT)
  @IsString()
  commentKeyword?: string;

  @ValidateIf(o => o.type === RuleType.POST_COMMENT)
  @IsString()
  publicReply?: string;

  @ValidateIf(o => o.type === RuleType.ICEBREAKER)
  @IsString()
  @MaxLength(80)
  icebreakerQuestion?: string;
}
```

Note the DTO's `text` validation moved from a plain `@IsOptional()` to `@ValidateIf` + `@IsNotEmpty` only when a button is set — `text` stays optional for every other combination (just `quickReplies`, or nothing but a button-less default).

Remove the old `@Matches(/^https:\/\/wa\.me\//)` import/decorator entirely — no file should reference `waLink` or `wa.me` after this step.

- [ ] **Step 2: Add `icebreakerQuestion` to `UpdateConversationRuleDto`**

```typescript
// update-conversation-rule.dto.ts
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

  @IsOptional()
  @IsString()
  commentKeyword?: string;

  @IsOptional()
  @IsString()
  publicReply?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  icebreakerQuestion?: string;
}
```

`type` is intentionally never a field on this DTO — that already makes it immutable via `PATCH` with no extra code, since `class-validator`'s `whitelist` strips unknown properties (confirm the global `ValidationPipe` in `main.ts` has `whitelist: true`; if it doesn't, add `forbidNonWhitelisted: true` is out of scope here, just confirm `type` sent in a PATCH body is silently dropped before it reaches the service).

- [ ] **Step 3: Compile check**

```bash
npm run build
```

Expected: no TypeScript errors (confirms no other file still references `ConversationReplyDto.waLink`).

- [ ] **Step 4: Commit**

```bash
git add src/modules/conversation-rules/dto/
git commit -m "feat(conversation-rules): add icebreaker DTO fields, replace waLink with buttonText/buttonUrl"
```

---

### Task 3: `InstagramGraphService` — Button Template and Icebreaker config push

**Files:**
- Modify: `src/modules/webhook/instagram/instagram-graph.service.ts`
- Modify: `src/modules/webhook/instagram/instagram-graph.service.spec.ts`
- Modify: `src/modules/webhook/instagram/interfaces/instagram-graph.interface.ts`

**Interfaces:**
- Produces: `InstagramGraphService.sendButtonTemplate(pageId, recipientIgsid, text, buttonTitle, buttonUrl): Promise<void>`, `InstagramGraphService.setIceBreakers(pageId, questions: Array<{question: string; payload: string}>): Promise<void>` — consumed by Task 4 (`IcebreakerSyncService`) and Task 6 (`ReplyBuilderService`)

- [ ] **Step 1: Write failing tests**

Add to `instagram-graph.service.spec.ts`, following the existing `describe` blocks' style:

```typescript
describe('sendButtonTemplate', () => {
  it('should send a button template with a single web_url button', async () => {
    mockHttpService.post.mockReturnValue(of({ data: { message_id: 'MSG_1' } }));

    await service.sendButtonTemplate(
      'PAGE123', 'IGSID_USER', 'Clique abaixo:', 'Entrar no grupo', 'https://chat.whatsapp.com/XXXX',
    );

    expect(mockHttpService.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/PAGE123/messages',
      {
        recipient: { id: 'IGSID_USER' },
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'button',
              text: 'Clique abaixo:',
              buttons: [{ type: 'web_url', url: 'https://chat.whatsapp.com/XXXX', title: 'Entrar no grupo' }],
            },
          },
        },
      },
      { params: { access_token: 'plaintext-token' } },
    );
  });

  it('should throw OAuthTokenExpiredException when Graph API returns error 190', async () => {
    mockHttpService.post.mockReturnValue(throwError(() => ({ response: { data: { error: { code: 190 } } } })));
    await expect(
      service.sendButtonTemplate('PAGE123', 'IGSID_USER', 'txt', 'btn', 'https://chat.whatsapp.com/X'),
    ).rejects.toThrow(OAuthTokenExpiredException);
  });
});

describe('setIceBreakers', () => {
  it('should POST to messenger_profile with locale "default" and the given questions', async () => {
    mockHttpService.post.mockReturnValue(of({ data: { success: true } }));

    await service.setIceBreakers('PAGE123', [
      { question: 'Quero entrar no grupo VIP 🎉', payload: 'PAYLOAD_1' },
    ]);

    expect(mockHttpService.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/PAGE123/messenger_profile',
      {
        platform: 'instagram',
        ice_breakers: [{
          locale: 'default',
          call_to_actions: [{ question: 'Quero entrar no grupo VIP 🎉', payload: 'PAYLOAD_1' }],
        }],
      },
      { params: { access_token: 'plaintext-token' } },
    );
  });

  it('should throw GraphApiRateLimitException on HTTP 429', async () => {
    mockHttpService.post.mockReturnValue(throwError(() => ({ response: { status: 429, data: { error: { code: 4 } } } })));
    await expect(service.setIceBreakers('PAGE123', [])).rejects.toThrow(GraphApiRateLimitException);
  });

  it('should rethrow the original error on an unrecognized Graph API error', async () => {
    const unknownError = { response: { data: { error: { code: 100 } } } };
    mockHttpService.post.mockReturnValue(throwError(() => unknownError));
    await expect(service.setIceBreakers('PAGE123', [])).rejects.toBe(unknownError);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=instagram-graph.service.spec --no-coverage
```

Expected: FAIL — methods not defined.

- [ ] **Step 3: Implement both methods in `instagram-graph.service.ts`**

Exact bodies are given in the design spec's "`InstagramGraphService.sendButtonTemplate`" and "`InstagramGraphService.setIceBreakers`" sections — copy them as-is. Both reuse the existing private `post()`/`getDecryptedToken()`/`baseUrl` helpers; `setIceBreakers` posts to `${this.baseUrl}/${pageId}/messenger_profile` directly (not through `post()`, since the body shape differs from every other call) but routes caught errors through the existing `handleCommonGraphError`.

- [ ] **Step 4: Add both method signatures to `IInstagramGraphService`**

```typescript
sendButtonTemplate(
  pageId: string,
  recipientIgsid: string,
  text: string,
  buttonTitle: string,
  buttonUrl: string,
): Promise<void>;
setIceBreakers(
  pageId: string,
  questions: Array<{ question: string; payload: string }>,
): Promise<void>;
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=instagram-graph.service.spec --no-coverage
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/webhook/instagram/instagram-graph.service.ts \
        src/modules/webhook/instagram/instagram-graph.service.spec.ts \
        src/modules/webhook/instagram/interfaces/instagram-graph.interface.ts
git commit -m "feat(instagram-graph): add sendButtonTemplate and setIceBreakers"
```

---

### Task 4: `IcebreakerSyncService` (new)

**Files:**
- Create: `src/modules/conversation-rules/icebreaker-sync.service.ts`
- Create: `src/modules/conversation-rules/icebreaker-sync.service.spec.ts`
- Modify: `src/modules/conversation-rules/conversation-rules.module.ts`

**Interfaces:**
- Consumes: `InstagramGraphService.setIceBreakers` (Task 3), `IntegrationsService.findAll(clientId)` (existing), `MetaPlatform` enum (existing, `src/modules/integrations/entities/integration.entity.ts`)
- Produces: `IcebreakerSyncService.sync(clientId: string, activeRules: Array<{icebreakerQuestion: string; triggerValue: string}>): Promise<void>` — consumed by Task 5

- [ ] **Step 1: Write failing tests**

```typescript
// icebreaker-sync.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { IcebreakerSyncService } from './icebreaker-sync.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { InstagramGraphService } from '../webhook/instagram/instagram-graph.service.js';
import { MetaPlatform } from '../integrations/entities/integration.entity.js';

const mockIntegrationsService = { findAll: jest.fn() };
const mockGraph = { setIceBreakers: jest.fn() };

describe('IcebreakerSyncService', () => {
  let service: IcebreakerSyncService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IcebreakerSyncService,
        { provide: IntegrationsService, useValue: mockIntegrationsService },
        { provide: InstagramGraphService, useValue: mockGraph },
      ],
    }).compile();
    service = module.get<IcebreakerSyncService>(IcebreakerSyncService);
  });

  it('should call setIceBreakers with the Instagram pageId and mapped questions', async () => {
    mockIntegrationsService.findAll.mockResolvedValue([
      { platform: MetaPlatform.WHATSAPP, pageId: 'WA1' },
      { platform: MetaPlatform.INSTAGRAM, pageId: 'IG1' },
    ]);
    mockGraph.setIceBreakers.mockResolvedValue(undefined);

    await service.sync('client-1', [{ icebreakerQuestion: 'Quero o grupo', triggerValue: 'PAYLOAD_1' }]);

    expect(mockGraph.setIceBreakers).toHaveBeenCalledWith('IG1', [
      { question: 'Quero o grupo', payload: 'PAYLOAD_1' },
    ]);
  });

  it('should throw BadRequestException when there is no active Instagram integration', async () => {
    mockIntegrationsService.findAll.mockResolvedValue([
      { platform: MetaPlatform.WHATSAPP, pageId: 'WA1' },
    ]);
    await expect(service.sync('client-1', [])).rejects.toThrow(BadRequestException);
    expect(mockGraph.setIceBreakers).not.toHaveBeenCalled();
  });

  it('should throw BadRequestException when the client has no integrations at all', async () => {
    mockIntegrationsService.findAll.mockResolvedValue([]);
    await expect(service.sync('client-1', [])).rejects.toThrow(BadRequestException);
  });

  it('should propagate the error from setIceBreakers without swallowing it', async () => {
    mockIntegrationsService.findAll.mockResolvedValue([{ platform: MetaPlatform.INSTAGRAM, pageId: 'IG1' }]);
    const graphError = new Error('Graph API rejected the payload');
    mockGraph.setIceBreakers.mockRejectedValue(graphError);
    await expect(service.sync('client-1', [])).rejects.toBe(graphError);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=icebreaker-sync.service.spec --no-coverage
```

Expected: FAIL — `IcebreakerSyncService` not found.

- [ ] **Step 3: Implement the service**

Exact body is in the design spec's "`IcebreakerSyncService` (novo)" section — copy as-is (constructor takes `IntegrationsService` and `InstagramGraphService`; filters the `findAll(clientId)` result by `platform === MetaPlatform.INSTAGRAM`; throws `BadRequestException` when none found; otherwise calls `graph.setIceBreakers(integration.pageId, activeRules.map(...))`).

- [ ] **Step 4: Register the provider in the module**

In `conversation-rules.module.ts`, add `IcebreakerSyncService` to `providers` (and `exports` only if a later task needs it from outside the module — it doesn't, `ConversationRulesService` lives in the same module).

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=icebreaker-sync.service.spec --no-coverage
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/conversation-rules/icebreaker-sync.service.ts \
        src/modules/conversation-rules/icebreaker-sync.service.spec.ts \
        src/modules/conversation-rules/conversation-rules.module.ts
git commit -m "feat(conversation-rules): add IcebreakerSyncService"
```

---

### Task 5: `ConversationRulesService` — matching, payload generation, immutability guards

**Files:**
- Modify: `src/modules/conversation-rules/conversation-rules.service.ts`
- Modify: `src/modules/conversation-rules/conversation-rules.service.spec.ts`

**Interfaces:**
- Consumes: `RuleType.ICEBREAKER` (Task 1), DTO shapes (Task 2)
- Produces: `findIcebreakerRule(clientId, payload): Promise<ConversationRuleEntity | null>` (exact match) — consumed by Task 8 (`ConversationBotService.handleIcebreaker`)

This task covers everything in `ConversationRulesService` that does **not** involve calling `IcebreakerSyncService` — that wiring is Task 6, kept separate so each task's tests stay about one thing.

- [ ] **Step 1: Write failing tests**

Add to `conversation-rules.service.spec.ts`:

```typescript
describe('findIcebreakerRule', () => {
  it('should return the rule when payload matches exactly', async () => {
    const rule = { id: 'r1', triggerValue: 'PAYLOAD_1', type: RuleType.ICEBREAKER };
    mockRepo.findOne.mockResolvedValue(rule);
    const result = await service.findIcebreakerRule('c1', 'PAYLOAD_1');
    expect(result).toEqual(rule);
    expect(mockRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: RuleType.ICEBREAKER, triggerValue: 'PAYLOAD_1' }) }),
    );
  });

  it('should return null when no rule has that exact payload', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    const result = await service.findIcebreakerRule('c1', 'UNKNOWN');
    expect(result).toBeNull();
  });
});

describe('create — icebreaker-specific behavior', () => {
  it('should generate the triggerValue and ignore any value sent by the client', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.create.mockReturnValue({});
    mockRepo.save.mockResolvedValue({});
    await service.create({
      clientId: 'c1', type: RuleType.ICEBREAKER, triggerValue: 'client-supplied',
      icebreakerQuestion: 'Quero o grupo', reply: { text: 'Oi!' },
    } as any);
    const created = mockRepo.create.mock.calls[0][0];
    expect(created.triggerValue).not.toBe('client-supplied');
    expect(typeof created.triggerValue).toBe('string');
    expect(created.triggerValue.length).toBeGreaterThan(0);
  });

  it('should persist icebreakerQuestion for icebreaker rules and null it out for other types', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.create.mockReturnValue({});
    mockRepo.save.mockResolvedValue({});
    await service.create({
      clientId: 'c1', type: RuleType.ICEBREAKER, icebreakerQuestion: 'Quero o grupo', reply: { text: 'Oi!' },
    } as any);
    expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ icebreakerQuestion: 'Quero o grupo' }));

    jest.clearAllMocks();
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.create.mockReturnValue({});
    mockRepo.save.mockResolvedValue({});
    await service.create({ clientId: 'c1', type: RuleType.DEFAULT, reply: { text: 'Oi!' } } as any);
    expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ icebreakerQuestion: null }));
  });
});

describe('update — immutability guards', () => {
  it('should reject a triggerValue change on an icebreaker rule', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 'r1', clientId: 'c1', type: RuleType.ICEBREAKER, triggerValue: 'PAYLOAD_1' });
    await expect(
      service.update('r1', 'c1', { triggerValue: 'NEW_PAYLOAD' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject a triggerValue change on a default rule', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 'r1', clientId: 'c1', type: RuleType.DEFAULT, triggerValue: null });
    await expect(
      service.update('r1', 'c1', { triggerValue: 'something' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('should still allow triggerValue changes on keyword_dm rules', async () => {
    const rule = { id: 'r1', clientId: 'c1', type: RuleType.KEYWORD_DM, triggerValue: 'old' };
    mockRepo.findOne.mockResolvedValue(rule);
    mockRepo.save.mockResolvedValue({ ...rule, triggerValue: 'new' });
    const result = await service.update('r1', 'c1', { triggerValue: 'new' } as any);
    expect(result.triggerValue).toBe('new');
  });
});

describe('assertReplyNotEmpty — button requires text', () => {
  it('should throw BadRequestException when buttonUrl is set without text', async () => {
    await expect(
      service.create({ clientId: 'c1', type: RuleType.DEFAULT, reply: { buttonText: 'Entrar', buttonUrl: 'https://chat.whatsapp.com/X' } } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('should accept a reply with text and a button', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.create.mockReturnValue({});
    mockRepo.save.mockResolvedValue({});
    await expect(
      service.create({
        clientId: 'c1', type: RuleType.DEFAULT,
        reply: { text: 'Oi!', buttonText: 'Entrar', buttonUrl: 'https://chat.whatsapp.com/X' },
      } as any),
    ).resolves.toBeDefined();
  });
});
```

Also update the existing `'should throw BadRequestException when reply has no fields'` test's assertion message if it currently references `waLink` in a comment — check and align with the new field names.

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=conversation-rules.service.spec --no-coverage
```

- [ ] **Step 3: Implement in `conversation-rules.service.ts`**

- `findIcebreakerRule(clientId: string, payload: string): Promise<ConversationRuleEntity | null>` — `repo.findOne({ where: { clientId, type: RuleType.ICEBREAKER, triggerValue: payload, isActive: true } })`.
- Add `import { randomUUID } from 'crypto';` to the top of the file.
- In `create()`: when `dto.type === RuleType.ICEBREAKER`, set `triggerValue = randomUUID()` (ignore `dto.triggerValue` entirely — same branch shape as the existing `DEFAULT` → `null` rule, extended to a third case) and `icebreakerQuestion = dto.icebreakerQuestion ?? null` only when `dto.type === RuleType.ICEBREAKER`, else `null` (same pattern as `commentKeyword`/`publicReply` for `POST_COMMENT`).
- In `update()`: after loading `rule`, if `dto.triggerValue !== undefined && (rule.type === RuleType.ICEBREAKER || rule.type === RuleType.DEFAULT)`, throw `new BadRequestException('triggerValue cannot be changed for this rule type')` before the merge/save.
- In `assertReplyNotEmpty()`: add `if ((reply.buttonText || reply.buttonUrl) && !reply.text) throw new BadRequestException('reply.text is required when buttonText/buttonUrl is set')` (this is a second line of defense — the DTO already validates this at the HTTP boundary, but `update()`'s partial `reply` merge means a stored reply could still end up inconsistent if this guard isn't also in the service).
- Update the empty-reply check itself to look at `buttonUrl` instead of `waLink`: `if (!reply.text && !reply.quickReplies?.length && !reply.buttonUrl) throw ...`.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=conversation-rules.service.spec --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/conversation-rules/conversation-rules.service.ts \
        src/modules/conversation-rules/conversation-rules.service.spec.ts
git commit -m "feat(conversation-rules): add icebreaker matching, payload generation and immutability guards"
```

---

### Task 6: Wire `IcebreakerSyncService` into create/update/remove, enforce the 4-active cap

**Files:**
- Modify: `src/modules/conversation-rules/conversation-rules.service.ts`
- Modify: `src/modules/conversation-rules/conversation-rules.service.spec.ts`

**Interfaces:**
- Consumes: `IcebreakerSyncService.sync` (Task 4)
- Produces: `create()`/`update()`/`remove()` now call `IcebreakerSyncService.sync(clientId, prospectiveList)` before persisting whenever the mutation touches an `ICEBREAKER` rule, and enforce the 4-active cap

- [ ] **Step 1: Write failing tests**

```typescript
describe('create — icebreaker sync and cap', () => {
  it('should call IcebreakerSyncService.sync with the prospective list before saving', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.find.mockResolvedValue([
      { icebreakerQuestion: 'Q1', triggerValue: 'P1' },
    ]);
    mockRepo.create.mockReturnValue({});
    mockRepo.save.mockResolvedValue({});
    mockIcebreakerSync.sync.mockResolvedValue(undefined);

    await service.create({
      clientId: 'c1', type: RuleType.ICEBREAKER, icebreakerQuestion: 'Q2', reply: { text: 'Oi' },
    } as any);

    expect(mockIcebreakerSync.sync).toHaveBeenCalledWith('c1', expect.arrayContaining([
      expect.objectContaining({ icebreakerQuestion: 'Q1', triggerValue: 'P1' }),
      expect.objectContaining({ icebreakerQuestion: 'Q2' }),
    ]));
    const syncOrder = mockIcebreakerSync.sync.mock.invocationCallOrder[0];
    const saveOrder = mockRepo.save.mock.invocationCallOrder[0];
    expect(syncOrder).toBeLessThan(saveOrder);
  });

  it('should not call repo.save when sync throws, and should propagate the error', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.find.mockResolvedValue([]);
    const syncError = new Error('Meta rejected the config');
    mockIcebreakerSync.sync.mockRejectedValue(syncError);

    await expect(
      service.create({ clientId: 'c1', type: RuleType.ICEBREAKER, icebreakerQuestion: 'Q1', reply: { text: 'Oi' } } as any),
    ).rejects.toBe(syncError);
    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  it('should throw ConflictException when the client already has 4 active icebreaker rules', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.find.mockResolvedValue([{}, {}, {}, {}]);
    await expect(
      service.create({ clientId: 'c1', type: RuleType.ICEBREAKER, icebreakerQuestion: 'Q5', reply: { text: 'Oi' } } as any),
    ).rejects.toThrow(ConflictException);
    expect(mockIcebreakerSync.sync).not.toHaveBeenCalled();
  });

  it('should not touch IcebreakerSyncService for non-icebreaker rule types', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.create.mockReturnValue({});
    mockRepo.save.mockResolvedValue({});
    await service.create({ clientId: 'c1', type: RuleType.KEYWORD_DM, triggerValue: 'oi', reply: { text: 'Olá' } } as any);
    expect(mockIcebreakerSync.sync).not.toHaveBeenCalled();
  });
});

describe('update — icebreaker sync and cap on reactivation', () => {
  it('should throw ConflictException reactivating a 5th icebreaker rule', async () => {
    const rule = { id: 'r5', clientId: 'c1', type: RuleType.ICEBREAKER, isActive: false, triggerValue: 'P5', icebreakerQuestion: 'Q5' };
    mockRepo.findOne.mockResolvedValue(rule);
    mockRepo.find.mockResolvedValue([{}, {}, {}, {}]); // 4 already active, excluding this one
    await expect(service.update('r5', 'c1', { isActive: true } as any)).rejects.toThrow(ConflictException);
    expect(mockIcebreakerSync.sync).not.toHaveBeenCalled();
  });

  it('should sync before saving when deactivating an icebreaker rule, with it excluded from the prospective list', async () => {
    const rule = { id: 'r1', clientId: 'c1', type: RuleType.ICEBREAKER, isActive: true, triggerValue: 'P1', icebreakerQuestion: 'Q1' };
    mockRepo.findOne.mockResolvedValue(rule);
    mockRepo.find.mockResolvedValue([rule]);
    mockRepo.save.mockResolvedValue({ ...rule, isActive: false });
    mockIcebreakerSync.sync.mockResolvedValue(undefined);

    await service.update('r1', 'c1', { isActive: false } as any);

    expect(mockIcebreakerSync.sync).toHaveBeenCalledWith('c1', []);
  });
});

describe('remove — icebreaker sync', () => {
  it('should sync the remaining active list before soft-deleting an icebreaker rule', async () => {
    const rule = { id: 'r1', clientId: 'c1', type: RuleType.ICEBREAKER, triggerValue: 'P1', icebreakerQuestion: 'Q1' };
    mockRepo.findOne.mockResolvedValue(rule);
    mockRepo.find.mockResolvedValue([rule]);
    mockIcebreakerSync.sync.mockResolvedValue(undefined);
    mockRepo.softDelete.mockResolvedValue(undefined);

    await service.remove('r1', 'c1');

    expect(mockIcebreakerSync.sync).toHaveBeenCalledWith('c1', []);
    const syncOrder = mockIcebreakerSync.sync.mock.invocationCallOrder[0];
    const deleteOrder = mockRepo.softDelete.mock.invocationCallOrder[0];
    expect(syncOrder).toBeLessThan(deleteOrder);
  });

  it('should not touch IcebreakerSyncService when removing a non-icebreaker rule', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 'r1', clientId: 'c1', type: RuleType.KEYWORD_DM });
    mockRepo.softDelete.mockResolvedValue(undefined);
    await service.remove('r1', 'c1');
    expect(mockIcebreakerSync.sync).not.toHaveBeenCalled();
  });
});
```

Add `const mockIcebreakerSync = { sync: jest.fn() }` to the top of the spec file and `{ provide: IcebreakerSyncService, useValue: mockIcebreakerSync }` to the testing module's providers.

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=conversation-rules.service.spec --no-coverage
```

- [ ] **Step 3: Implement**

Inject `IcebreakerSyncService` into `ConversationRulesService`'s constructor. Add a private helper:

```typescript
private async syncIfIcebreaker(
  clientId: string,
  excludeId: string | null,
  prospectiveAddition: { icebreakerQuestion: string; triggerValue: string } | null,
): Promise<void> {
  const active = await this.repo.find({ where: { clientId, type: RuleType.ICEBREAKER, isActive: true } });
  const remaining = excludeId ? active.filter(r => r.id !== excludeId) : active;
  const prospective = prospectiveAddition ? [...remaining, prospectiveAddition] : remaining;

  if (prospective.length > 4) {
    throw new ConflictException(`Client already has ${remaining.length} active icebreaker rules (max 4)`);
  }

  await this.icebreakerSync.sync(
    clientId,
    prospective.map(r => ({ icebreakerQuestion: r.icebreakerQuestion!, triggerValue: r.triggerValue! })),
  );
}
```

Call it:
- In `create()`, when `dto.type === RuleType.ICEBREAKER`: **after** the duplicate check and **before** `repo.save`, call `syncIfIcebreaker(dto.clientId, null, { icebreakerQuestion: dto.icebreakerQuestion!, triggerValue })`, reusing the same local `triggerValue` variable that Task 5 set to `randomUUID()` earlier in this method.
- In `update()`, when the loaded `rule.type === RuleType.ICEBREAKER` **and** the patch would leave it active (`dto.isActive ?? rule.isActive`) is `true`: call `syncIfIcebreaker(rule.clientId, rule.id, { icebreakerQuestion: dto.icebreakerQuestion ?? rule.icebreakerQuestion!, triggerValue: rule.triggerValue! })` before `repo.save`. When the patch leaves it inactive, call `syncIfIcebreaker(rule.clientId, rule.id, null)` instead (removes it from the prospective set, same as a deactivation).
- In `remove()`, when the loaded `rule.type === RuleType.ICEBREAKER`: call `syncIfIcebreaker(rule.clientId, rule.id, null)` before `repo.softDelete`.

Every call site must `await` the sync and let a thrown error propagate — no `.catch()` anywhere in this path.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=conversation-rules.service.spec --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/conversation-rules/conversation-rules.service.ts \
        src/modules/conversation-rules/conversation-rules.service.spec.ts
git commit -m "feat(conversation-rules): sync icebreaker config to Meta before persisting, enforce 4-active cap"
```

---

### Task 7: `ReplyBuilderService` — Button Template branch, drop `waLink` text-append

**Files:**
- Modify: `src/modules/webhook/instagram/reply-builder.service.ts`
- Modify: `src/modules/webhook/instagram/reply-builder.service.spec.ts`

**Interfaces:**
- Consumes: `InstagramGraphService.sendButtonTemplate` (Task 3), `ConversationReply` (Task 1)
- Produces: `ReplyBuilderService.send(pageId, recipientId, reply)` now sends a Button Template when `reply.buttonUrl` is set

- [ ] **Step 1: Replace the `waLink` tests with button tests**

Remove every test that references `waLink` (4 in `send`, 2 in `sendCommentReply`). Add:

```typescript
it('should call sendButtonTemplate when reply has text, buttonText and buttonUrl', async () => {
  await service.send('PAGE1', 'USER1', { text: 'Clique:', buttonText: 'Entrar no grupo', buttonUrl: 'https://chat.whatsapp.com/X' });
  expect(mockGraph.sendButtonTemplate).toHaveBeenCalledWith('PAGE1', 'USER1', 'Clique:', 'Entrar no grupo', 'https://chat.whatsapp.com/X');
  expect(mockGraph.sendTextMessage).not.toHaveBeenCalled();
  expect(mockGraph.sendQuickReplies).not.toHaveBeenCalled();
});

it('should prefer the button over quickReplies when both are present', async () => {
  await service.send('PAGE1', 'USER1', {
    text: 'Opções:', quickReplies: ['Ver preços'], buttonText: 'Entrar', buttonUrl: 'https://chat.whatsapp.com/X',
  });
  expect(mockGraph.sendButtonTemplate).toHaveBeenCalledWith('PAGE1', 'USER1', 'Opções:', 'Entrar', 'https://chat.whatsapp.com/X');
  expect(mockGraph.sendQuickReplies).not.toHaveBeenCalled();
});
```

In `sendCommentReply`'s `describe` block, remove the `waLink`-append test and add one confirming a button in `reply` does **not** get sent as a Button Template there (comment private replies only ever send text — `sendCommentPrivateReply` has no button-template equivalent, out of scope for this feature):

```typescript
it('should ignore buttonText/buttonUrl since comment private replies only support text', async () => {
  await service.sendCommentReply('PAGE1', 'COMMENT1', { text: 'Oi', buttonText: 'Entrar', buttonUrl: 'https://chat.whatsapp.com/X' });
  expect(mockGraph.sendCommentPrivateReply).toHaveBeenCalledWith('PAGE1', 'COMMENT1', 'Oi');
});
```

Add `sendButtonTemplate: jest.fn()` to `mockGraph`.

- [ ] **Step 2: Run tests to confirm the new ones fail**

```bash
npx jest --testPathPattern=reply-builder.service.spec --no-coverage
```

- [ ] **Step 3: Implement**

```typescript
async send(pageId: string, recipientId: string, reply: ConversationReply): Promise<void> {
  if (reply.buttonUrl) {
    await this.graph.sendButtonTemplate(pageId, recipientId, reply.text ?? '', reply.buttonText ?? '', reply.buttonUrl);
    return;
  }
  const text = reply.text ?? '';
  if (reply.quickReplies?.length) {
    await this.graph.sendQuickReplies(pageId, recipientId, text, reply.quickReplies);
  } else {
    await this.graph.sendTextMessage(pageId, recipientId, text);
  }
}
```

Remove `buildText`'s `waLink`-append branch entirely (it becomes `return reply.text ?? ''`, or inline it — `buildText` is still used by `sendCommentReply`, which never sends a button). Update `sendCommentReply` to keep calling `buildText(reply)` unchanged (it still only produces `reply.text`, ignoring any button fields, which the Step 1 test now pins).

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=reply-builder.service.spec --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/webhook/instagram/reply-builder.service.ts \
        src/modules/webhook/instagram/reply-builder.service.spec.ts
git commit -m "feat(reply-builder): send Button Template for buttonUrl replies, drop waLink text-append"
```

---

### Task 8: Webhook postback routing — interface, service, processor, bot handler

**Files:**
- Modify: `src/modules/webhook/instagram/interfaces/instagram-webhook-event.interface.ts`
- Modify: `src/modules/webhook/instagram/types/instagram-webhook-job.type.ts`
- Modify: `src/modules/webhook/instagram/instagram-webhook.service.ts`
- Modify: `src/modules/webhook/instagram/instagram-webhook.service.spec.ts`
- Modify: `src/modules/webhook/instagram/processors/instagram-webhook.processor.ts`
- Modify: `src/modules/webhook/instagram/processors/instagram-webhook.processor.spec.ts`
- Modify: `src/modules/webhook/instagram/conversation-bot.service.ts`
- Modify: `src/modules/webhook/instagram/conversation-bot.service.spec.ts`

**Interfaces:**
- Consumes: `ConversationRulesService.findIcebreakerRule` (Task 5), `ReplyBuilderService.send` (Task 7)
- Produces: `ConversationBotService.handleIcebreaker(pageId, senderId, payload): Promise<void>`

- [ ] **Step 1: Add `postback` to the webhook event interface**

```typescript
// instagram-webhook-event.interface.ts
export interface InstagramMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: { mid: string; text?: string; attachments?: InstagramAttachment[] };
  postback?: { mid?: string; title?: string; payload: string };
  reaction?: { mid: string; action: string; emoji?: string };
  read?: { mid: string };
}
```

- [ ] **Step 2: Add the postback job payload type**

```typescript
// instagram-webhook-job.type.ts
export interface InstagramPostbackJobPayload {
  pageId: string;
  senderId: string;
  payload: string;
}
```

- [ ] **Step 3: Write failing tests for `instagram-webhook.service.spec.ts`**

```typescript
it('should enqueue a postback job (not a dm job) when the messaging event has a postback', async () => {
  const postbackPayload: InstagramWebhookPayload = {
    object: 'instagram',
    entry: [{
      id: 'PAGE1', time: 1,
      messaging: [{ sender: { id: 'USER1' }, recipient: { id: 'PAGE1' }, timestamp: 1, postback: { payload: 'ICEBREAKER_PAYLOAD_1', title: 'Quero o grupo' } }],
    }],
  };
  const rawBody = Buffer.from(JSON.stringify(postbackPayload));
  await service.handleEvent(postbackPayload, rawBody, makeSignature(rawBody));

  expect(mockQueue.add).toHaveBeenCalledWith(
    'postback',
    { pageId: 'PAGE1', senderId: 'USER1', payload: 'ICEBREAKER_PAYLOAD_1' },
    { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
  );
});

it('should not enqueue a dm job for an event that has only a postback', async () => {
  const postbackPayload: InstagramWebhookPayload = {
    object: 'instagram',
    entry: [{ id: 'PAGE1', time: 1, messaging: [{ sender: { id: 'USER1' }, recipient: { id: 'PAGE1' }, timestamp: 1, postback: { payload: 'P1' } }] }],
  };
  const rawBody = Buffer.from(JSON.stringify(postbackPayload));
  await service.handleEvent(postbackPayload, rawBody, makeSignature(rawBody));
  expect(mockQueue.add).not.toHaveBeenCalledWith('dm', expect.anything(), expect.anything());
});

it('should not enqueue anything for a messaging event with neither message nor postback (e.g. a read receipt)', async () => {
  const readReceiptPayload: InstagramWebhookPayload = {
    object: 'instagram',
    entry: [{ id: 'PAGE1', time: 1, messaging: [{ sender: { id: 'USER1' }, recipient: { id: 'PAGE1' }, timestamp: 1, read: { mid: 'MID1' } }] }],
  };
  const rawBody = Buffer.from(JSON.stringify(readReceiptPayload));
  await service.handleEvent(readReceiptPayload, rawBody, makeSignature(rawBody));
  expect(mockQueue.add).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run tests to confirm the new ones fail**

```bash
npx jest --testPathPattern=instagram-webhook.service.spec --no-coverage
```

- [ ] **Step 5: Update `enqueueEntry` in `instagram-webhook.service.ts`**

```typescript
for (const event of entry.messaging ?? []) {
  if (event.postback) {
    await this.queue
      .add('postback', { pageId: entry.id, senderId: event.sender.id, payload: event.postback.payload },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } })
      .catch((err: Error) => this.logger.warn(`enqueue postback failed pageId=${entry.id}: ${err.message}`));
    continue;
  }
  if (!event.message) continue;
  await this.queue
    .add('dm', { pageId: entry.id, senderId: event.sender.id, text: event.message?.text },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } })
    .catch((err: Error) => this.logger.warn(`enqueue dm failed pageId=${entry.id}: ${err.message}`));
}
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=instagram-webhook.service.spec --no-coverage
```

- [ ] **Step 7: Write failing tests for `instagram-webhook.processor.spec.ts`**

```typescript
it('should call botService.handleIcebreaker for a postback job', async () => {
  const job = makeJob<InstagramPostbackJobPayload>('postback', { pageId: 'PAGE1', senderId: 'USER1', payload: 'P1' });
  await processor.process(job);
  expect(mockBotService.handleIcebreaker).toHaveBeenCalledWith('PAGE1', 'USER1', 'P1');
});
```

Add `handleIcebreaker: jest.fn().mockResolvedValue(undefined)` to `mockBotService`.

- [ ] **Step 8: Run, then implement the `case 'postback'` branch in `instagram-webhook.processor.ts`**

```typescript
if (job.name === 'postback') {
  const { pageId, senderId, payload } = job.data as InstagramPostbackJobPayload;
  await this.botService.handleIcebreaker(pageId, senderId, payload);
  return;
}
```

Run `npx jest --testPathPattern=instagram-webhook.processor.spec --no-coverage` to confirm green.

- [ ] **Step 9: Write failing tests for `conversation-bot.service.spec.ts`**

```typescript
describe('handleIcebreaker', () => {
  it('should send the matched rule reply', async () => {
    mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
    const rule = { reply: { text: 'Oi!', buttonText: 'Entrar', buttonUrl: 'https://chat.whatsapp.com/X' } };
    mockRulesService.findIcebreakerRule.mockResolvedValue(rule);
    mockReplyBuilder.send.mockResolvedValue(undefined);
    await service.handleIcebreaker('PAGE1', 'USER1', 'PAYLOAD_1');
    expect(mockRulesService.findIcebreakerRule).toHaveBeenCalledWith('client-1', 'PAYLOAD_1');
    expect(mockReplyBuilder.send).toHaveBeenCalledWith('PAGE1', 'USER1', rule.reply);
  });

  it('should stay silent when no rule matches the payload', async () => {
    mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
    mockRulesService.findIcebreakerRule.mockResolvedValue(null);
    await service.handleIcebreaker('PAGE1', 'USER1', 'UNKNOWN_PAYLOAD');
    expect(mockReplyBuilder.send).not.toHaveBeenCalled();
  });

  it('should stay silent when the integration is not found', async () => {
    mockIntegrationsService.findByPageId.mockRejectedValue(new Error('Not found'));
    await service.handleIcebreaker('PAGE1', 'USER1', 'P1');
    expect(mockReplyBuilder.send).not.toHaveBeenCalled();
  });

  it('should rethrow a rate-limit send failure so the job can be retried', async () => {
    mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
    mockRulesService.findIcebreakerRule.mockResolvedValue({ reply: { text: 'Oi' } });
    mockReplyBuilder.send.mockRejectedValue(new GraphApiRateLimitException('PAGE1'));
    await expect(service.handleIcebreaker('PAGE1', 'USER1', 'P1')).rejects.toThrow(GraphApiRateLimitException);
  });
});
```

Add `findIcebreakerRule: jest.fn()` to `mockRulesService`.

- [ ] **Step 10: Run, then implement `handleIcebreaker` in `conversation-bot.service.ts`**

Mirror `handleDm`'s structure exactly (resolve `clientId` via `integrationsService.findByPageId`, warn-and-return on failure, return silently on no match, swallow non-rate-limit send errors, rethrow `GraphApiRateLimitException`) but call `rulesService.findIcebreakerRule(clientId, payload)` instead of the keyword/default lookup chain. No loop-prevention check is needed (a postback's `sender.id` is never the page itself — Instagram doesn't deliver a page's own postback taps back to itself).

```typescript
async handleIcebreaker(pageId: string, senderId: string, payload: string): Promise<void> {
  let clientId: string;
  try {
    const integration = await this.integrationsService.findByPageId(pageId);
    if (!integration.isActive) return;
    clientId = integration.clientId;
  } catch (err) {
    this.logger.warn(`No integration found for pageId ${pageId} (postback): ${(err as Error).message}`);
    return;
  }

  const rule = await this.rulesService.findIcebreakerRule(clientId, payload);
  if (!rule) return;

  await this.replyBuilder.send(pageId, senderId, rule.reply).catch((err: Error) => {
    if (err instanceof GraphApiRateLimitException) throw err;
    this.logger.error(`Failed to send icebreaker reply for pageId ${pageId}: ${err.message}`);
  });
}
```

- [ ] **Step 11: Run the full suite for this module to confirm no regressions**

```bash
npx jest --testPathPattern="webhook/instagram" --no-coverage
```

- [ ] **Step 12: Commit**

```bash
git add src/modules/webhook/instagram/interfaces/instagram-webhook-event.interface.ts \
        src/modules/webhook/instagram/types/instagram-webhook-job.type.ts \
        src/modules/webhook/instagram/instagram-webhook.service.ts \
        src/modules/webhook/instagram/instagram-webhook.service.spec.ts \
        src/modules/webhook/instagram/processors/instagram-webhook.processor.ts \
        src/modules/webhook/instagram/processors/instagram-webhook.processor.spec.ts \
        src/modules/webhook/instagram/conversation-bot.service.ts \
        src/modules/webhook/instagram/conversation-bot.service.spec.ts
git commit -m "feat(webhook): route Icebreaker postbacks to a new handleIcebreaker handler"
```

---

### Task 9: Full regression pass and manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the entire unit test suite**

```bash
npm test
```

Expected: all tests pass, including every file touched in Tasks 1–8.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Start the server and confirm the Swagger doc still reflects the (unchanged) route shapes**

```bash
npm run start:dev
```

Open `http://localhost:3002/docs`, confirm `conversation-rules` still shows 5 endpoints and that the `CreateConversationRuleDto` schema now lists `icebreakerQuestion` and `buttonText`/`buttonUrl` (not `waLink`).

- [ ] **Step 4: Manual sandbox check against the real Meta API (not automatable here)**

Create one real `icebreaker` rule against a test Instagram Business account connected to this app, and confirm in the Meta developer dashboard (or by re-reading `/me/messenger_profile?fields=ice_breakers`) that the question was actually registered. This is the only way to confirm the two spec-flagged assumptions (80-char question limit, 20-char button title limit, and the exact required shape of `ice_breakers`) before shipping.

- [ ] **Step 5: Commit** (only if Step 4 required a fix)

If the sandbox check in Step 4 reveals the length limits or payload shape are wrong, fix `instagram-graph.service.ts` and/or the DTO `MaxLength` values, re-run the affected test files, and commit:

```bash
git add -A
git commit -m "fix(icebreaker): correct validation limits found in Meta sandbox testing"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| `RuleType.ICEBREAKER`, `icebreaker_question` column, `reply.waLink` → `buttonText`/`buttonUrl` | Task 1 |
| Migration | Task 1 |
| DTO validation (icebreakerQuestion, buttonText/buttonUrl, text-required-with-button) | Task 2 |
| `sendButtonTemplate`, `setIceBreakers` | Task 3 |
| `IcebreakerSyncService` | Task 4 |
| `findIcebreakerRule` (exact match), payload autogeneration, type/triggerValue immutability | Task 5 |
| Sync-before-persist ordering, 4-active cap (create + reactivation) | Task 6 |
| `ReplyBuilderService` Button Template branch | Task 7 |
| Webhook `postback` routing end-to-end | Task 8 |
| Manual Meta sandbox verification of unconfirmed limits | Task 9 |

Frontend (`trafegoflow-dashboard`) is covered by a separate plan in that repository, per the Scope Check in `writing-plans` — this plan produces a fully working, independently testable backend (every new behavior is exercised by `curl`/Jest without any UI).

**Review Focus coverage:** all 5 items each map to a specific test added above (cap-on-reactivation → Task 6; text-required-with-button → Task 5; WhatsApp-vs-Instagram integration filtering → Task 4; no active Instagram integration → Task 4; triggerValue immutability on PATCH → Task 5). The "messaging event with neither message nor postback" case (read receipts/reactions) is additionally covered in Task 8 even though it wasn't one of the five, since it surfaced while writing that task's tests.
