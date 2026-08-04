# AI Integration — Relatórios Inteligentes via WhatsApp

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inserir uma camada de IA plugável no fluxo de dispatch semanal que gera relatórios narrativos personalizados a partir dos insights do Meta Ads, com comparativo à semana anterior, e envia alertas ao grupo de gestores em caso de falha.

**Architecture:** `AiModule.forRootAsync()` (global) expõe `AiService` que delega para `IAiProvider`. O adapter ativo é selecionado via env (`AI_PROVIDER`). `InsightSnapshotsModule` persiste os insights semanais por conta de anúncio para comparativo histórico. `ReportDispatchesService` é atualizado para orquestrar os dois novos serviços e incluir fallback para o template estático e alerta de gestores em caso de erro.

**Tech Stack:** NestJS 11, TypeORM 1, openai SDK, @google/generative-ai SDK, PostgreSQL jsonb, Jest 30, pnpm

## Global Constraints

- Importações relativas usam extensão `.js` (NodeNext module resolution)
- TypeORM `synchronize: false` — toda mudança de schema exige arquivo de migration
- Timestamps de migration: inteiro de 13 dígitos (último existente: `1780800000000`)
- Voz do relatório: primeira pessoa do plural ("nós", "nossa equipe")
- `AI_PROVIDER`: `'openai'` | `'gemini'`, default `'openai'`
- `AI_MODEL`: string do modelo (ex: `'gpt-4o-mini'`, `'gemini-1.5-flash'`)
- Package manager: `pnpm`
- Adapters são instâncias manuais (não `@Injectable()`) criadas dentro do `useFactory`

---

## Mapa de arquivos

| Ação | Arquivo |
|---|---|
| Criar | `src/modules/insight-snapshots/entities/insight-snapshot.entity.ts` |
| Criar | `src/modules/insight-snapshots/insight-snapshots.service.ts` |
| Criar | `src/modules/insight-snapshots/insight-snapshots.service.spec.ts` |
| Criar | `src/modules/insight-snapshots/insight-snapshots.module.ts` |
| Criar | `src/database/migrations/1780900000000-CreateInsightSnapshotsTable.ts` |
| Modificar | `src/modules/clients/entities/client.entity.ts` |
| Criar | `src/database/migrations/1780900000001-AddAiStrategyContextToClients.ts` |
| Criar | `src/modules/ai/ai.tokens.ts` |
| Criar | `src/modules/ai/interfaces/ai-provider.interface.ts` |
| Criar | `src/modules/ai/utils/prompt-builder.ts` |
| Criar | `src/modules/ai/utils/prompt-builder.spec.ts` |
| Criar | `src/modules/ai/ai.service.ts` |
| Criar | `src/modules/ai/ai.service.spec.ts` |
| Criar | `src/modules/ai/ai.module.ts` |
| Criar | `src/modules/ai/adapters/openai.adapter.ts` |
| Criar | `src/modules/ai/adapters/openai.adapter.spec.ts` |
| Criar | `src/modules/ai/adapters/gemini.adapter.ts` |
| Criar | `src/modules/ai/adapters/gemini.adapter.spec.ts` |
| Modificar | `src/modules/report-dispatches/report-dispatches.service.ts` |
| Modificar | `src/modules/report-dispatches/report-dispatches.service.spec.ts` |
| Modificar | `src/modules/report-dispatches/report-dispatches.module.ts` |
| Modificar | `src/app.module.ts` |
| Modificar | `src/config/configuration.ts` |

---

### Task 1: InsightSnapshotEntity + InsightSnapshotsService + migration

**Files:**
- Create: `src/modules/insight-snapshots/entities/insight-snapshot.entity.ts`
- Create: `src/modules/insight-snapshots/insight-snapshots.service.ts`
- Create: `src/modules/insight-snapshots/insight-snapshots.service.spec.ts`
- Create: `src/modules/insight-snapshots/insight-snapshots.module.ts`
- Create: `src/database/migrations/1780900000000-CreateInsightSnapshotsTable.ts`

**Interfaces:**
- Produces:
  - `InsightSnapshotEntity` com campos: `id`, `adAccountId`, `clientId`, `weekStartDate`, `snapshotJson`
  - `InsightSnapshotsService.saveSnapshot(adAccountId, clientId, weekStartDate, snapshotJson): Promise<InsightSnapshotEntity>`
  - `InsightSnapshotsService.findPreviousSnapshot(adAccountId, weekStartDate): Promise<InsightSnapshotEntity | null>`
  - `InsightSnapshotsModule` exporta `InsightSnapshotsService`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/modules/insight-snapshots/insight-snapshots.service.spec.ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InsightSnapshotsService } from './insight-snapshots.service.js';
import { InsightSnapshotEntity } from './entities/insight-snapshot.entity.js';

const makeRepo = () => ({
  save: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((v) => v),
});

describe('InsightSnapshotsService', () => {
  let service: InsightSnapshotsService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(async () => {
    repo = makeRepo();
    const module = await Test.createTestingModule({
      providers: [
        InsightSnapshotsService,
        { provide: getRepositoryToken(InsightSnapshotEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(InsightSnapshotsService);
  });

  describe('saveSnapshot', () => {
    it('calls repo.save with correct fields', async () => {
      const weekStart = new Date('2026-07-27');
      const snapshot = { impressions: '100' } as any;
      repo.save.mockResolvedValue({ id: 'uuid', adAccountId: 'act_1' });

      await service.saveSnapshot('act_1', 'client_1', weekStart, snapshot);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          adAccountId: 'act_1',
          clientId: 'client_1',
          weekStartDate: weekStart,
          snapshotJson: snapshot,
        }),
      );
    });
  });

  describe('findPreviousSnapshot', () => {
    it('queries for weekStartDate 7 days before', async () => {
      const weekStart = new Date('2026-07-27T00:00:00.000Z');
      const prevWeek = new Date('2026-07-20T00:00:00.000Z');
      repo.findOne.mockResolvedValue(null);

      await service.findPreviousSnapshot('act_1', weekStart);

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { adAccountId: 'act_1', weekStartDate: prevWeek },
      });
    });

    it('returns null when no previous snapshot exists', async () => {
      repo.findOne.mockResolvedValue(null);
      const result = await service.findPreviousSnapshot('act_1', new Date('2026-07-27'));
      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=insight-snapshots.service.spec --no-coverage
```
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create the entity**

```typescript
// src/modules/insight-snapshots/entities/insight-snapshot.entity.ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { MetaInsights } from '../../campaign-reports/interfaces/meta-campaign.interface.js';

@Entity('insight_snapshots')
@Index(['adAccountId', 'weekStartDate'], { unique: true })
export class InsightSnapshotEntity extends BaseEntity {
  @Column({ name: 'ad_account_id' })
  adAccountId: string;

  @Column({ name: 'client_id' })
  clientId: string;

  @Column({ name: 'week_start_date', type: 'date' })
  weekStartDate: Date;

  @Column({ name: 'snapshot_json', type: 'jsonb' })
  snapshotJson: MetaInsights;
}
```

- [ ] **Step 4: Create the service**

```typescript
// src/modules/insight-snapshots/insight-snapshots.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InsightSnapshotEntity } from './entities/insight-snapshot.entity.js';
import { MetaInsights } from '../campaign-reports/interfaces/meta-campaign.interface.js';

@Injectable()
export class InsightSnapshotsService {
  constructor(
    @InjectRepository(InsightSnapshotEntity)
    private readonly repo: Repository<InsightSnapshotEntity>,
  ) {}

  async saveSnapshot(
    adAccountId: string,
    clientId: string,
    weekStartDate: Date,
    snapshotJson: MetaInsights,
  ): Promise<InsightSnapshotEntity> {
    return this.repo.save(
      this.repo.create({ adAccountId, clientId, weekStartDate, snapshotJson }),
    );
  }

  async findPreviousSnapshot(
    adAccountId: string,
    weekStartDate: Date,
  ): Promise<InsightSnapshotEntity | null> {
    const prevWeek = new Date(weekStartDate);
    prevWeek.setDate(prevWeek.getDate() - 7);
    return this.repo.findOne({ where: { adAccountId, weekStartDate: prevWeek } });
  }
}
```

- [ ] **Step 5: Create the module**

```typescript
// src/modules/insight-snapshots/insight-snapshots.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InsightSnapshotEntity } from './entities/insight-snapshot.entity.js';
import { InsightSnapshotsService } from './insight-snapshots.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([InsightSnapshotEntity])],
  providers: [InsightSnapshotsService],
  exports: [InsightSnapshotsService],
})
export class InsightSnapshotsModule {}
```

- [ ] **Step 6: Create the migration**

```typescript
// src/database/migrations/1780900000000-CreateInsightSnapshotsTable.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInsightSnapshotsTable1780900000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS "insight_snapshots" (
        "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
        "ad_account_id"    VARCHAR NOT NULL,
        "client_id"        VARCHAR NOT NULL,
        "week_start_date"  DATE NOT NULL,
        "snapshot_json"    JSONB NOT NULL,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"       TIMESTAMPTZ,
        CONSTRAINT "PK_insight_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_insight_snapshots_account_week"
          UNIQUE ("ad_account_id", "week_start_date")
      )
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE IF EXISTS "insight_snapshots"`);
  }
}
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=insight-snapshots.service.spec --no-coverage
```
Expected: PASS (3 tests)

- [ ] **Step 8: Commit**

```bash
git add src/modules/insight-snapshots/ src/database/migrations/1780900000000-CreateInsightSnapshotsTable.ts
git commit -m "feat: add InsightSnapshotsModule for weekly Meta Ads data persistence"
```

---

### Task 2: Adicionar `aiStrategyContext` à `ClientEntity` + migration

**Files:**
- Modify: `src/modules/clients/entities/client.entity.ts`
- Create: `src/database/migrations/1780900000001-AddAiStrategyContextToClients.ts`

**Interfaces:**
- Produces: `ClientEntity.aiStrategyContext: string | null`

- [ ] **Step 1: Adicionar a coluna na entidade**

Em `src/modules/clients/entities/client.entity.ts`, adicionar após `googleDriveFolderUrl`:

```typescript
@Column({ name: 'ai_strategy_context', type: 'text', nullable: true })
aiStrategyContext: string | null;
```

- [ ] **Step 2: Criar a migration**

```typescript
// src/database/migrations/1780900000001-AddAiStrategyContextToClients.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiStrategyContextToClients1780900000001 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "clients"
      ADD COLUMN IF NOT EXISTS "ai_strategy_context" TEXT
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "clients"
      DROP COLUMN IF EXISTS "ai_strategy_context"
    `);
  }
}
```

- [ ] **Step 3: Verificar que o TypeScript compila sem erros**

```bash
npm run build 2>&1 | head -20
```
Expected: nenhum erro em `client.entity.ts`

- [ ] **Step 4: Commit**

```bash
git add src/modules/clients/entities/client.entity.ts \
        src/database/migrations/1780900000001-AddAiStrategyContextToClients.ts
git commit -m "feat: add aiStrategyContext column to ClientEntity"
```

---

### Task 3: IAiProvider + prompt utils + AiService + AiModule + env config

**Files:**
- Create: `src/modules/ai/ai.tokens.ts`
- Create: `src/modules/ai/interfaces/ai-provider.interface.ts`
- Create: `src/modules/ai/utils/prompt-builder.ts`
- Create: `src/modules/ai/utils/prompt-builder.spec.ts`
- Create: `src/modules/ai/ai.service.ts`
- Create: `src/modules/ai/ai.service.spec.ts`
- Create: `src/modules/ai/ai.module.ts`
- Modify: `src/config/configuration.ts`

**Interfaces:**
- Produces:
  - `AI_PROVIDER_TOKEN = 'AI_PROVIDER'` (de `ai.tokens.ts`)
  - `IAiProvider.generateReport(payload: AiReportPayload): Promise<string>`
  - `InsightsSummary` e `AiReportPayload` (de `ai-provider.interface.ts`)
  - `buildSystemPrompt(clientContext: string | null): string`
  - `buildUserMessage(payload: AiReportPayload): string`
  - `AiService.generateReport(payload: AiReportPayload): Promise<string>`
  - `AiModule.forRootAsync(): DynamicModule`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/modules/ai/utils/prompt-builder.spec.ts
import { buildSystemPrompt, buildUserMessage } from './prompt-builder.js';
import { AiReportPayload } from '../interfaces/ai-provider.interface.js';

const mockPayload: AiReportPayload = {
  period: { since: '2026-07-27', until: '2026-08-02', weekNumber: 31 },
  current: { spend: 244.74, reach: 6825, impressions: 10000, clicks: 361, ctr: 3.61, cpm: 24.47, purchases: 0, addToCart: 18, pageViews: 165 },
  previous: null,
  deltas: {},
  clientContext: null,
};

describe('buildSystemPrompt', () => {
  it('includes plural first-person instruction', () => {
    expect(buildSystemPrompt(null)).toContain('primeira pessoa do plural');
  });

  it('appends clientContext when provided', () => {
    expect(buildSystemPrompt('foco em e-commerce')).toContain('foco em e-commerce');
  });

  it('does not mention clientContext when null', () => {
    expect(buildSystemPrompt(null)).not.toContain('Contexto');
  });
});

describe('buildUserMessage', () => {
  it('includes week number', () => {
    expect(buildUserMessage(mockPayload)).toContain('31');
  });

  it('includes serialized spend value', () => {
    expect(buildUserMessage(mockPayload)).toContain('244.74');
  });
});
```

```typescript
// src/modules/ai/ai.service.spec.ts
import { Test } from '@nestjs/testing';
import { AiService } from './ai.service.js';
import { AI_PROVIDER_TOKEN } from './ai.tokens.js';
import { AiReportPayload } from './interfaces/ai-provider.interface.js';

const mockPayload: AiReportPayload = {
  period: { since: '2026-07-27', until: '2026-08-02', weekNumber: 31 },
  current: { spend: 244.74, reach: 6825, impressions: 10000, clicks: 361, ctr: 3.61, cpm: 24.47, purchases: 0, addToCart: 18, pageViews: 165 },
  previous: null,
  deltas: {},
  clientContext: null,
};

describe('AiService', () => {
  let service: AiService;
  const mockProvider = { generateReport: jest.fn() };

  beforeEach(async () => {
    mockProvider.generateReport.mockReset();
    const module = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: AI_PROVIDER_TOKEN, useValue: mockProvider },
      ],
    }).compile();
    service = module.get(AiService);
  });

  it('delegates to the injected provider', async () => {
    mockProvider.generateReport.mockResolvedValue('relatório gerado');
    const result = await service.generateReport(mockPayload);
    expect(mockProvider.generateReport).toHaveBeenCalledWith(mockPayload);
    expect(result).toBe('relatório gerado');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern="ai.service.spec|prompt-builder.spec" --no-coverage
```
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Criar o token**

```typescript
// src/modules/ai/ai.tokens.ts
export const AI_PROVIDER_TOKEN = 'AI_PROVIDER';
```

- [ ] **Step 4: Criar a interface e os tipos**

```typescript
// src/modules/ai/interfaces/ai-provider.interface.ts
export interface InsightsSummary {
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  purchases: number;
  addToCart: number;
  pageViews: number;
}

export interface AiReportPayload {
  period: {
    since: string;       // 'YYYY-MM-DD'
    until: string;       // 'YYYY-MM-DD'
    weekNumber: number;  // ISO 8601
  };
  current: InsightsSummary;
  previous: InsightsSummary | null;
  deltas: Record<string, number | null>;
  clientContext: string | null;
}

export interface IAiProvider {
  generateReport(payload: AiReportPayload): Promise<string>;
}
```

- [ ] **Step 5: Criar o prompt builder**

```typescript
// src/modules/ai/utils/prompt-builder.ts
import { AiReportPayload } from '../interfaces/ai-provider.interface.js';

export function buildSystemPrompt(clientContext: string | null): string {
  const base =
    'Você é um assistente de marketing digital que escreve relatórios semanais para clientes de tráfego pago. ' +
    'Escreva na primeira pessoa do plural (nós, nossa equipe), com tom amigável e profissional. ' +
    'Use emojis moderadamente.';
  if (clientContext) {
    return `${base}\n\nContexto da estratégia do cliente: ${clientContext}`;
  }
  return base;
}

export function buildUserMessage(payload: AiReportPayload): string {
  return (
    `Gere o relatório semanal com base nos dados abaixo.\n` +
    `Inclua: saudação, identificação do período (semana ${payload.period.weekNumber}), avaliação geral, ` +
    `métricas principais, comparativo com semana anterior (se disponível), próximos passos e fechamento.\n\n` +
    `Dados: ${JSON.stringify(payload)}`
  );
}
```

- [ ] **Step 6: Criar o AiService**

```typescript
// src/modules/ai/ai.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { AI_PROVIDER_TOKEN } from './ai.tokens.js';
import { AiReportPayload, IAiProvider } from './interfaces/ai-provider.interface.js';

@Injectable()
export class AiService {
  constructor(@Inject(AI_PROVIDER_TOKEN) private readonly provider: IAiProvider) {}

  generateReport(payload: AiReportPayload): Promise<string> {
    return this.provider.generateReport(payload);
  }
}
```

- [ ] **Step 7: Criar o AiModule**

```typescript
// src/modules/ai/ai.module.ts
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiService } from './ai.service.js';
import { AI_PROVIDER_TOKEN } from './ai.tokens.js';
import { IAiProvider } from './interfaces/ai-provider.interface.js';
import { OpenAiAdapter } from './adapters/openai.adapter.js';
import { GeminiAdapter } from './adapters/gemini.adapter.js';

@Module({})
export class AiModule {
  static forRootAsync(): DynamicModule {
    return {
      module: AiModule,
      global: true,
      imports: [ConfigModule],
      providers: [
        {
          provide: AI_PROVIDER_TOKEN,
          useFactory: (config: ConfigService): IAiProvider => {
            const providerName = config.get<string>('AI_PROVIDER', 'openai');
            if (providerName === 'gemini') return new GeminiAdapter(config);
            return new OpenAiAdapter(config);
          },
          inject: [ConfigService],
        },
        AiService,
      ],
      exports: [AiService],
    };
  }
}
```

- [ ] **Step 8: Adicionar env vars ao schema de validação Joi**

Em `src/config/configuration.ts`, adicionar no objeto `validationSchema`:

```typescript
AI_PROVIDER: Joi.string().valid('openai', 'gemini').default('openai'),
AI_MODEL: Joi.string().default('gpt-4o-mini'),
OPENAI_API_KEY: Joi.string().optional(),
GEMINI_API_KEY: Joi.string().optional(),
MANAGERS_GROUP_JID: Joi.string().optional(),
```

- [ ] **Step 9: Run tests to confirm they pass**

```bash
npx jest --testPathPattern="ai.service.spec|prompt-builder.spec" --no-coverage
```
Expected: PASS (5 tests)

- [ ] **Step 10: Commit**

```bash
git add src/modules/ai/ src/config/configuration.ts
git commit -m "feat: add AiModule with IAiProvider interface, AiService, and prompt builder"
```

---

### Task 4: OpenAiAdapter

**Files:**
- Create: `src/modules/ai/adapters/openai.adapter.ts`
- Create: `src/modules/ai/adapters/openai.adapter.spec.ts`

**Interfaces:**
- Consumes: `IAiProvider`, `AiReportPayload` de Task 3; `buildSystemPrompt`, `buildUserMessage` de Task 3
- Produces: `OpenAiAdapter implements IAiProvider`

- [ ] **Step 1: Instalar o SDK da OpenAI**

```bash
pnpm add openai
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/modules/ai/adapters/openai.adapter.spec.ts
import { ConfigService } from '@nestjs/config';
import { AiReportPayload } from '../interfaces/ai-provider.interface.js';

const mockPayload: AiReportPayload = {
  period: { since: '2026-07-27', until: '2026-08-02', weekNumber: 31 },
  current: { spend: 244.74, reach: 6825, impressions: 10000, clicks: 361, ctr: 3.61, cpm: 24.47, purchases: 0, addToCart: 18, pageViews: 165 },
  previous: null,
  deltas: {},
  clientContext: null,
};

const makeConfig = (overrides: Record<string, string> = {}) =>
  ({ get: jest.fn((key: string, def?: string) => overrides[key] ?? def ?? '') } as unknown as ConfigService);

const mockCreate = jest.fn();

jest.mock('openai', () => ({
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

describe('OpenAiAdapter', () => {
  beforeEach(() => mockCreate.mockReset());

  it('returns content from first chat completion choice', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'relatório gerado pelo GPT' } }],
    });
    const { OpenAiAdapter } = await import('./openai.adapter.js');
    const adapter = new OpenAiAdapter(makeConfig({ OPENAI_API_KEY: 'sk-test', AI_MODEL: 'gpt-4o-mini' }));
    const result = await adapter.generateReport(mockPayload);
    expect(result).toBe('relatório gerado pelo GPT');
  });

  it('returns empty string when choices is empty', async () => {
    mockCreate.mockResolvedValue({ choices: [] });
    const { OpenAiAdapter } = await import('./openai.adapter.js');
    const adapter = new OpenAiAdapter(makeConfig({ OPENAI_API_KEY: 'sk-test' }));
    const result = await adapter.generateReport(mockPayload);
    expect(result).toBe('');
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npx jest --testPathPattern=openai.adapter.spec --no-coverage
```
Expected: FAIL — "Cannot find module './openai.adapter.js'"

- [ ] **Step 4: Implementar o adapter**

```typescript
// src/modules/ai/adapters/openai.adapter.ts
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { IAiProvider, AiReportPayload } from '../interfaces/ai-provider.interface.js';
import { buildSystemPrompt, buildUserMessage } from '../utils/prompt-builder.js';

export class OpenAiAdapter implements IAiProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.client = new OpenAI({ apiKey: config.get<string>('OPENAI_API_KEY') });
    this.model = config.get<string>('AI_MODEL', 'gpt-4o-mini');
  }

  async generateReport(payload: AiReportPayload): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: buildSystemPrompt(payload.clientContext) },
        { role: 'user', content: buildUserMessage(payload) },
      ],
    });
    return response.choices[0]?.message?.content ?? '';
  }
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npx jest --testPathPattern=openai.adapter.spec --no-coverage
```
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/modules/ai/adapters/openai.adapter.ts src/modules/ai/adapters/openai.adapter.spec.ts
git commit -m "feat: add OpenAiAdapter for AI report generation"
```

---

### Task 5: GeminiAdapter

**Files:**
- Create: `src/modules/ai/adapters/gemini.adapter.ts`
- Create: `src/modules/ai/adapters/gemini.adapter.spec.ts`

**Interfaces:**
- Consumes: `IAiProvider`, `AiReportPayload` de Task 3; `buildSystemPrompt`, `buildUserMessage` de Task 3
- Produces: `GeminiAdapter implements IAiProvider`

- [ ] **Step 1: Instalar o SDK do Gemini**

```bash
pnpm add @google/generative-ai
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/modules/ai/adapters/gemini.adapter.spec.ts
import { ConfigService } from '@nestjs/config';
import { AiReportPayload } from '../interfaces/ai-provider.interface.js';

const mockPayload: AiReportPayload = {
  period: { since: '2026-07-27', until: '2026-08-02', weekNumber: 31 },
  current: { spend: 244.74, reach: 6825, impressions: 10000, clicks: 361, ctr: 3.61, cpm: 24.47, purchases: 0, addToCart: 18, pageViews: 165 },
  previous: null,
  deltas: {},
  clientContext: null,
};

const makeConfig = (overrides: Record<string, string> = {}) =>
  ({ get: jest.fn((key: string, def?: string) => overrides[key] ?? def ?? '') } as unknown as ConfigService);

const mockGenerateContent = jest.fn();

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
}));

describe('GeminiAdapter', () => {
  beforeEach(() => mockGenerateContent.mockReset());

  it('returns text from Gemini response', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'relatório gerado pelo Gemini' },
    });
    const { GeminiAdapter } = await import('./gemini.adapter.js');
    const adapter = new GeminiAdapter(makeConfig({ GEMINI_API_KEY: 'AIza-test', AI_MODEL: 'gemini-1.5-flash' }));
    const result = await adapter.generateReport(mockPayload);
    expect(result).toBe('relatório gerado pelo Gemini');
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npx jest --testPathPattern=gemini.adapter.spec --no-coverage
```
Expected: FAIL — "Cannot find module './gemini.adapter.js'"

- [ ] **Step 4: Implementar o adapter**

```typescript
// src/modules/ai/adapters/gemini.adapter.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import { IAiProvider, AiReportPayload } from '../interfaces/ai-provider.interface.js';
import { buildSystemPrompt, buildUserMessage } from '../utils/prompt-builder.js';

export class GeminiAdapter implements IAiProvider {
  private readonly genAI: GoogleGenerativeAI;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.genAI = new GoogleGenerativeAI(config.get<string>('GEMINI_API_KEY') ?? '');
    this.model = config.get<string>('AI_MODEL', 'gemini-1.5-flash');
  }

  async generateReport(payload: AiReportPayload): Promise<string> {
    const model = this.genAI.getGenerativeModel({ model: this.model });
    const result = await model.generateContent([
      buildSystemPrompt(payload.clientContext),
      buildUserMessage(payload),
    ]);
    return result.response.text();
  }
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npx jest --testPathPattern=gemini.adapter.spec --no-coverage
```
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add src/modules/ai/adapters/gemini.adapter.ts src/modules/ai/adapters/gemini.adapter.spec.ts
git commit -m "feat: add GeminiAdapter for AI report generation"
```

---

### Task 6: Atualizar ReportDispatchesService + module wiring

**Files:**
- Modify: `src/modules/report-dispatches/report-dispatches.service.ts`
- Modify: `src/modules/report-dispatches/report-dispatches.service.spec.ts`
- Modify: `src/modules/report-dispatches/report-dispatches.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes:
  - `AiService.generateReport(payload: AiReportPayload): Promise<string>` — Task 3
  - `InsightSnapshotsService.saveSnapshot(...)` e `.findPreviousSnapshot(...)` — Task 1
  - `ClientEntity.aiStrategyContext: string | null` — Task 2
  - `InsightsSummary`, `AiReportPayload` — Task 3
  - `ClientsService.findOne(id: string): Promise<ClientEntity>` — já existe, `ClientsModule` já exporta

- [ ] **Step 1: Write the failing tests**

Substituir o conteúdo completo de `src/modules/report-dispatches/report-dispatches.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ReportDispatchesService } from './report-dispatches.service.js';
import { ReportDispatchLogEntity, DispatchStatus } from './entities/report-dispatch-log.entity.js';
import { CampaignReportsService } from '../campaign-reports/campaign-reports.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { WhatsAppGroupsService } from '../whatsapp-groups/whatsapp-groups.service.js';
import { WhatsAppSessionService } from '../whatsapp-session/whatsapp-session.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { AiService } from '../ai/ai.service.js';
import { InsightSnapshotsService } from '../insight-snapshots/insight-snapshots.service.js';

const makeRepo = () => ({
  save: jest.fn(),
  create: jest.fn((v) => v),
  find: jest.fn(),
  findOne: jest.fn(),
});

async function buildService(overrides: Record<string, unknown> = {}) {
  const repo = makeRepo();
  const module = await Test.createTestingModule({
    providers: [
      ReportDispatchesService,
      { provide: getRepositoryToken(ReportDispatchLogEntity), useValue: repo },
      { provide: AiService, useValue: { generateReport: jest.fn().mockResolvedValue('texto da IA'), ...overrides.aiService } },
      { provide: InsightSnapshotsService, useValue: { saveSnapshot: jest.fn(), findPreviousSnapshot: jest.fn().mockResolvedValue(null), ...overrides.snapshotsService } },
      { provide: ClientsService, useValue: { findOne: jest.fn().mockResolvedValue({ aiStrategyContext: null }), ...overrides.clientsService } },
      { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(null) } },
      { provide: CampaignReportsService, useValue: { getInsights: jest.fn().mockResolvedValue({ data: [] }) } },
      { provide: AdAccountsService, useValue: { findAll: jest.fn().mockResolvedValue([]) } },
      { provide: WhatsAppGroupsService, useValue: { findAllActiveGroupedByClientId: jest.fn().mockResolvedValue(new Map()) } },
      { provide: WhatsAppSessionService, useValue: { sendMessage: jest.fn().mockResolvedValue(undefined) } },
    ],
  }).compile();
  return { service: module.get(ReportDispatchesService), repo };
}

describe('ReportDispatchesService', () => {
  describe('toInsightsSummary', () => {
    it('maps MetaInsights string fields to numeric InsightsSummary', async () => {
      const { service } = await buildService();
      const insights = {
        impressions: '1000', clicks: '50', spend: '100.50',
        reach: '500', cpm: '10.05', cpc: '2.01', ctr: '5.00',
        date_start: '2026-07-27', date_stop: '2026-08-02',
        actions: [
          { action_type: 'purchase', value: '3' },
          { action_type: 'add_to_cart', value: '10' },
          { action_type: 'landing_page_view', value: '80' },
        ],
      } as any;

      const result = (service as any).toInsightsSummary(insights);

      expect(result).toEqual({
        spend: 100.50, reach: 500, impressions: 1000, clicks: 50,
        ctr: 5.00, cpm: 10.05, purchases: 3, addToCart: 10, pageViews: 80,
      });
    });

    it('returns 0 for action types not present', async () => {
      const { service } = await buildService();
      const insights = {
        impressions: '100', clicks: '5', spend: '10', reach: '50',
        cpm: '1', cpc: '2', ctr: '5',
        date_start: '2026-07-27', date_stop: '2026-08-02',
      } as any;
      const result = (service as any).toInsightsSummary(insights);
      expect(result.purchases).toBe(0);
      expect(result.addToCart).toBe(0);
      expect(result.pageViews).toBe(0);
    });
  });

  describe('computeDeltas', () => {
    it('returns empty object when previous is null', async () => {
      const { service } = await buildService();
      const current = { spend: 100, reach: 500, impressions: 1000, clicks: 50, ctr: 5, cpm: 10, purchases: 3, addToCart: 10, pageViews: 80 };
      expect((service as any).computeDeltas(current, null)).toEqual({});
    });

    it('computes relative deltas correctly', async () => {
      const { service } = await buildService();
      const current =  { spend: 110, reach: 565, impressions: 1100, clicks: 55, ctr: 5, cpm: 10, purchases: 3, addToCart: 10, pageViews: 80 };
      const previous = { spend: 100, reach: 500, impressions: 1000, clicks: 50, ctr: 5, cpm: 10, purchases: 3, addToCart: 10, pageViews: 80 };
      const deltas = (service as any).computeDeltas(current, previous);
      expect(deltas.reach).toBeCloseTo(0.13, 2);
      expect(deltas.spend).toBeCloseTo(0.10, 2);
    });

    it('returns null for delta where previous value is 0', async () => {
      const { service } = await buildService();
      const current =  { spend: 100, reach: 500, impressions: 1000, clicks: 50, ctr: 5, cpm: 10, purchases: 3, addToCart: 0, pageViews: 80 };
      const previous = { spend: 100, reach: 500, impressions: 1000, clicks: 50, ctr: 5, cpm: 10, purchases: 0, addToCart: 0, pageViews: 80 };
      const deltas = (service as any).computeDeltas(current, previous);
      expect(deltas.purchases).toBeNull();
      expect(deltas.addToCart).toBeNull();
    });
  });

  describe('getISOWeekNumber', () => {
    it('returns 31 for 2026-07-27', async () => {
      const { service } = await buildService();
      expect((service as any).getISOWeekNumber(new Date('2026-07-27'))).toBe(31);
    });

    it('returns 1 for 2026-01-05', async () => {
      const { service } = await buildService();
      expect((service as any).getISOWeekNumber(new Date('2026-01-05'))).toBe(2);
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=report-dispatches.service.spec --no-coverage
```
Expected: FAIL — injeções faltando ou método não existe

- [ ] **Step 3: Substituir ReportDispatchesService**

Substituir o conteúdo completo de `src/modules/report-dispatches/report-dispatches.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CampaignReportsService } from '../campaign-reports/campaign-reports.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { WhatsAppGroupsService } from '../whatsapp-groups/whatsapp-groups.service.js';
import { WhatsAppSessionService } from '../whatsapp-session/whatsapp-session.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { AiService } from '../ai/ai.service.js';
import { InsightSnapshotsService } from '../insight-snapshots/insight-snapshots.service.js';
import { MetaInsightsLevel } from '../campaign-reports/dto/get-insights-query.dto.js';
import { PaginatedResult, MetaInsights } from '../campaign-reports/interfaces/meta-campaign.interface.js';
import { InsightsSummary, AiReportPayload } from '../ai/interfaces/ai-provider.interface.js';
import { ReportDispatchLogEntity, DispatchStatus } from './entities/report-dispatch-log.entity.js';
import { IReportDispatchesService } from './interfaces/report-dispatches-service.interface.js';
import { TriggerDispatchDto } from './dto/trigger-dispatch.dto.js';

@Injectable()
export class ReportDispatchesService implements IReportDispatchesService {
  private readonly logger = new Logger(ReportDispatchesService.name);

  constructor(
    @InjectRepository(ReportDispatchLogEntity)
    private readonly logRepo: Repository<ReportDispatchLogEntity>,
    private readonly campaignReportsService: CampaignReportsService,
    private readonly adAccountsService: AdAccountsService,
    private readonly whatsAppGroupsService: WhatsAppGroupsService,
    private readonly whatsAppSessionService: WhatsAppSessionService,
    private readonly clientsService: ClientsService,
    private readonly aiService: AiService,
    private readonly insightSnapshotsService: InsightSnapshotsService,
    private readonly configService: ConfigService,
  ) {}

  async triggerForClient(dto: TriggerDispatchDto): Promise<{ dispatched: number; failed: number }> {
    const weekStart = dto.weekStartDate ? new Date(dto.weekStartDate) : this.getLastMonday();
    const groupsByClient = await this.whatsAppGroupsService.findAllActiveGroupedByClientId();

    let dispatched = 0;
    let failed = 0;

    const clientIds = dto.clientId ? [dto.clientId] : Array.from(groupsByClient.keys());

    for (const clientId of clientIds) {
      const groups = groupsByClient.get(clientId);
      if (!groups?.length) continue;

      const adAccounts = await this.adAccountsService.findAll(clientId);
      const activeAccounts = adAccounts.filter(a => a.isActive);

      for (const account of activeAccounts) {
        const result = await this.buildAndSend(clientId, account, groups, weekStart);
        dispatched += result.dispatched;
        failed += result.failed;
      }
    }

    return { dispatched, failed };
  }

  async triggerAll(): Promise<void> {
    this.logger.log('Iniciando envio semanal de relatórios');
    const weekStart = this.getLastMonday();
    const groupsByClient = await this.whatsAppGroupsService.findAllActiveGroupedByClientId();

    for (const [clientId, groups] of groupsByClient.entries()) {
      if (!groups.length) continue;

      const adAccounts = await this.adAccountsService.findAll(clientId);
      const activeAccounts = adAccounts.filter(a => a.isActive);

      for (const account of activeAccounts) {
        await this.buildAndSend(clientId, account, groups, weekStart);
      }
    }

    this.logger.log('Envio semanal de relatórios concluído');
  }

  async findLogs(clientId?: string): Promise<ReportDispatchLogEntity[]> {
    return this.logRepo.find({
      where: clientId ? { clientId } : {},
      order: { createdAt: 'DESC' },
    });
  }

  private async buildAndSend(
    clientId: string,
    account: { adAccountId: string; accountName: string | null },
    groups: Array<{ groupJid: string }>,
    weekStart: Date,
  ): Promise<{ dispatched: number; failed: number }> {
    const since = this.formatDate(weekStart);
    const until = this.formatDate(new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000));

    let rawInsights: MetaInsights | null = null;

    try {
      const result = await this.campaignReportsService.getInsights(account.adAccountId, {
        adAccountId: account.adAccountId,
        level: MetaInsightsLevel.ACCOUNT,
        since,
        until,
      } as any);
      const rows = (result as PaginatedResult<MetaInsights>).data ?? [];
      rawInsights = this.aggregateInsights(rows);
    } catch (err) {
      this.logger.error(`Erro ao buscar insights para conta ${account.adAccountId}`, err);
    }

    let text: string;

    if (rawInsights) {
      await this.insightSnapshotsService.saveSnapshot(
        account.adAccountId,
        clientId,
        weekStart,
        rawInsights,
      );

      const previousSnapshot = await this.insightSnapshotsService.findPreviousSnapshot(
        account.adAccountId,
        weekStart,
      );

      const current = this.toInsightsSummary(rawInsights);
      const previous = previousSnapshot ? this.toInsightsSummary(previousSnapshot.snapshotJson) : null;
      const deltas = this.computeDeltas(current, previous);

      let clientContext: string | null = null;
      try {
        const client = await this.clientsService.findOne(clientId);
        clientContext = client.aiStrategyContext ?? null;
      } catch {
        // cliente não encontrado; continua sem contexto
      }

      const payload: AiReportPayload = {
        period: { since, until, weekNumber: this.getISOWeekNumber(weekStart) },
        current,
        previous,
        deltas,
        clientContext,
      };

      try {
        text = await this.aiService.generateReport(payload);
      } catch (err) {
        this.logger.error(`Falha na geração IA para conta ${account.adAccountId}`, err);
        text = this.formatReportText(account.accountName ?? account.adAccountId, since, until, rawInsights);
      }
    } else {
      text = this.formatErrorText(account.accountName ?? account.adAccountId, since, until);
    }

    let dispatched = 0;
    let failed = 0;

    for (const group of groups) {
      await this.sendToGroup(clientId, account.adAccountId, group.groupJid, weekStart, text, since, until);
      const status = await this.getLastLogStatus(clientId, group.groupJid, weekStart);
      if (status === DispatchStatus.SENT) dispatched++;
      else failed++;
      await this.randomDelay();
    }

    return { dispatched, failed };
  }

  private async sendToGroup(
    clientId: string,
    adAccountId: string,
    groupJid: string,
    weekStart: Date,
    text: string,
    since: string,
    until: string,
  ): Promise<void> {
    try {
      await this.whatsAppSessionService.sendMessage(groupJid, text);
      await this.logRepo.save(
        this.logRepo.create({
          clientId, groupJid, adAccountId,
          weekStartDate: weekStart,
          status: DispatchStatus.SENT,
          errorMessage: null,
          sentAt: new Date(),
        }),
      );
    } catch (err: any) {
      const errorMessage = err?.message ?? String(err);
      this.logger.error(`Falha ao enviar para ${groupJid}: ${errorMessage}`);
      await this.logRepo.save(
        this.logRepo.create({
          clientId, groupJid, adAccountId,
          weekStartDate: weekStart,
          status: DispatchStatus.FAILED,
          errorMessage,
          sentAt: null,
        }),
      );
      await this.sendManagerAlert(clientId, adAccountId, since, until, errorMessage);
    }
  }

  private async sendManagerAlert(
    clientId: string,
    adAccountId: string,
    since: string,
    until: string,
    errorMessage: string,
  ): Promise<void> {
    const managerGroupJid = this.configService.get<string>('MANAGERS_GROUP_JID');
    if (!managerGroupJid) return;
    const text =
      `⚠️ Falha no dispatch — ${clientId} / ${adAccountId}\n` +
      `Semana: ${since} a ${until}\n` +
      `Erro: ${errorMessage}`;
    try {
      await this.whatsAppSessionService.sendMessage(managerGroupJid, text);
    } catch (alertErr) {
      this.logger.error('Falha ao enviar alerta para gestores', alertErr);
    }
  }

  private toInsightsSummary(insights: MetaInsights): InsightsSummary {
    const findAction = (type: string) =>
      parseInt(insights.actions?.find(a => a.action_type === type)?.value ?? '0', 10);

    return {
      spend: parseFloat(insights.spend ?? '0'),
      reach: parseInt(insights.reach ?? '0', 10),
      impressions: parseInt(insights.impressions ?? '0', 10),
      clicks: parseInt(insights.clicks ?? '0', 10),
      ctr: parseFloat(insights.ctr ?? '0'),
      cpm: parseFloat(insights.cpm ?? '0'),
      purchases: findAction('purchase'),
      addToCart: findAction('add_to_cart'),
      pageViews: findAction('landing_page_view'),
    };
  }

  private computeDeltas(
    current: InsightsSummary,
    previous: InsightsSummary | null,
  ): Record<string, number | null> {
    if (!previous) return {};
    const keys: (keyof InsightsSummary)[] = [
      'spend', 'reach', 'impressions', 'clicks', 'ctr', 'cpm',
      'purchases', 'addToCart', 'pageViews',
    ];
    return Object.fromEntries(
      keys.map(key => [
        key,
        previous[key] > 0 ? (current[key] - previous[key]) / previous[key] : null,
      ]),
    );
  }

  private getISOWeekNumber(date: Date): number {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  private async getLastLogStatus(clientId: string, groupJid: string, weekStart: Date): Promise<DispatchStatus> {
    const log = await this.logRepo.findOne({
      where: { clientId, groupJid, weekStartDate: weekStart },
      order: { createdAt: 'DESC' },
    });
    return log?.status ?? DispatchStatus.FAILED;
  }

  private aggregateInsights(rows: MetaInsights[]): MetaInsights {
    const base: MetaInsights = {
      impressions: '0', clicks: '0', spend: '0', reach: '0',
      cpm: '0', cpc: '0', ctr: '0',
      date_start: rows[0]?.date_start ?? '',
      date_stop: rows[rows.length - 1]?.date_stop ?? '',
    };
    if (!rows.length) return base;
    let spend = 0, impressions = 0, clicks = 0, reach = 0;
    for (const row of rows) {
      spend += parseFloat(row.spend ?? '0');
      impressions += parseInt(row.impressions ?? '0', 10);
      clicks += parseInt(row.clicks ?? '0', 10);
      reach += parseInt(row.reach ?? '0', 10);
    }
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    return {
      ...base,
      spend: spend.toFixed(2),
      impressions: String(impressions),
      clicks: String(clicks),
      reach: String(reach),
      ctr: ctr.toFixed(2),
      cpm: cpm.toFixed(2),
    };
  }

  private formatReportText(accountName: string, since: string, until: string, insights: MetaInsights): string {
    const spend = parseFloat(insights.spend).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const impressions = parseInt(insights.impressions).toLocaleString('pt-BR');
    const clicks = parseInt(insights.clicks).toLocaleString('pt-BR');
    const ctr = parseFloat(insights.ctr).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const cpm = parseFloat(insights.cpm).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const [sinceDay, sinceMonth] = since.split('-').slice(1).reverse();
    const [untilDay, untilMonth, untilYear] = until.split('-').reverse();
    return [
      `📊 *Relatório Semanal*`,
      `📅 Semana: ${sinceDay}/${sinceMonth} a ${untilDay}/${untilMonth}/${untilYear}`,
      `💼 Conta: ${accountName}`,
      ``,
      `💰 Investimento: R$ ${spend}`,
      `👁 Impressões: ${impressions}`,
      `🖱 Cliques: ${clicks}`,
      `📈 CTR: ${ctr}%`,
      `💵 CPM: R$ ${cpm}`,
      ``,
      `_Enviado automaticamente por TráfegoFlow_`,
    ].join('\n');
  }

  private formatErrorText(accountName: string, since: string, until: string): string {
    return [
      `📊 *Relatório Semanal*`,
      `💼 Conta: ${accountName}`,
      `📅 Período: ${since} a ${until}`,
      ``,
      `⚠️ Não foi possível carregar os dados desta semana. Por favor, verifique manualmente.`,
      ``,
      `_Enviado automaticamente por TráfegoFlow_`,
    ].join('\n');
  }

  private getLastMonday(): Date {
    const now = new Date();
    const day = now.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - diff - 7);
    monday.setUTCHours(0, 0, 0, 0);
    return monday;
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private randomDelay(): Promise<void> {
    const ms = 5_000 + Math.random() * 10_000;
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

> **Nota:** Os testes acessam métodos privados via `(service as any).método()` — padrão comum no ecossistema NestJS/Jest.

- [ ] **Step 4: Atualizar ReportDispatchesModule**

Substituir o conteúdo de `src/modules/report-dispatches/report-dispatches.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdAccountsModule } from '../ad-accounts/ad-accounts.module.js';
import { CampaignReportsModule } from '../campaign-reports/campaign-reports.module.js';
import { WhatsAppGroupsModule } from '../whatsapp-groups/whatsapp-groups.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { InsightSnapshotsModule } from '../insight-snapshots/insight-snapshots.module.js';
import { ReportDispatchLogEntity } from './entities/report-dispatch-log.entity.js';
import { ReportDispatchesController } from './report-dispatches.controller.js';
import { ReportDispatchesService } from './report-dispatches.service.js';
import { ReportDispatchSchedulerService } from './report-dispatch-scheduler.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReportDispatchLogEntity]),
    WhatsAppGroupsModule,
    AdAccountsModule,
    CampaignReportsModule,
    ClientsModule,
    InsightSnapshotsModule,
  ],
  controllers: [ReportDispatchesController],
  providers: [ReportDispatchesService, ReportDispatchSchedulerService],
})
export class ReportDispatchesModule {}
```

- [ ] **Step 5: Registrar AiModule no AppModule**

Em `src/app.module.ts`, adicionar o import:
```typescript
import { AiModule } from './modules/ai/ai.module.js';
```

E no array `imports` do `@Module`, adicionar:
```typescript
AiModule.forRootAsync(),
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=report-dispatches.service.spec --no-coverage
```
Expected: PASS (7 tests)

- [ ] **Step 7: Run full test suite**

```bash
npm run test -- --no-coverage 2>&1 | tail -20
```
Expected: todos os testes passam, sem regressões

- [ ] **Step 8: Commit**

```bash
git add src/modules/report-dispatches/ src/app.module.ts
git commit -m "feat: wire AI and insight snapshots into weekly report dispatch flow"
```
