# Adset Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a daily WhatsApp alert that sends adset-level ROAS (since last edit date) and last edit date to the managers group every morning between 07:30 and 08:00 São Paulo time.

**Architecture:** Two new NestJS modules — `alert-jobs` (job configuration CRUD) and `adset-alerts` (scheduling, Meta API fetching, message formatting, WhatsApp dispatch). The existing `CampaignReportsService` gains two new wrapper methods for adset data. A cron fires at 07:30 SP, waits a random 0–30 min delay, then iterates active jobs → clients → ad accounts → adsets, fetches ROAS from Meta since each adset's last edit date, persists snapshots to DB, and sends one consolidated WhatsApp message with an error footer.

**Tech Stack:** NestJS 11, TypeORM + PostgreSQL, `@nestjs/schedule` (already registered in `AppModule`), `@nestjs/axios`, `class-validator`, `class-transformer`

## Global Constraints

- All imports use `.js` extension suffix (NodeNext module resolution — no exceptions)
- Entities extend `src/common/database/base.entity.ts` (`id`, `createdAt`, `updatedAt`, `deletedAt`)
- TypeORM migrations use raw SQL in `up()`/`down()`, never `synchronize: true`
- WhatsApp bold syntax is `*text*` (single asterisk), not `**text**`
- ROAS extracted as `parseFloat(insights.purchase_roas?.[0]?.value ?? '0')` — value of `0` persisted as `null`
- Adsets with `effective_status !== 'ACTIVE'` are silently skipped
- Cron timezone: `America/Sao_Paulo`
- Controller guard pattern: `@UseGuards(AuthGuard)` + `@ApiBearerAuth()` + `@ApiSecurity('x-api-key')` (see existing controllers for import paths)
- Run tests with: `npx jest --testPathPattern=<filename> --no-coverage`

---

## File Map

### New files
| Path | Responsibility |
|---|---|
| `src/modules/alert-jobs/enums/alert-job-type.enum.ts` | `AlertJobType` enum |
| `src/modules/alert-jobs/enums/alert-job-status.enum.ts` | `AlertJobStatus` enum |
| `src/modules/alert-jobs/entities/alert-job.entity.ts` | TypeORM entity for `alert_jobs` |
| `src/modules/alert-jobs/dto/create-alert-job.dto.ts` | DTO for POST /alert-jobs |
| `src/modules/alert-jobs/dto/update-alert-job.dto.ts` | DTO for PATCH /alert-jobs/:id |
| `src/modules/alert-jobs/interfaces/alert-jobs-service.interface.ts` | Service contract |
| `src/modules/alert-jobs/alert-jobs.service.ts` | CRUD + toggle logic |
| `src/modules/alert-jobs/alert-jobs.service.spec.ts` | Unit tests |
| `src/modules/alert-jobs/alert-jobs.controller.ts` | REST controller |
| `src/modules/alert-jobs/alert-jobs.module.ts` | NestJS module |
| `src/modules/adset-alerts/entities/adset-alert-snapshot.entity.ts` | TypeORM entity for `adset_alert_snapshots` |
| `src/modules/adset-alerts/adset-alerts.service.ts` | Core orchestration + message formatting |
| `src/modules/adset-alerts/adset-alerts.service.spec.ts` | Unit tests |
| `src/modules/adset-alerts/adset-alert-scheduler.service.ts` | Cron + random delay |
| `src/modules/adset-alerts/adset-alert-scheduler.service.spec.ts` | Scheduler tests |
| `src/modules/adset-alerts/adset-alerts.controller.ts` | POST /adset-alerts/trigger |
| `src/modules/adset-alerts/adset-alerts.module.ts` | NestJS module |
| `src/database/migrations/1781000000000-CreateAlertJobsTable.ts` | Migration for alert_jobs |
| `src/database/migrations/1781000000001-CreateAdsetAlertSnapshotsTable.ts` | Migration for adset_alert_snapshots |

### Modified files
| Path | What changes |
|---|---|
| `src/modules/campaign-reports/interfaces/meta-campaign.interface.ts` | Add `MetaAdset` interface |
| `src/modules/campaign-reports/interfaces/meta-ads-service.interface.ts` | Add `fetchAdsets` and `fetchAdsetInsights` signatures |
| `src/modules/campaign-reports/meta-ads.service.ts` | Implement `fetchAdsets` and `fetchAdsetInsights` |
| `src/modules/campaign-reports/meta-ads.service.spec.ts` | Tests for new methods |
| `src/modules/campaign-reports/interfaces/campaign-reports-service.interface.ts` | Add `listAdsets` and `getAdsetInsights` signatures |
| `src/modules/campaign-reports/campaign-reports.service.ts` | Implement `listAdsets` and `getAdsetInsights` |
| `src/modules/campaign-reports/campaign-reports.service.spec.ts` | Tests for new methods |
| `src/app.module.ts` | Register `AlertJobsModule` and `AdsetAlertsModule` |

---

### Task 1: Extend MetaAdsService with raw adset HTTP calls

**Files:**
- Modify: `src/modules/campaign-reports/interfaces/meta-campaign.interface.ts`
- Modify: `src/modules/campaign-reports/interfaces/meta-ads-service.interface.ts`
- Modify: `src/modules/campaign-reports/meta-ads.service.ts`
- Modify: `src/modules/campaign-reports/meta-ads.service.spec.ts`

**Interfaces:**
- Produces: `MetaAdset` interface, `MetaAdsService.fetchAdsets(adAccountId, accessToken): Promise<MetaAdset[]>`, `MetaAdsService.fetchAdsetInsights(adsetId, accessToken, since, until): Promise<MetaInsights | null>`

- [ ] **Step 1: Add `MetaAdset` interface to `meta-campaign.interface.ts`**

Append at the end of the file (after the closing brace of `PaginatedResult`):

```typescript
export interface MetaAdset {
  id: string;
  name: string;
  updated_time: string; // ISO 8601, e.g. "2026-08-01T10:00:00+0000"
  effective_status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED' | 'IN_PROCESS' | 'WITH_ISSUES';
}
```

- [ ] **Step 2: Add method signatures to `IMetaAdsService`**

Add to the interface body in `meta-ads-service.interface.ts` (also add `MetaAdset` to the import from `./meta-campaign.interface.js`):

```typescript
fetchAdsets(adAccountId: string, accessToken: string): Promise<MetaAdset[]>;
fetchAdsetInsights(adsetId: string, accessToken: string, since: string, until: string): Promise<MetaInsights | null>;
```

- [ ] **Step 3: Write failing tests in `meta-ads.service.spec.ts`**

Add these two `describe` blocks inside the existing `describe('MetaAdsService', ...)`, after the existing tests. Add `MetaAdset` to the import from `./interfaces/meta-campaign.interface.js`:

```typescript
describe('fetchAdsets', () => {
  it('returns adset list for an ad account', async () => {
    const mockAdsets: MetaAdset[] = [
      {
        id: 'adset_1',
        name: 'CJ - Retargeting',
        updated_time: '2026-08-01T00:00:00+0000',
        effective_status: 'ACTIVE',
      },
    ];
    mockHttpService.get.mockReturnValueOnce(
      of(makeAxiosResponse<MetaApiPaginatedResponse<MetaAdset>>({ data: mockAdsets, paging: {} as any })),
    );

    const result = await service.fetchAdsets('act_123', 'token_abc');

    expect(mockHttpService.get).toHaveBeenCalledWith(
      expect.stringContaining('/act_123/adsets'),
      expect.objectContaining({
        params: expect.objectContaining({
          fields: 'id,name,updated_time,effective_status',
          access_token: 'token_abc',
        }),
      }),
    );
    expect(result).toEqual(mockAdsets);
  });

  it('throws ServiceUnavailableException when API is unreachable', async () => {
    mockHttpService.get.mockReturnValueOnce(throwError(() => ({ message: 'Network error' })));

    await expect(service.fetchAdsets('act_123', 'token_abc')).rejects.toThrow(ServiceUnavailableException);
  });
});

describe('fetchAdsetInsights', () => {
  it('returns insights when data is available for the period', async () => {
    const mockInsight: Partial<MetaInsights> = {
      purchase_roas: [{ action_type: 'omni_purchase', value: '3.42' }],
    };
    mockHttpService.get.mockReturnValueOnce(
      of(makeAxiosResponse<MetaApiPaginatedResponse<MetaInsights>>({ data: [mockInsight as MetaInsights], paging: {} as any })),
    );

    const result = await service.fetchAdsetInsights('adset_1', 'token_abc', '2026-08-01', '2026-08-09');

    expect(mockHttpService.get).toHaveBeenCalledWith(
      expect.stringContaining('/adset_1/insights'),
      expect.objectContaining({
        params: expect.objectContaining({
          fields: 'purchase_roas',
          level: 'adset',
          access_token: 'token_abc',
        }),
      }),
    );
    expect(result).toEqual(mockInsight);
  });

  it('returns null when no data exists for the period', async () => {
    mockHttpService.get.mockReturnValueOnce(
      of(makeAxiosResponse<MetaApiPaginatedResponse<MetaInsights>>({ data: [], paging: {} as any })),
    );

    const result = await service.fetchAdsetInsights('adset_1', 'token_abc', '2026-08-01', '2026-08-09');

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=meta-ads.service --no-coverage
```

Expected: `fetchAdsets` and `fetchAdsetInsights` tests fail with "not a function".

- [ ] **Step 5: Implement `fetchAdsets` in `meta-ads.service.ts`**

Add after the `fetchAdCreatives` method (also add `MetaAdset` to the import from `./interfaces/meta-campaign.interface.js`):

```typescript
async fetchAdsets(
  adAccountId: string,
  accessToken: string,
): Promise<MetaAdset[]> {
  const url = `${this.baseUrl}/${adAccountId}/adsets`;
  const response = await firstValueFrom(
    this.httpService.get<MetaApiPaginatedResponse<MetaAdset>>(url, {
      params: {
        fields: 'id,name,updated_time,effective_status',
        access_token: accessToken,
      },
    }),
  ).catch((err: MetaErrorResponse) => this.handleError(err, adAccountId));
  return response.data.data;
}

async fetchAdsetInsights(
  adsetId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<MetaInsights | null> {
  const url = `${this.baseUrl}/${adsetId}/insights`;
  const response = await firstValueFrom(
    this.httpService.get<MetaApiPaginatedResponse<MetaInsights>>(url, {
      params: {
        fields: 'purchase_roas',
        time_range: JSON.stringify({ since, until }),
        level: 'adset',
        access_token: accessToken,
      },
    }),
  ).catch((err: MetaErrorResponse) => this.handleError(err, adsetId));
  return response.data.data[0] ?? null;
}
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=meta-ads.service --no-coverage
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/modules/campaign-reports/interfaces/meta-campaign.interface.ts \
        src/modules/campaign-reports/interfaces/meta-ads-service.interface.ts \
        src/modules/campaign-reports/meta-ads.service.ts \
        src/modules/campaign-reports/meta-ads.service.spec.ts
git commit -m "feat: add fetchAdsets and fetchAdsetInsights to MetaAdsService"
```

---

### Task 2: Extend CampaignReportsService with adset wrapper methods

**Files:**
- Modify: `src/modules/campaign-reports/interfaces/campaign-reports-service.interface.ts`
- Modify: `src/modules/campaign-reports/campaign-reports.service.ts`
- Modify: `src/modules/campaign-reports/campaign-reports.service.spec.ts`

**Interfaces:**
- Consumes: `MetaAdsService.fetchAdsets()`, `MetaAdsService.fetchAdsetInsights()` from Task 1
- Produces: `CampaignReportsService.listAdsets(adAccountId): Promise<MetaAdset[]>`, `CampaignReportsService.getAdsetInsights(adsetId, adAccountId, since, until): Promise<MetaInsights | null>`

- [ ] **Step 1: Add method signatures to `ICampaignReportsService`**

In `campaign-reports-service.interface.ts`, add `MetaAdset` to the import and append to the interface:

```typescript
listAdsets(adAccountId: string): Promise<MetaAdset[]>;
getAdsetInsights(adsetId: string, adAccountId: string, since: string, until: string): Promise<MetaInsights | null>;
```

- [ ] **Step 2: Write failing tests**

Open `campaign-reports.service.spec.ts`. Read it briefly to understand the existing mock structure, then add a new `describe` block for the new methods. The existing tests mock `AdAccountsService`, `MetaAdsService`, `AesCryptoService`, and `Cache`. Add `MetaAdset` to the import. Then add:

```typescript
describe('listAdsets', () => {
  it('decrypts the token and delegates to MetaAdsService.fetchAdsets', async () => {
    const mockAdsets: MetaAdset[] = [
      { id: 'adset_1', name: 'CJ - Retargeting', updated_time: '2026-08-01T00:00:00+0000', effective_status: 'ACTIVE' },
    ];
    mockAdAccountsService.findByAdAccountId.mockResolvedValueOnce({
      adAccountId: 'act_123',
      accessToken: 'encrypted_token',
      isActive: true,
    });
    mockCryptoService.decrypt.mockReturnValueOnce('plain_token');
    mockMetaAdsService.fetchAdsets.mockResolvedValueOnce(mockAdsets);

    const result = await service.listAdsets('act_123');

    expect(mockCryptoService.decrypt).toHaveBeenCalledWith('encrypted_token');
    expect(mockMetaAdsService.fetchAdsets).toHaveBeenCalledWith('act_123', 'plain_token');
    expect(result).toEqual(mockAdsets);
  });

  it('throws UnprocessableEntityException when ad account is inactive', async () => {
    mockAdAccountsService.findByAdAccountId.mockResolvedValueOnce({
      adAccountId: 'act_123',
      accessToken: 'encrypted_token',
      isActive: false,
    });

    await expect(service.listAdsets('act_123')).rejects.toThrow(UnprocessableEntityException);
  });
});

describe('getAdsetInsights', () => {
  it('decrypts token and delegates to MetaAdsService.fetchAdsetInsights', async () => {
    const mockInsight: Partial<MetaInsights> = {
      purchase_roas: [{ action_type: 'omni_purchase', value: '3.42' }],
    };
    mockAdAccountsService.findByAdAccountId.mockResolvedValueOnce({
      adAccountId: 'act_123',
      accessToken: 'encrypted_token',
      isActive: true,
    });
    mockCryptoService.decrypt.mockReturnValueOnce('plain_token');
    mockMetaAdsService.fetchAdsetInsights.mockResolvedValueOnce(mockInsight as MetaInsights);

    const result = await service.getAdsetInsights('adset_1', 'act_123', '2026-08-01', '2026-08-09');

    expect(mockMetaAdsService.fetchAdsetInsights).toHaveBeenCalledWith(
      'adset_1',
      'plain_token',
      '2026-08-01',
      '2026-08-09',
    );
    expect(result).toEqual(mockInsight);
  });
});
```

> **Note:** Read `campaign-reports.service.spec.ts` before adding tests to understand what mock names (`mockAdAccountsService`, `mockCryptoService`, `mockMetaAdsService`) are used. Match those names exactly.

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=campaign-reports.service --no-coverage
```

Expected: new tests fail with "not a function".

- [ ] **Step 4: Implement `listAdsets` and `getAdsetInsights` in `campaign-reports.service.ts`**

Add `MetaAdset` to the import from `./interfaces/meta-campaign.interface.js`. Add to `ICampaignReportsService` implementations (also add `UnprocessableEntityException` to the imports if not already there):

```typescript
async listAdsets(adAccountId: string): Promise<MetaAdset[]> {
  const account = await this.adAccountsService.findByAdAccountId(adAccountId);
  if (!account.isActive) {
    throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);
  }
  const token = this.crypto.decrypt(account.accessToken);
  return this.metaAdsService.fetchAdsets(adAccountId, token);
}

async getAdsetInsights(
  adsetId: string,
  adAccountId: string,
  since: string,
  until: string,
): Promise<MetaInsights | null> {
  const account = await this.adAccountsService.findByAdAccountId(adAccountId);
  if (!account.isActive) {
    throw new UnprocessableEntityException(`Ad account ${adAccountId} is inactive`);
  }
  const token = this.crypto.decrypt(account.accessToken);
  return this.metaAdsService.fetchAdsetInsights(adsetId, token, since, until);
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=campaign-reports.service --no-coverage
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/campaign-reports/interfaces/campaign-reports-service.interface.ts \
        src/modules/campaign-reports/campaign-reports.service.ts \
        src/modules/campaign-reports/campaign-reports.service.spec.ts
git commit -m "feat: add listAdsets and getAdsetInsights to CampaignReportsService"
```

---

### Task 3: `alert-jobs` module — entity, enums, service, controller, migration

**Files:**
- Create: `src/modules/alert-jobs/enums/alert-job-type.enum.ts`
- Create: `src/modules/alert-jobs/enums/alert-job-status.enum.ts`
- Create: `src/modules/alert-jobs/entities/alert-job.entity.ts`
- Create: `src/modules/alert-jobs/dto/create-alert-job.dto.ts`
- Create: `src/modules/alert-jobs/dto/update-alert-job.dto.ts`
- Create: `src/modules/alert-jobs/interfaces/alert-jobs-service.interface.ts`
- Create: `src/modules/alert-jobs/alert-jobs.service.ts`
- Create: `src/modules/alert-jobs/alert-jobs.service.spec.ts`
- Create: `src/modules/alert-jobs/alert-jobs.controller.ts`
- Create: `src/modules/alert-jobs/alert-jobs.module.ts`
- Create: `src/database/migrations/1781000000000-CreateAlertJobsTable.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Produces: `AlertJobsService.findAll()`, `AlertJobsService.findActive()`, `AlertJobsService.create()`, `AlertJobsService.update()` — consumed by Task 5

- [ ] **Step 1: Create enums**

`src/modules/alert-jobs/enums/alert-job-type.enum.ts`:
```typescript
export enum AlertJobType {
  ADSET_INSIGHTS = 'ADSET_INSIGHTS',
}
```

`src/modules/alert-jobs/enums/alert-job-status.enum.ts`:
```typescript
export enum AlertJobStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}
```

- [ ] **Step 2: Create entity**

`src/modules/alert-jobs/entities/alert-job.entity.ts`:
```typescript
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { AlertJobType } from '../enums/alert-job-type.enum.js';
import { AlertJobStatus } from '../enums/alert-job-status.enum.js';

@Entity('alert_jobs')
export class AlertJobEntity extends BaseEntity {
  @Column({ type: 'enum', enum: AlertJobType })
  type: AlertJobType;

  @Column({ type: 'enum', enum: AlertJobStatus, default: AlertJobStatus.ACTIVE })
  status: AlertJobStatus;

  @Column({ name: 'client_id', type: 'varchar', nullable: true })
  clientId: string | null;

  @Column({ type: 'text', array: true, default: '{}' })
  fields: string[];
}
```

- [ ] **Step 3: Create DTOs**

`src/modules/alert-jobs/dto/create-alert-job.dto.ts`:
```typescript
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { AlertJobType } from '../enums/alert-job-type.enum.js';
import { AlertJobStatus } from '../enums/alert-job-status.enum.js';

export class CreateAlertJobDto {
  @IsEnum(AlertJobType)
  type: AlertJobType;

  @IsEnum(AlertJobStatus)
  @IsOptional()
  status?: AlertJobStatus;

  @IsString()
  @IsOptional()
  clientId?: string | null;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  fields?: string[];
}
```

`src/modules/alert-jobs/dto/update-alert-job.dto.ts`:
```typescript
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { AlertJobStatus } from '../enums/alert-job-status.enum.js';

export class UpdateAlertJobDto {
  @IsEnum(AlertJobStatus)
  @IsOptional()
  status?: AlertJobStatus;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  fields?: string[];
}
```

- [ ] **Step 4: Create service interface**

`src/modules/alert-jobs/interfaces/alert-jobs-service.interface.ts`:
```typescript
import { AlertJobEntity } from '../entities/alert-job.entity.js';
import { AlertJobStatus } from '../enums/alert-job-status.enum.js';
import { AlertJobType } from '../enums/alert-job-type.enum.js';
import { CreateAlertJobDto } from '../dto/create-alert-job.dto.js';
import { UpdateAlertJobDto } from '../dto/update-alert-job.dto.js';

export interface IAlertJobsService {
  findAll(filters?: { status?: AlertJobStatus; type?: AlertJobType }): Promise<AlertJobEntity[]>;
  findActive(): Promise<AlertJobEntity[]>;
  create(dto: CreateAlertJobDto): Promise<AlertJobEntity>;
  update(id: string, dto: UpdateAlertJobDto): Promise<AlertJobEntity>;
}
```

- [ ] **Step 5: Write failing tests**

`src/modules/alert-jobs/alert-jobs.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AlertJobsService } from './alert-jobs.service.js';
import { AlertJobEntity } from './entities/alert-job.entity.js';
import { AlertJobStatus } from './enums/alert-job-status.enum.js';
import { AlertJobType } from './enums/alert-job-type.enum.js';

const mockRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

describe('AlertJobsService', () => {
  let service: AlertJobsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertJobsService,
        { provide: getRepositoryToken(AlertJobEntity), useValue: mockRepo },
      ],
    }).compile();
    service = module.get<AlertJobsService>(AlertJobsService);
  });

  describe('findActive', () => {
    it('queries only ACTIVE jobs', async () => {
      mockRepo.find.mockResolvedValueOnce([]);
      await service.findActive();
      expect(mockRepo.find).toHaveBeenCalledWith({ where: { status: AlertJobStatus.ACTIVE } });
    });
  });

  describe('findAll', () => {
    it('applies status filter when provided', async () => {
      mockRepo.find.mockResolvedValueOnce([]);
      await service.findAll({ status: AlertJobStatus.INACTIVE });
      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: AlertJobStatus.INACTIVE }) }),
      );
    });

    it('applies type filter when provided', async () => {
      mockRepo.find.mockResolvedValueOnce([]);
      await service.findAll({ type: AlertJobType.ADSET_INSIGHTS });
      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ type: AlertJobType.ADSET_INSIGHTS }) }),
      );
    });
  });

  describe('create', () => {
    it('defaults status to ACTIVE and fields to roas+last_updated when not provided', async () => {
      const created = { id: 'uuid-1', type: AlertJobType.ADSET_INSIGHTS, status: AlertJobStatus.ACTIVE, clientId: null, fields: ['roas', 'last_updated'] };
      mockRepo.create.mockReturnValueOnce(created);
      mockRepo.save.mockResolvedValueOnce(created);

      const result = await service.create({ type: AlertJobType.ADSET_INSIGHTS });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: AlertJobStatus.ACTIVE, fields: ['roas', 'last_updated'], clientId: null }),
      );
      expect(result).toEqual(created);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when job does not exist', async () => {
      mockRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.update('nonexistent', { status: AlertJobStatus.INACTIVE })).rejects.toThrow(NotFoundException);
    });

    it('updates status without touching fields', async () => {
      const job = { id: 'uuid-1', status: AlertJobStatus.ACTIVE, fields: ['roas'] };
      mockRepo.findOne.mockResolvedValueOnce(job);
      mockRepo.save.mockResolvedValueOnce({ ...job, status: AlertJobStatus.INACTIVE });

      const result = await service.update('uuid-1', { status: AlertJobStatus.INACTIVE });

      expect(result.status).toBe(AlertJobStatus.INACTIVE);
      expect(result.fields).toEqual(['roas']);
    });

    it('replaces fields array entirely when provided', async () => {
      const job = { id: 'uuid-1', status: AlertJobStatus.ACTIVE, fields: ['roas'] };
      mockRepo.findOne.mockResolvedValueOnce(job);
      mockRepo.save.mockResolvedValueOnce({ ...job, fields: ['roas', 'ctr'] });

      const result = await service.update('uuid-1', { fields: ['roas', 'ctr'] });

      expect(result.fields).toEqual(['roas', 'ctr']);
    });
  });
});
```

- [ ] **Step 6: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=alert-jobs.service --no-coverage
```

Expected: fail — module not found.

- [ ] **Step 7: Implement `AlertJobsService`**

`src/modules/alert-jobs/alert-jobs.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AlertJobEntity } from './entities/alert-job.entity.js';
import { AlertJobStatus } from './enums/alert-job-status.enum.js';
import { AlertJobType } from './enums/alert-job-type.enum.js';
import { CreateAlertJobDto } from './dto/create-alert-job.dto.js';
import { UpdateAlertJobDto } from './dto/update-alert-job.dto.js';
import { IAlertJobsService } from './interfaces/alert-jobs-service.interface.js';

@Injectable()
export class AlertJobsService implements IAlertJobsService {
  constructor(
    @InjectRepository(AlertJobEntity)
    private readonly repo: Repository<AlertJobEntity>,
  ) {}

  findAll(filters?: { status?: AlertJobStatus; type?: AlertJobType }): Promise<AlertJobEntity[]> {
    return this.repo.find({
      where: {
        ...(filters?.status !== undefined && { status: filters.status }),
        ...(filters?.type !== undefined && { type: filters.type }),
      },
      order: { createdAt: 'DESC' },
    });
  }

  findActive(): Promise<AlertJobEntity[]> {
    return this.repo.find({ where: { status: AlertJobStatus.ACTIVE } });
  }

  create(dto: CreateAlertJobDto): Promise<AlertJobEntity> {
    return this.repo.save(
      this.repo.create({
        type: dto.type,
        status: dto.status ?? AlertJobStatus.ACTIVE,
        clientId: dto.clientId ?? null,
        fields: dto.fields ?? ['roas', 'last_updated'],
      }),
    );
  }

  async update(id: string, dto: UpdateAlertJobDto): Promise<AlertJobEntity> {
    const job = await this.repo.findOne({ where: { id } });
    if (!job) throw new NotFoundException(`AlertJob ${id} not found`);
    if (dto.status !== undefined) job.status = dto.status;
    if (dto.fields !== undefined) job.fields = dto.fields;
    return this.repo.save(job);
  }
}
```

- [ ] **Step 8: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=alert-jobs.service --no-coverage
```

Expected: all 7 tests pass.

- [ ] **Step 9: Create controller**

`src/modules/alert-jobs/alert-jobs.controller.ts`:
```typescript
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { AlertJobsService } from './alert-jobs.service.js';
import { CreateAlertJobDto } from './dto/create-alert-job.dto.js';
import { UpdateAlertJobDto } from './dto/update-alert-job.dto.js';
import { AlertJobStatus } from './enums/alert-job-status.enum.js';
import { AlertJobType } from './enums/alert-job-type.enum.js';

@ApiTags('alert-jobs')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(AuthGuard)
@Controller('alert-jobs')
export class AlertJobsController {
  constructor(private readonly alertJobsService: AlertJobsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar jobs de alerta' })
  @ApiQuery({ name: 'status', required: false, enum: AlertJobStatus })
  @ApiQuery({ name: 'type', required: false, enum: AlertJobType })
  findAll(@Query('status') status?: AlertJobStatus, @Query('type') type?: AlertJobType) {
    return this.alertJobsService.findAll({ status, type });
  }

  @Post()
  @ApiOperation({ summary: 'Criar job de alerta' })
  create(@Body() dto: CreateAlertJobDto) {
    return this.alertJobsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar status e/ou fields de um job' })
  update(@Param('id') id: string, @Body() dto: UpdateAlertJobDto) {
    return this.alertJobsService.update(id, dto);
  }
}
```

- [ ] **Step 10: Create module**

`src/modules/alert-jobs/alert-jobs.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertJobEntity } from './entities/alert-job.entity.js';
import { AlertJobsService } from './alert-jobs.service.js';
import { AlertJobsController } from './alert-jobs.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([AlertJobEntity])],
  controllers: [AlertJobsController],
  providers: [AlertJobsService],
  exports: [AlertJobsService],
})
export class AlertJobsModule {}
```

- [ ] **Step 11: Create migration**

`src/database/migrations/1781000000000-CreateAlertJobsTable.ts`:
```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAlertJobsTable1781000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE alert_job_type AS ENUM ('ADSET_INSIGHTS');
      CREATE TYPE alert_job_status AS ENUM ('ACTIVE', 'INACTIVE');
      CREATE TABLE alert_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type alert_job_type NOT NULL,
        status alert_job_status NOT NULL DEFAULT 'ACTIVE',
        client_id VARCHAR,
        fields TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS alert_jobs;
      DROP TYPE IF EXISTS alert_job_status;
      DROP TYPE IF EXISTS alert_job_type;
    `);
  }
}
```

- [ ] **Step 12: Register `AlertJobsModule` in `app.module.ts`**

Add to the imports array (after `ReportDispatchesModule`):
```typescript
import { AlertJobsModule } from './modules/alert-jobs/alert-jobs.module.js';
// ...
AlertJobsModule,
```

- [ ] **Step 13: Commit**

```bash
git add src/modules/alert-jobs/ \
        src/database/migrations/1781000000000-CreateAlertJobsTable.ts \
        src/app.module.ts
git commit -m "feat: add alert-jobs module with CRUD endpoints"
```

---

### Task 4: `adset-alert-snapshot` entity and migration

**Files:**
- Create: `src/modules/adset-alerts/entities/adset-alert-snapshot.entity.ts`
- Create: `src/database/migrations/1781000000001-CreateAdsetAlertSnapshotsTable.ts`

**Interfaces:**
- Produces: `AdsetAlertSnapshotEntity` — consumed by Task 5

- [ ] **Step 1: Create entity**

`src/modules/adset-alerts/entities/adset-alert-snapshot.entity.ts`:
```typescript
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';

@Entity('adset_alert_snapshots')
export class AdsetAlertSnapshotEntity extends BaseEntity {
  @Column({ name: 'job_id' })
  jobId: string;

  @Column({ name: 'client_id' })
  clientId: string;

  @Column({ name: 'ad_account_id' })
  adAccountId: string;

  @Column({ name: 'adset_id' })
  adsetId: string;

  @Column({ name: 'adset_name' })
  adsetName: string;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  roas: number | null;

  @Column({ name: 'updated_time', type: 'date' })
  updatedTime: string;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;
}
```

- [ ] **Step 2: Create migration**

`src/database/migrations/1781000000001-CreateAdsetAlertSnapshotsTable.ts`:
```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdsetAlertSnapshotsTable1781000000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE adset_alert_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id VARCHAR NOT NULL,
        client_id VARCHAR NOT NULL,
        ad_account_id VARCHAR NOT NULL,
        adset_id VARCHAR NOT NULL,
        adset_name VARCHAR NOT NULL,
        roas DECIMAL(10, 4),
        updated_time DATE NOT NULL,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS adset_alert_snapshots;`);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/adset-alerts/entities/adset-alert-snapshot.entity.ts \
        src/database/migrations/1781000000001-CreateAdsetAlertSnapshotsTable.ts
git commit -m "feat: add AdsetAlertSnapshotEntity and migration"
```

---

### Task 5: `AdsetAlertsService` — orchestration and message formatting

**Files:**
- Create: `src/modules/adset-alerts/adset-alerts.service.ts`
- Create: `src/modules/adset-alerts/adset-alerts.service.spec.ts`

**Interfaces:**
- Consumes:
  - `AlertJobsService.findActive(): Promise<AlertJobEntity[]>` (Task 3)
  - `AlertJobEntity.clientId: string | null`, `AlertJobEntity.id: string` (Task 3)
  - `ClientsService.findAll(): Promise<ClientEntity[]>` — returns active clients; `ClientEntity.id: string`, `ClientEntity.name: string`
  - `AdAccountsService.findAll(clientId: string): Promise<AdAccountEntity[]>` — `AdAccountEntity.adAccountId: string`, `AdAccountEntity.isActive: boolean`
  - `CampaignReportsService.listAdsets(adAccountId): Promise<MetaAdset[]>` (Task 2)
  - `CampaignReportsService.getAdsetInsights(adsetId, adAccountId, since, until): Promise<MetaInsights | null>` (Task 2)
  - `WhatsAppSessionService.sendMessage(groupJid, text): Promise<void>`
  - `ConfigService.get('MANAGERS_GROUP_JID'): string | undefined`
  - `AdsetAlertSnapshotEntity` (Task 4)
- Produces: `AdsetAlertsService.triggerAll()`, `AdsetAlertsService.triggerManual()`, `AdsetAlertsService.formatMessage()` (public for testing)

- [ ] **Step 1: Write failing tests**

`src/modules/adset-alerts/adset-alerts.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { AdsetAlertsService } from './adset-alerts.service.js';
import { AdsetAlertSnapshotEntity } from './entities/adset-alert-snapshot.entity.js';
import { AlertJobsService } from '../alert-jobs/alert-jobs.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { CampaignReportsService } from '../campaign-reports/campaign-reports.service.js';
import { WhatsAppSessionService } from '../whatsapp-session/whatsapp-session.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { AlertJobStatus } from '../alert-jobs/enums/alert-job-status.enum.js';
import { AlertJobType } from '../alert-jobs/enums/alert-job-type.enum.js';

const mockSnapshotRepo = { create: jest.fn(), save: jest.fn(), update: jest.fn() };
const mockAlertJobsService = { findActive: jest.fn() };
const mockAdAccountsService = { findAll: jest.fn() };
const mockCampaignReportsService = { listAdsets: jest.fn(), getAdsetInsights: jest.fn() };
const mockWhatsAppSessionService = { sendMessage: jest.fn() };
const mockClientsService = { findAll: jest.fn() };
const mockConfigService = { get: jest.fn().mockReturnValue('managers_group@g.us') };

const makeJob = (overrides = {}) => ({
  id: 'job-uuid-1',
  type: AlertJobType.ADSET_INSIGHTS,
  status: AlertJobStatus.ACTIVE,
  clientId: null,
  fields: ['roas', 'last_updated'],
  ...overrides,
});

describe('AdsetAlertsService', () => {
  let service: AdsetAlertsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSnapshotRepo.create.mockImplementation(data => data);
    mockSnapshotRepo.save.mockImplementation(async data => ({ ...data, id: 'snapshot-uuid' }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdsetAlertsService,
        { provide: getRepositoryToken(AdsetAlertSnapshotEntity), useValue: mockSnapshotRepo },
        { provide: AlertJobsService, useValue: mockAlertJobsService },
        { provide: AdAccountsService, useValue: mockAdAccountsService },
        { provide: CampaignReportsService, useValue: mockCampaignReportsService },
        { provide: WhatsAppSessionService, useValue: mockWhatsAppSessionService },
        { provide: ClientsService, useValue: mockClientsService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<AdsetAlertsService>(AdsetAlertsService);
  });

  describe('formatMessage', () => {
    it('formats clients and adsets with bold WhatsApp syntax', () => {
      const map = new Map([
        ['c1', {
          clientName: 'Marca ABC',
          adsets: [
            { adsetName: 'CJ - Retargeting', roas: 3.42, updatedTime: '2026-08-05' },
            { adsetName: 'CJ - Prospecting', roas: 1.87, updatedTime: '2026-08-01' },
          ],
        }],
      ]);

      const result = service.formatMessage(map, []);

      expect(result).toContain('*Nome do cliente*: Marca ABC');
      expect(result).toContain('*Conjunto de anúncios*: CJ - Retargeting | *ROAS*: 3.42 | *Última atualização*: 05/08/2026');
      expect(result).toContain('*Conjunto de anúncios*: CJ - Prospecting | *ROAS*: 1.87 | *Última atualização*: 01/08/2026');
    });

    it('displays – when ROAS is null', () => {
      const map = new Map([
        ['c1', {
          clientName: 'Loja XYZ',
          adsets: [{ adsetName: 'CJ - Top', roas: null, updatedTime: '2026-08-03' }],
        }],
      ]);

      const result = service.formatMessage(map, []);

      expect(result).toContain('*ROAS*: –');
    });

    it('appends error footer when there are errors', () => {
      const map = new Map();
      const errors = ['Marca ZZZ / act_456: token expirado'];

      const result = service.formatMessage(map, errors);

      expect(result).toContain('⚠️ *Erros:*');
      expect(result).toContain('- Marca ZZZ / act_456: token expirado');
    });

    it('omits error footer when there are no errors', () => {
      const map = new Map([
        ['c1', {
          clientName: 'Marca ABC',
          adsets: [{ adsetName: 'CJ - Test', roas: 2.0, updatedTime: '2026-08-01' }],
        }],
      ]);

      const result = service.formatMessage(map, []);

      expect(result).not.toContain('⚠️');
    });

    it('formats date as DD/MM/YYYY', () => {
      const map = new Map([
        ['c1', {
          clientName: 'Marca',
          adsets: [{ adsetName: 'CJ', roas: 1.0, updatedTime: '2026-01-09' }],
        }],
      ]);

      const result = service.formatMessage(map, []);

      expect(result).toContain('09/01/2026');
    });

    it('skips clients with no adsets', () => {
      const map = new Map([
        ['c1', { clientName: 'Vazio', adsets: [] }],
        ['c2', { clientName: 'Com dados', adsets: [{ adsetName: 'CJ', roas: 1.0, updatedTime: '2026-08-01' }] }],
      ]);

      const result = service.formatMessage(map, []);

      expect(result).not.toContain('Vazio');
      expect(result).toContain('Com dados');
    });
  });

  describe('runForJob', () => {
    it('skips inactive ad accounts', async () => {
      const job = makeJob({ clientId: 'client-1' });
      mockClientsService.findAll.mockResolvedValueOnce([{ id: 'client-1', name: 'Marca' }]);
      mockAdAccountsService.findAll.mockResolvedValueOnce([
        { adAccountId: 'act_123', isActive: false },
      ]);
      mockWhatsAppSessionService.sendMessage.mockResolvedValueOnce(undefined);

      await service.runForJob(job);

      expect(mockCampaignReportsService.listAdsets).not.toHaveBeenCalled();
    });

    it('accumulates error and continues when listAdsets throws', async () => {
      const job = makeJob({ clientId: 'client-1' });
      mockClientsService.findAll.mockResolvedValueOnce([{ id: 'client-1', name: 'Marca' }]);
      mockAdAccountsService.findAll.mockResolvedValueOnce([
        { adAccountId: 'act_123', isActive: true },
      ]);
      mockCampaignReportsService.listAdsets.mockRejectedValueOnce(new Error('API down'));
      mockWhatsAppSessionService.sendMessage.mockResolvedValueOnce(undefined);

      await service.runForJob(job);

      expect(mockWhatsAppSessionService.sendMessage).toHaveBeenCalledWith(
        'managers_group@g.us',
        expect.stringContaining('⚠️ *Erros:*'),
      );
    });

    it('stores roas as null when ROAS value is 0', async () => {
      const job = makeJob({ clientId: 'client-1' });
      mockClientsService.findAll.mockResolvedValueOnce([{ id: 'client-1', name: 'Marca' }]);
      mockAdAccountsService.findAll.mockResolvedValueOnce([
        { adAccountId: 'act_123', isActive: true },
      ]);
      mockCampaignReportsService.listAdsets.mockResolvedValueOnce([
        { id: 'adset_1', name: 'CJ', updated_time: '2026-08-01T00:00:00+0000', effective_status: 'ACTIVE' },
      ]);
      mockCampaignReportsService.getAdsetInsights.mockResolvedValueOnce({
        purchase_roas: [{ action_type: 'omni_purchase', value: '0' }],
      });
      mockWhatsAppSessionService.sendMessage.mockResolvedValueOnce(undefined);

      await service.runForJob(job);

      expect(mockSnapshotRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ roas: null }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=adset-alerts.service --no-coverage
```

Expected: fail — module not found.

- [ ] **Step 3: Implement `AdsetAlertsService`**

`src/modules/adset-alerts/adset-alerts.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AdsetAlertSnapshotEntity } from './entities/adset-alert-snapshot.entity.js';
import { AlertJobsService } from '../alert-jobs/alert-jobs.service.js';
import { AlertJobEntity } from '../alert-jobs/entities/alert-job.entity.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { CampaignReportsService } from '../campaign-reports/campaign-reports.service.js';
import { WhatsAppSessionService } from '../whatsapp-session/whatsapp-session.service.js';
import { ClientsService } from '../clients/clients.service.js';

interface AdsetRow {
  adsetName: string;
  roas: number | null;
  updatedTime: string;
}

interface ClientBucket {
  clientName: string;
  adsets: AdsetRow[];
}

@Injectable()
export class AdsetAlertsService {
  private readonly logger = new Logger(AdsetAlertsService.name);

  constructor(
    @InjectRepository(AdsetAlertSnapshotEntity)
    private readonly snapshotRepo: Repository<AdsetAlertSnapshotEntity>,
    private readonly alertJobsService: AlertJobsService,
    private readonly adAccountsService: AdAccountsService,
    private readonly campaignReportsService: CampaignReportsService,
    private readonly whatsAppSessionService: WhatsAppSessionService,
    private readonly clientsService: ClientsService,
    private readonly configService: ConfigService,
  ) {}

  async triggerAll(): Promise<void> {
    const jobs = await this.alertJobsService.findActive();
    for (const job of jobs) {
      await this.runForJob(job);
    }
  }

  async triggerManual(): Promise<void> {
    await this.triggerAll();
  }

  async runForJob(job: AlertJobEntity): Promise<void> {
    const errors: string[] = [];
    const clientBuckets = new Map<string, ClientBucket>();
    const snapshotIds: string[] = [];
    const today = new Date().toISOString().slice(0, 10);

    const clients = job.clientId
      ? [{ id: job.clientId, name: job.clientId }]
      : await this.clientsService.findAll();

    for (const client of clients) {
      const clientName = client.name ?? client.id;
      const adAccounts = await this.adAccountsService.findAll(client.id);
      const activeAccounts = adAccounts.filter(a => a.isActive);

      for (const account of activeAccounts) {
        let adsets;
        try {
          adsets = await this.campaignReportsService.listAdsets(account.adAccountId);
        } catch (err: any) {
          const msg = `${clientName} / ${account.adAccountId}: ${err?.message ?? String(err)}`;
          errors.push(msg);
          this.logger.error(`Falha ao buscar adsets para ${account.adAccountId}: ${msg}`);
          continue;
        }

        const activeAdsets = adsets.filter(a => a.effective_status === 'ACTIVE');

        for (const adset of activeAdsets) {
          const since = adset.updated_time.slice(0, 10);
          let roas: number | null = null;

          try {
            const insights = await this.campaignReportsService.getAdsetInsights(
              adset.id,
              account.adAccountId,
              since,
              today,
            );
            if (insights) {
              const raw = parseFloat(insights.purchase_roas?.[0]?.value ?? '0');
              roas = raw > 0 ? raw : null;
            }
          } catch (err: any) {
            const msg = `${clientName} / ${adset.name}: ${err?.message ?? String(err)}`;
            errors.push(msg);
            this.logger.error(`Falha ao buscar insights do adset ${adset.id}: ${msg}`);
          }

          const saved = await this.snapshotRepo.save(
            this.snapshotRepo.create({
              jobId: job.id,
              clientId: client.id,
              adAccountId: account.adAccountId,
              adsetId: adset.id,
              adsetName: adset.name,
              roas,
              updatedTime: since,
              sentAt: null,
            }),
          );
          snapshotIds.push(saved.id);

          if (!clientBuckets.has(client.id)) {
            clientBuckets.set(client.id, { clientName, adsets: [] });
          }
          clientBuckets.get(client.id)!.adsets.push({ adsetName: adset.name, roas, updatedTime: since });
        }
      }
    }

    const managersGroupJid = this.configService.get<string>('MANAGERS_GROUP_JID');
    if (!managersGroupJid) {
      this.logger.warn('MANAGERS_GROUP_JID não configurado — mensagem não enviada');
      return;
    }

    const message = this.formatMessage(clientBuckets, errors);
    try {
      await this.whatsAppSessionService.sendMessage(managersGroupJid, message);
      if (snapshotIds.length > 0) {
        await this.snapshotRepo.update({ id: In(snapshotIds) }, { sentAt: new Date() });
      }
    } catch (err: any) {
      this.logger.error(`Falha ao enviar mensagem para o grupo de managers: ${err?.message ?? String(err)}`);
    }
  }

  formatMessage(clientBuckets: Map<string, ClientBucket>, errors: string[]): string {
    const lines: string[] = [];

    for (const { clientName, adsets } of clientBuckets.values()) {
      if (!adsets.length) continue;
      lines.push(`*Nome do cliente*: ${clientName}`);
      lines.push('');
      for (const adset of adsets) {
        const roas = adset.roas !== null ? adset.roas.toFixed(2) : '–';
        const date = this.formatDate(adset.updatedTime);
        lines.push(`*Conjunto de anúncios*: ${adset.adsetName} | *ROAS*: ${roas} | *Última atualização*: ${date}`);
      }
      lines.push('');
    }

    if (errors.length) {
      lines.push('⚠️ *Erros:*');
      for (const err of errors) {
        lines.push(`- ${err}`);
      }
    }

    return lines.join('\n').trim();
  }

  private formatDate(isoDate: string): string {
    const [year, month, day] = isoDate.slice(0, 10).split('-');
    return `${day}/${month}/${year}`;
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=adset-alerts.service --no-coverage
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/adset-alerts/adset-alerts.service.ts \
        src/modules/adset-alerts/adset-alerts.service.spec.ts
git commit -m "feat: implement AdsetAlertsService with orchestration and message formatting"
```

---

### Task 6: Scheduler, controller, module, wire up

**Files:**
- Create: `src/modules/adset-alerts/adset-alert-scheduler.service.ts`
- Create: `src/modules/adset-alerts/adset-alert-scheduler.service.spec.ts`
- Create: `src/modules/adset-alerts/adset-alerts.controller.ts`
- Create: `src/modules/adset-alerts/adset-alerts.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `AdsetAlertsService.triggerAll()`, `AdsetAlertsService.triggerManual()` (Task 5)

- [ ] **Step 1: Write failing scheduler tests**

`src/modules/adset-alerts/adset-alert-scheduler.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AdsetAlertSchedulerService } from './adset-alert-scheduler.service.js';
import { AdsetAlertsService } from './adset-alerts.service.js';

const mockAdsetAlertsService = { triggerAll: jest.fn() };

describe('AdsetAlertSchedulerService', () => {
  let service: AdsetAlertSchedulerService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdsetAlertSchedulerService,
        { provide: AdsetAlertsService, useValue: mockAdsetAlertsService },
      ],
    }).compile();
    service = module.get<AdsetAlertSchedulerService>(AdsetAlertSchedulerService);
  });

  describe('handleDailyCron', () => {
    it('calls triggerAll after the delay', async () => {
      jest.useFakeTimers();
      mockAdsetAlertsService.triggerAll.mockResolvedValueOnce(undefined);

      const cronPromise = service.handleDailyCron();
      jest.runAllTimers();
      await cronPromise;

      expect(mockAdsetAlertsService.triggerAll).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=adset-alert-scheduler --no-coverage
```

Expected: fail — module not found.

- [ ] **Step 3: Implement scheduler service**

`src/modules/adset-alerts/adset-alert-scheduler.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AdsetAlertsService } from './adset-alerts.service.js';

@Injectable()
export class AdsetAlertSchedulerService {
  private readonly logger = new Logger(AdsetAlertSchedulerService.name);

  constructor(private readonly adsetAlertsService: AdsetAlertsService) {}

  @Cron('30 7 * * *', { timeZone: 'America/Sao_Paulo' })
  async handleDailyCron(): Promise<void> {
    const delayMs = Math.floor(Math.random() * 30 * 60 * 1000);
    this.logger.log(`Alerta de adsets agendado — delay de ${Math.round(delayMs / 60000)} min`);
    await this.delay(delayMs);
    this.logger.log('Iniciando alerta diário de adsets');
    await this.adsetAlertsService.triggerAll();
    this.logger.log('Alerta diário de adsets concluído');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest --testPathPattern=adset-alert-scheduler --no-coverage
```

Expected: all tests pass.

- [ ] **Step 5: Create controller**

`src/modules/adset-alerts/adset-alerts.controller.ts`:
```typescript
import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { AdsetAlertsService } from './adset-alerts.service.js';

@ApiTags('adset-alerts')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(AuthGuard)
@Controller('adset-alerts')
export class AdsetAlertsController {
  constructor(private readonly adsetAlertsService: AdsetAlertsService) {}

  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disparar alerta de adsets manualmente (sem delay aleatório)' })
  async trigger(): Promise<{ triggered: boolean }> {
    await this.adsetAlertsService.triggerManual();
    return { triggered: true };
  }
}
```

- [ ] **Step 6: Create module**

> **Note:** `WhatsAppSessionModule` is decorated with `@Global()` — `WhatsAppSessionService` is available in all modules without being imported explicitly.

`src/modules/adset-alerts/adset-alerts.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdsetAlertSnapshotEntity } from './entities/adset-alert-snapshot.entity.js';
import { AdsetAlertsService } from './adset-alerts.service.js';
import { AdsetAlertSchedulerService } from './adset-alert-scheduler.service.js';
import { AdsetAlertsController } from './adset-alerts.controller.js';
import { AlertJobsModule } from '../alert-jobs/alert-jobs.module.js';
import { AdAccountsModule } from '../ad-accounts/ad-accounts.module.js';
import { CampaignReportsModule } from '../campaign-reports/campaign-reports.module.js';
import { ClientsModule } from '../clients/clients.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdsetAlertSnapshotEntity]),
    AlertJobsModule,
    AdAccountsModule,
    CampaignReportsModule,
    ClientsModule,
  ],
  controllers: [AdsetAlertsController],
  providers: [AdsetAlertsService, AdsetAlertSchedulerService],
})
export class AdsetAlertsModule {}
```

- [ ] **Step 7: Register `AdsetAlertsModule` in `app.module.ts`**

Add import and to the imports array (after `AlertJobsModule`):
```typescript
import { AdsetAlertsModule } from './modules/adset-alerts/adset-alerts.module.js';
// ...
AdsetAlertsModule,
```

- [ ] **Step 8: Run full test suite to confirm no regressions**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 9: Run linter**

```bash
npm run lint
```

Fix any lint errors before committing.

- [ ] **Step 10: Commit**

```bash
git add src/modules/adset-alerts/ src/app.module.ts
git commit -m "feat: add adset-alerts module with daily cron scheduler and manual trigger"
```

---

## Post-implementation checklist

- [ ] Run pending TypeORM migrations against a local DB to verify SQL is correct
- [ ] Set `MANAGERS_GROUP_JID` in `.env` if not already present
- [ ] Test `POST /adset-alerts/trigger` with a real WhatsApp session active
- [ ] Verify the message appears in the managers group with correct formatting
- [ ] Test `POST /alert-jobs` to create a job, then `PATCH /alert-jobs/:id` to toggle it inactive and confirm `POST /adset-alerts/trigger` skips it
