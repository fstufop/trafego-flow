# Media Upload Async + History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the synchronous batch upload flow with a single-file-per-request pipeline that uploads to Drive synchronously (resilient staging), queues Meta upload via BullMQ, persists a full history log, and supports manual retry per file or in bulk.

**Architecture:** `POST /upload` accepts one file, uploads it to Drive (sync), saves a `MediaUploadLog` with `status = PROCESSING`, enqueues a BullMQ job, and returns 201 immediately. The worker downloads from Drive and uploads to Meta — so retry is always durable regardless of temp file lifetime. No BullMQ automatic retries; all retries are manual.

**Tech Stack:** `@nestjs/bullmq`, `bullmq`, TypeORM (new entity + migration), PostgreSQL, Redis (existing config), Node.js `URL` API (no new ioredis import needed), NestJS 11.

**Spec:** `docs/superpowers/specs/2026-08-25-media-upload-async-history-design.md`

## Global Constraints

- All TypeScript imports must include `.js` extension (NodeNext module resolution)
- Single quotes, trailing commas everywhere (Prettier config)
- Jest 30 + ts-jest; run single file with `npx jest --testPathPattern=<filename>`
- Migration timestamps must exceed `1781000000001` (last existing migration)
- BullMQ job option `attempts: 1` — no automatic retries; job "completes" from BullMQ's perspective even on Meta failure; DB is the source of truth for status
- `@typescript-eslint/no-explicit-any` is disabled — `any` is allowed but avoid it

---

### Task 1: Install BullMQ and register in AppModule

**Files:**
- Modify: `package.json` (via install command)
- Modify: `src/app.module.ts`

**Interfaces:**
- Produces: `BullModule` globally available; any feature module can call `BullModule.registerQueue({ name: '...' })`

- [ ] **Step 1: Install packages**

```bash
pnpm add @nestjs/bullmq bullmq
```

- [ ] **Step 2: Add BullModule.forRootAsync to AppModule**

Open `src/app.module.ts`. Add the import and the module after `ScheduleModule.forRoot()`:

```typescript
import { BullModule } from '@nestjs/bullmq';
```

Inside the `imports` array, after `ScheduleModule.forRoot()`:

```typescript
BullModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const redisUrl = new URL(config.get<string>('redis.url')!);
    return {
      connection: {
        host: redisUrl.hostname,
        port: Number(redisUrl.port) || 6379,
        password: redisUrl.password || undefined,
        maxRetriesPerRequest: null,
      },
    };
  },
}),
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/app.module.ts package.json pnpm-lock.yaml
git commit -m "feat(media-library): install bullmq and register globally in AppModule"
```

---

### Task 2: MediaUploadStatus enum + MediaUploadLog entity + migration

**Files:**
- Create: `src/modules/media-library/enums/media-upload-status.enum.ts`
- Create: `src/modules/media-library/entities/media-upload-log.entity.ts`
- Create: `src/database/migrations/1781200000000-CreateMediaUploadLogsTable.ts`

**Interfaces:**
- Produces: `MediaUploadStatus` enum and `MediaUploadLog` entity consumed by Tasks 3, 5, 6, 7

- [ ] **Step 1: Create the status enum**

`src/modules/media-library/enums/media-upload-status.enum.ts`:

```typescript
export enum MediaUploadStatus {
  PROCESSING = 'processing',
  SUCCESS = 'success',
  FAILED = 'failed',
}
```

- [ ] **Step 2: Create the entity**

`src/modules/media-library/entities/media-upload-log.entity.ts`:

```typescript
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { MediaUploadStatus } from '../enums/media-upload-status.enum.js';

@Entity('media_upload_logs')
export class MediaUploadLog extends BaseEntity {
  @Column({ name: 'client_id' })
  @Index()
  clientId: string;

  @Column({ name: 'ad_account_id' })
  adAccountId: string;

  @Column({ name: 'media_name' })
  mediaName: string;

  @Column({ name: 'original_file_name' })
  originalFileName: string;

  @Column({ name: 'mime_type' })
  mimeType: string;

  @Column({ type: 'enum', enum: MediaUploadStatus, default: MediaUploadStatus.PROCESSING })
  status: MediaUploadStatus;

  @Column({ name: 'drive_file_id' })
  driveFileId: string;

  @Column({ name: 'drive_url' })
  driveUrl: string;

  @Column({ name: 'meta_asset_id', nullable: true, default: null })
  metaAssetId: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true, default: null })
  errorMessage: string | null;

  @Column({ name: 'attempt_count', default: 0 })
  attemptCount: number;
}
```

- [ ] **Step 3: Create the migration**

`src/database/migrations/1781200000000-CreateMediaUploadLogsTable.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMediaUploadLogsTable1781200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "media_upload_status_enum" AS ENUM ('processing', 'success', 'failed')
    `);
    await queryRunner.query(`
      CREATE TABLE "media_upload_logs" (
        "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
        "client_id"          VARCHAR      NOT NULL,
        "ad_account_id"      VARCHAR      NOT NULL,
        "media_name"         VARCHAR      NOT NULL,
        "original_file_name" VARCHAR      NOT NULL,
        "mime_type"          VARCHAR      NOT NULL,
        "status"             "media_upload_status_enum" NOT NULL DEFAULT 'processing',
        "drive_file_id"      VARCHAR      NOT NULL,
        "drive_url"          VARCHAR      NOT NULL,
        "meta_asset_id"      VARCHAR,
        "error_message"      TEXT,
        "attempt_count"      INTEGER      NOT NULL DEFAULT 0,
        "created_at"         TIMESTAMP    NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP    NOT NULL DEFAULT now(),
        "deleted_at"         TIMESTAMP,
        CONSTRAINT "PK_media_upload_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_media_upload_logs_client_id" ON "media_upload_logs" ("client_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_media_upload_logs_client_id"`);
    await queryRunner.query(`DROP TABLE "media_upload_logs"`);
    await queryRunner.query(`DROP TYPE "media_upload_status_enum"`);
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/media-library/enums/media-upload-status.enum.ts \
        src/modules/media-library/entities/media-upload-log.entity.ts \
        src/database/migrations/1781200000000-CreateMediaUploadLogsTable.ts
git commit -m "feat(media-library): add MediaUploadLog entity, status enum and migration"
```

---

### Task 3: FileNamerService — replace batch `generateNames` with async `generateName`

**Files:**
- Modify: `src/modules/media-library/services/file-namer.service.ts`
- Modify: `src/modules/media-library/services/file-namer.service.spec.ts`

**Interfaces:**
- Consumes: `MediaUploadLog` entity (Task 2), `Repository<MediaUploadLog>` via TypeORM injection
- Produces: `FileNamerService.generateName(file, intention, productName, clientId, date?, startVersion?): Promise<string>` — consumed by Task 6

- [ ] **Step 1: Write the failing tests**

Replace `src/modules/media-library/services/file-namer.service.spec.ts` entirely:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileNamerService } from './file-namer.service.js';
import { MediaUploadLog } from '../entities/media-upload-log.entity.js';
import { MediaIntention } from '../dto/upload-media.dto.js';

const DATE = new Date(2026, 7, 1); // August 2026

function makeModule(countReturn: number) {
  return Test.createTestingModule({
    providers: [
      FileNamerService,
      {
        provide: getRepositoryToken(MediaUploadLog),
        useValue: { count: jest.fn().mockResolvedValue(countReturn) },
      },
    ],
  }).compile();
}

describe('FileNamerService.generateName', () => {
  it('generates name without version when no existing logs today', async () => {
    const module = await makeModule(0);
    const svc = module.get(FileNamerService);
    const name = await svc.generateName({ originalname: 'photo.jpg' }, MediaIntention.PRD, 'Produto X', 'client-1', DATE);
    expect(name).toBe('PRD - IMG - Produto X - Ago 26.jpg');
  });

  it('adds -V2 when one existing log found today', async () => {
    const module = await makeModule(1);
    const svc = module.get(FileNamerService);
    const name = await svc.generateName({ originalname: 'photo.jpg' }, MediaIntention.PRD, 'Produto X', 'client-1', DATE);
    expect(name).toBe('PRD - IMG - Produto X - Ago 26 - V2.jpg');
  });

  it('adds -V3 when two existing logs found today', async () => {
    const module = await makeModule(2);
    const svc = module.get(FileNamerService);
    const name = await svc.generateName({ originalname: 'photo.jpg' }, MediaIntention.PRD, 'Produto X', 'client-1', DATE);
    expect(name).toBe('PRD - IMG - Produto X - Ago 26 - V3.jpg');
  });

  it('uses startVersion as absolute version, ignoring DB count', async () => {
    const module = await makeModule(0);
    const svc = module.get(FileNamerService);
    const name = await svc.generateName({ originalname: 'photo.jpg' }, MediaIntention.PRD, 'Produto X', 'client-1', DATE, 5);
    expect(name).toBe('PRD - IMG - Produto X - Ago 26 - V5.jpg');
  });

  it('detects .mov as VID', async () => {
    const module = await makeModule(0);
    const svc = module.get(FileNamerService);
    const name = await svc.generateName({ originalname: 'video.mov' }, MediaIntention.PRD, 'Prod', 'client-1', DATE);
    expect(name).toContain('VID');
  });

  it('strips accents and special chars from product name', async () => {
    const module = await makeModule(0);
    const svc = module.get(FileNamerService);
    const name = await svc.generateName({ originalname: 'f.jpg' }, MediaIntention.PRD, 'Ação & Reação!', 'client-1', DATE);
    expect(name).toBe('PRD - IMG - Acao  Reacao - Ago 26.jpg');
  });

  it('queries DB with correct clientId and base name prefix', async () => {
    const module = await makeModule(0);
    const svc = module.get(FileNamerService);
    const repo = module.get<Repository<MediaUploadLog>>(getRepositoryToken(MediaUploadLog));
    await svc.generateName({ originalname: 'photo.jpg' }, MediaIntention.PRD, 'Nike', 'client-42', DATE);
    expect(repo.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client-42',
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=file-namer.service.spec
```

Expected: FAIL — `generateName is not a function` (method doesn't exist yet).

- [ ] **Step 3: Implement `generateName` and remove `generateNames`**

Replace `src/modules/media-library/services/file-namer.service.ts` entirely:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, MoreThanOrEqual } from 'typeorm';
import { MediaIntention } from '../dto/upload-media.dto.js';
import { MediaUploadLog } from '../entities/media-upload-log.entity.js';

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
const PT_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function mediaType(ext: string): 'VID' | 'IMG' {
  return VIDEO_EXTS.has(ext.toLowerCase()) ? 'VID' : 'IMG';
}

function sanitize(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim();
}

function dateSuffix(date: Date): string {
  return `${PT_MONTHS[date.getMonth()]} ${String(date.getFullYear()).slice(-2)}`;
}

@Injectable()
export class FileNamerService {
  constructor(
    @InjectRepository(MediaUploadLog)
    private readonly logsRepo: Repository<MediaUploadLog>,
  ) {}

  async generateName(
    file: { originalname: string },
    intention: MediaIntention,
    productName: string,
    clientId: string,
    date = new Date(),
    startVersion?: number,
  ): Promise<string> {
    const dotIdx = file.originalname.lastIndexOf('.');
    const ext = dotIdx >= 0 ? file.originalname.slice(dotIdx) : '';
    const product = sanitize(productName);
    const dateStr = dateSuffix(date);
    const base = `${intention} - ${mediaType(ext)} - ${product} - ${dateStr}`;

    if (startVersion !== undefined) {
      return `${base} - V${startVersion}${ext}`;
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const count = await this.logsRepo.count({
      where: {
        clientId,
        mediaName: Like(`${base}%`),
        createdAt: MoreThanOrEqual(startOfDay),
      },
    });

    return count === 0 ? `${base}${ext}` : `${base} - V${count + 1}${ext}`;
  }
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npx jest --testPathPattern=file-namer.service.spec
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/media-library/services/file-namer.service.ts \
        src/modules/media-library/services/file-namer.service.spec.ts
git commit -m "feat(media-library): replace batch generateNames with async DB-backed generateName"
```

---

### Task 4: GoogleDriveService — add `download` method

**Files:**
- Modify: `src/modules/media-library/services/google-drive.service.ts`
- Modify: `src/modules/media-library/services/google-drive.service.spec.ts`

**Interfaces:**
- Produces: `GoogleDriveService.download(fileId: string, destPath: string): Promise<void>` — consumed by Task 5 (worker)

- [ ] **Step 1: Write the failing test**

Add a `describe('download', ...)` block inside `google-drive.service.spec.ts`. The existing `jest.mock('fs', ...)` at the top only mocks `createReadStream`. Update it to also mock `createWriteStream`:

Replace the `jest.mock('fs', ...)` line:

```typescript
jest.mock('fs', () => ({
  createReadStream: jest.fn(() => 'stream'),
  createWriteStream: jest.fn(),
}));
```

Add these imports at the top of the file (after the `jest.mock` calls):

```typescript
import { PassThrough } from 'stream';
```

Add the new describe block after the existing `describe('upload', ...)`:

```typescript
describe('download', () => {
  it('fetches file from Drive via alt=media and pipes to destPath', async () => {
    const svc = makeSvc();
    const driveInstance = google.drive({} as any) as any;

    const readable = new PassThrough();
    const writable = new PassThrough();

    (driveInstance.files.get as jest.Mock).mockResolvedValue({ data: readable });
    (fs.createWriteStream as jest.Mock).mockReturnValue(writable);

    const downloadPromise = svc.download('file-abc', '/tmp/output.mp4');
    readable.end();
    await downloadPromise;

    expect(driveInstance.files.get).toHaveBeenCalledWith(
      { fileId: 'file-abc', alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    );
    expect(fs.createWriteStream).toHaveBeenCalledWith('/tmp/output.mp4');
  });

  it('rejects when the stream emits an error', async () => {
    const svc = makeSvc();
    const driveInstance = google.drive({} as any) as any;

    const readable = new PassThrough();
    const writable = new PassThrough();

    (driveInstance.files.get as jest.Mock).mockResolvedValue({ data: readable });
    (fs.createWriteStream as jest.Mock).mockReturnValue(writable);

    const downloadPromise = svc.download('file-abc', '/tmp/output.mp4');
    writable.emit('error', new Error('disk full'));

    await expect(downloadPromise).rejects.toThrow('disk full');
  });
});
```

Also update the mock for `files` in the `google.drive` mock to include `get`:

```typescript
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
      })),
    },
    drive: jest.fn().mockReturnValue({
      files: {
        create: jest.fn(),
        get: jest.fn(),
      },
    }),
  },
}));
```

- [ ] **Step 2: Run tests to confirm new tests fail**

```bash
npx jest --testPathPattern=google-drive.service.spec
```

Expected: existing tests PASS, new `download` tests FAIL (`svc.download is not a function`).

- [ ] **Step 3: Implement `download` in GoogleDriveService**

Add to `src/modules/media-library/services/google-drive.service.ts` — add `import * as fs from 'fs'` if not already present, then add this method inside the class after `upload`:

```typescript
async download(fileId: string, destPath: string): Promise<void> {
  const dest = fs.createWriteStream(destPath);
  const response = await this.drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' },
  );
  await new Promise<void>((resolve, reject) => {
    (response.data as NodeJS.ReadableStream).pipe(dest)
      .on('finish', resolve)
      .on('error', reject);
  });
}
```

- [ ] **Step 4: Run all tests and confirm they pass**

```bash
npx jest --testPathPattern=google-drive.service.spec
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/media-library/services/google-drive.service.ts \
        src/modules/media-library/services/google-drive.service.spec.ts
git commit -m "feat(media-library): add GoogleDriveService.download for worker retry flow"
```

---

### Task 5: MetaUploadJobPayload type + MetaUploadProcessor

**Files:**
- Create: `src/modules/media-library/types/meta-upload-job.type.ts`
- Create: `src/modules/media-library/processors/meta-upload.processor.ts`
- Create: `src/modules/media-library/processors/meta-upload.processor.spec.ts`

**Interfaces:**
- Consumes: `MediaUploadLog` (Task 2), `GoogleDriveService.download` (Task 4), `MediaUploadStatus` (Task 2), `AesCryptoService`, `MetaMediaService`
- Produces: `MetaUploadProcessor` and `MetaUploadJobPayload` — consumed by Tasks 6 and 7

- [ ] **Step 1: Create the job payload type**

`src/modules/media-library/types/meta-upload-job.type.ts`:

```typescript
export interface MetaUploadJobPayload {
  logId: string;
  driveFileId: string;
  adAccountId: string;
  encryptedAccessToken: string;
  mimeType: string;
  mediaName: string;
}
```

- [ ] **Step 2: Write the failing processor tests**

`src/modules/media-library/processors/meta-upload.processor.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import * as os from 'os';
import * as fs from 'fs';
import { MetaUploadProcessor } from './meta-upload.processor.js';
import { MediaUploadLog } from '../entities/media-upload-log.entity.js';
import { MediaUploadStatus } from '../enums/media-upload-status.enum.js';
import { MetaMediaService } from '../services/meta-media.service.js';
import { GoogleDriveService } from '../services/google-drive.service.js';
import { AesCryptoService } from '../../../common/crypto/aes.service.js';
import { MetaUploadJobPayload } from '../types/meta-upload-job.type.js';

jest.mock('fs', () => ({ unlink: jest.fn((_path, cb) => cb(null)) }));

function makeJob(data: MetaUploadJobPayload): Job<MetaUploadJobPayload> {
  return { data, id: 'job-1', opts: {} } as unknown as Job<MetaUploadJobPayload>;
}

const PAYLOAD: MetaUploadJobPayload = {
  logId: 'log-uuid',
  driveFileId: 'drive-file-id',
  adAccountId: 'act_123',
  encryptedAccessToken: 'enc_token',
  mimeType: 'video/mp4',
  mediaName: 'PRD - VID - Nike - Ago 26 - V1.mp4',
};

describe('MetaUploadProcessor', () => {
  let processor: MetaUploadProcessor;
  let logsRepo: { update: jest.Mock };
  let meta: jest.Mocked<MetaMediaService>;
  let drive: jest.Mocked<GoogleDriveService>;
  let crypto: jest.Mocked<AesCryptoService>;

  beforeEach(async () => {
    logsRepo = { update: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        MetaUploadProcessor,
        { provide: getRepositoryToken(MediaUploadLog), useValue: logsRepo },
        { provide: MetaMediaService, useValue: { upload: jest.fn() } },
        { provide: GoogleDriveService, useValue: { download: jest.fn() } },
        { provide: AesCryptoService, useValue: { decrypt: jest.fn().mockReturnValue('plain_token') } },
      ],
    }).compile();

    processor = module.get(MetaUploadProcessor);
    meta = module.get(MetaMediaService) as jest.Mocked<MetaMediaService>;
    drive = module.get(GoogleDriveService) as jest.Mocked<GoogleDriveService>;
    crypto = module.get(AesCryptoService) as jest.Mocked<AesCryptoService>;
  });

  afterEach(() => jest.clearAllMocks());

  it('downloads from Drive, uploads to Meta, and marks log SUCCESS', async () => {
    drive.download.mockResolvedValue(undefined);
    meta.upload.mockResolvedValue('meta-asset-id');

    await processor.process(makeJob(PAYLOAD));

    expect(crypto.decrypt).toHaveBeenCalledWith('enc_token');
    expect(drive.download).toHaveBeenCalledWith('drive-file-id', expect.stringContaining(os.tmpdir()));
    expect(meta.upload).toHaveBeenCalledWith(
      'act_123',
      'plain_token',
      expect.any(String),
      'PRD - VID - Nike - Ago 26 - V1.mp4',
      'video/mp4',
    );
    expect(logsRepo.update).toHaveBeenCalledWith('log-uuid', {
      status: MediaUploadStatus.SUCCESS,
      metaAssetId: 'meta-asset-id',
      errorMessage: null,
    });
  });

  it('marks log FAILED when Meta upload throws, without rethrowing', async () => {
    drive.download.mockResolvedValue(undefined);
    meta.upload.mockRejectedValue(new Error('token expirado'));

    await expect(processor.process(makeJob(PAYLOAD))).resolves.toBeUndefined();

    expect(logsRepo.update).toHaveBeenCalledWith('log-uuid', {
      status: MediaUploadStatus.FAILED,
      errorMessage: expect.stringContaining('token expirado'),
    });
  });

  it('marks log FAILED when Drive download throws, without rethrowing', async () => {
    drive.download.mockRejectedValue(new Error('Drive API error'));

    await expect(processor.process(makeJob(PAYLOAD))).resolves.toBeUndefined();

    expect(logsRepo.update).toHaveBeenCalledWith('log-uuid', {
      status: MediaUploadStatus.FAILED,
      errorMessage: expect.stringContaining('Drive API error'),
    });
  });

  it('always unlinks the temp file even on failure', async () => {
    drive.download.mockResolvedValue(undefined);
    meta.upload.mockRejectedValue(new Error('error'));

    await processor.process(makeJob(PAYLOAD));

    expect(fs.unlink).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=meta-upload.processor.spec
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement MetaUploadProcessor**

`src/modules/media-library/processors/meta-upload.processor.ts`:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MediaUploadLog } from '../entities/media-upload-log.entity.js';
import { MediaUploadStatus } from '../enums/media-upload-status.enum.js';
import { MetaUploadJobPayload } from '../types/meta-upload-job.type.js';
import { MetaMediaService } from '../services/meta-media.service.js';
import { GoogleDriveService } from '../services/google-drive.service.js';
import { AesCryptoService } from '../../../common/crypto/aes.service.js';

@Processor('media-upload')
export class MetaUploadProcessor extends WorkerHost {
  constructor(
    @InjectRepository(MediaUploadLog)
    private readonly logsRepo: Repository<MediaUploadLog>,
    private readonly meta: MetaMediaService,
    private readonly drive: GoogleDriveService,
    private readonly crypto: AesCryptoService,
  ) {
    super();
  }

  async process(job: Job<MetaUploadJobPayload>): Promise<void> {
    const { logId, driveFileId, adAccountId, encryptedAccessToken, mimeType, mediaName } = job.data;
    const accessToken = this.crypto.decrypt(encryptedAccessToken);
    const tempPath = path.join(os.tmpdir(), `meta-upload-${job.id}`);

    try {
      await this.drive.download(driveFileId, tempPath);
      const metaAssetId = await this.meta.upload(adAccountId, accessToken, tempPath, mediaName, mimeType);
      await this.logsRepo.update(logId, {
        status: MediaUploadStatus.SUCCESS,
        metaAssetId,
        errorMessage: null,
      });
    } catch (err) {
      await this.logsRepo.update(logId, {
        status: MediaUploadStatus.FAILED,
        errorMessage: String(err),
      });
    } finally {
      fs.unlink(tempPath, () => {});
    }
  }
}
```

- [ ] **Step 5: Run tests and confirm they pass**

```bash
npx jest --testPathPattern=meta-upload.processor.spec
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/media-library/types/meta-upload-job.type.ts \
        src/modules/media-library/processors/meta-upload.processor.ts \
        src/modules/media-library/processors/meta-upload.processor.spec.ts
git commit -m "feat(media-library): add MetaUploadProcessor for async Meta upload via BullMQ"
```

---

### Task 6: Refactor MediaLibraryService

**Files:**
- Modify: `src/modules/media-library/media-library.service.ts`
- Modify: `src/modules/media-library/types/upload-result.type.ts`
- Modify: `src/modules/media-library/media-library.service.spec.ts`

**Interfaces:**
- Consumes: `MediaUploadLog` (Task 2), `MediaUploadStatus` (Task 2), `FileNamerService.generateName` (Task 3), `MetaUploadJobPayload` (Task 5), `InjectQueue('media-upload')` (Task 1), `GoogleDriveService` (Task 4)
- Produces:
  - `upload(dto, file): Promise<UploadInitiatedResult>`
  - `getLogs(clientId, page, limit): Promise<PaginatedLogs>`
  - `retryOne(logId): Promise<{ logId: string; status: MediaUploadStatus }>`
  - `retryFailed(clientId): Promise<{ retried: number }>`

- [ ] **Step 1: Update the result type**

Replace `src/modules/media-library/types/upload-result.type.ts`:

```typescript
import { MediaUploadStatus } from '../enums/media-upload-status.enum.js';
import { MediaUploadLog } from '../entities/media-upload-log.entity.js';

export interface UploadInitiatedResult {
  logId: string;
  mediaName: string;
  driveUrl: string;
  status: MediaUploadStatus;
}

export interface PaginatedLogs {
  data: MediaUploadLog[];
  total: number;
  page: number;
  limit: number;
}
```

- [ ] **Step 2: Write the failing service tests**

Replace `src/modules/media-library/media-library.service.spec.ts` entirely:

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { MediaLibraryService } from './media-library.service.js';
import { MediaUploadLog } from './entities/media-upload-log.entity.js';
import { MediaUploadStatus } from './enums/media-upload-status.enum.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { FileNamerService } from './services/file-namer.service.js';
import { GoogleDriveService } from './services/google-drive.service.js';
import { MediaIntention } from './dto/upload-media.dto.js';

const MOCK_AD_ACCOUNT = { id: 'aa-1', clientId: 'client-1', adAccountId: 'act_123', accessToken: 'enc_tok' };
const MOCK_CLIENT = { id: 'client-1', googleDriveFolderUrl: 'https://drive.google.com/drive/folders/folder1' };
const MOCK_FILE = { originalname: 'video.mp4', path: '/tmp/video.mp4', mimetype: 'video/mp4' } as Express.Multer.File;
const DTO = { adAccountId: 'act_123', clientId: 'client-1', intention: MediaIntention.PRD, productName: 'Nike' };

describe('MediaLibraryService', () => {
  let svc: MediaLibraryService;
  let adAccounts: jest.Mocked<AdAccountsService>;
  let clients: jest.Mocked<ClientsService>;
  let drive: jest.Mocked<GoogleDriveService>;
  let fileNamer: jest.Mocked<FileNamerService>;
  let logsRepo: { save: jest.Mock; findAndCount: jest.Mock; find: jest.Mock; update: jest.Mock; findOneOrFail: jest.Mock };
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    logsRepo = {
      save: jest.fn(),
      findAndCount: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
      findOneOrFail: jest.fn(),
    };
    queue = { add: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        MediaLibraryService,
        { provide: AdAccountsService, useValue: { findByAdAccountId: jest.fn() } },
        { provide: ClientsService, useValue: { findOne: jest.fn() } },
        { provide: AesCryptoService, useValue: { decrypt: jest.fn() } },
        { provide: FileNamerService, useValue: { generateName: jest.fn() } },
        { provide: GoogleDriveService, useValue: { upload: jest.fn() } },
        { provide: getRepositoryToken(MediaUploadLog), useValue: logsRepo },
        { provide: getQueueToken('media-upload'), useValue: queue },
      ],
    }).compile();

    svc = module.get(MediaLibraryService);
    adAccounts = module.get(AdAccountsService) as jest.Mocked<AdAccountsService>;
    clients = module.get(ClientsService) as jest.Mocked<ClientsService>;
    drive = module.get(GoogleDriveService) as jest.Mocked<GoogleDriveService>;
    fileNamer = module.get(FileNamerService) as jest.Mocked<FileNamerService>;
  });

  afterEach(() => jest.clearAllMocks());

  describe('upload', () => {
    beforeEach(() => {
      adAccounts.findByAdAccountId.mockResolvedValue(MOCK_AD_ACCOUNT as any);
      clients.findOne.mockResolvedValue(MOCK_CLIENT as any);
      fileNamer.generateName.mockResolvedValue('PRD - VID - Nike - Ago 26 - V1.mp4');
      drive.upload.mockResolvedValue({ fileId: 'drv-1', webViewLink: 'https://drive.google.com/file/d/drv-1' });
      logsRepo.save.mockResolvedValue({ id: 'log-uuid', status: MediaUploadStatus.PROCESSING });
    });

    it('returns logId, mediaName, driveUrl and status PROCESSING', async () => {
      const result = await svc.upload(DTO, MOCK_FILE);
      expect(result).toEqual({
        logId: 'log-uuid',
        mediaName: 'PRD - VID - Nike - Ago 26 - V1.mp4',
        driveUrl: 'https://drive.google.com/file/d/drv-1',
        status: MediaUploadStatus.PROCESSING,
      });
    });

    it('enqueues a meta-upload job with driveFileId and encryptedAccessToken', async () => {
      await svc.upload(DTO, MOCK_FILE);
      expect(queue.add).toHaveBeenCalledWith(
        'meta-upload',
        expect.objectContaining({
          driveFileId: 'drv-1',
          encryptedAccessToken: 'enc_tok',
          adAccountId: 'act_123',
        }),
        { attempts: 1 },
      );
    });

    it('throws 422 when client has no Drive folder', async () => {
      clients.findOne.mockResolvedValue({ ...MOCK_CLIENT, googleDriveFolderUrl: null } as any);
      await expect(svc.upload(DTO, MOCK_FILE)).rejects.toThrow(UnprocessableEntityException);
    });

    it('propagates Drive upload error without creating a log', async () => {
      drive.upload.mockRejectedValue(new Error('quota exceeded'));
      await expect(svc.upload(DTO, MOCK_FILE)).rejects.toThrow('quota exceeded');
      expect(logsRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getLogs', () => {
    it('returns paginated logs ordered by createdAt DESC', async () => {
      const mockLog = { id: 'log-1', status: MediaUploadStatus.SUCCESS };
      logsRepo.findAndCount.mockResolvedValue([[mockLog], 1]);
      const result = await svc.getLogs('client-1', 1, 20);
      expect(result).toEqual({ data: [mockLog], total: 1, page: 1, limit: 20 });
    });
  });

  describe('retryOne', () => {
    it('throws 400 when log status is not FAILED', async () => {
      logsRepo.findOneOrFail.mockResolvedValue({ id: 'log-1', status: MediaUploadStatus.PROCESSING });
      await expect(svc.retryOne('log-1')).rejects.toThrow(BadRequestException);
    });

    it('updates log to PROCESSING, increments attemptCount, and enqueues job', async () => {
      const failedLog = {
        id: 'log-1',
        status: MediaUploadStatus.FAILED,
        attemptCount: 1,
        adAccountId: 'act_123',
        driveFileId: 'drv-1',
        mimeType: 'video/mp4',
        mediaName: 'PRD - VID - Nike - Ago 26.mp4',
      };
      logsRepo.findOneOrFail.mockResolvedValue(failedLog);
      adAccounts.findByAdAccountId.mockResolvedValue(MOCK_AD_ACCOUNT as any);
      logsRepo.update.mockResolvedValue(undefined);

      const result = await svc.retryOne('log-1');

      expect(logsRepo.update).toHaveBeenCalledWith('log-1', {
        status: MediaUploadStatus.PROCESSING,
        errorMessage: null,
        attemptCount: 2,
      });
      expect(queue.add).toHaveBeenCalledWith(
        'meta-upload',
        expect.objectContaining({ logId: 'log-1', driveFileId: 'drv-1' }),
        { attempts: 1 },
      );
      expect(result).toEqual({ logId: 'log-1', status: MediaUploadStatus.PROCESSING });
    });
  });

  describe('retryFailed', () => {
    it('returns retried: 0 when no failed logs exist', async () => {
      logsRepo.find.mockResolvedValue([]);
      const result = await svc.retryFailed('client-1');
      expect(result).toEqual({ retried: 0 });
    });

    it('retries all failed logs and returns count', async () => {
      const failedLogs = [
        { id: 'log-1', status: MediaUploadStatus.FAILED, attemptCount: 0, adAccountId: 'act_123', driveFileId: 'drv-1', mimeType: 'video/mp4', mediaName: 'PRD - VID - Nike - Ago 26 - V1.mp4' },
        { id: 'log-2', status: MediaUploadStatus.FAILED, attemptCount: 0, adAccountId: 'act_123', driveFileId: 'drv-2', mimeType: 'image/jpeg', mediaName: 'PRD - IMG - Nike - Ago 26.jpg' },
      ];
      logsRepo.find.mockResolvedValue(failedLogs);
      logsRepo.findOneOrFail.mockImplementation(({ where: { id } }) =>
        Promise.resolve(failedLogs.find(l => l.id === id) as any),
      );
      adAccounts.findByAdAccountId.mockResolvedValue(MOCK_AD_ACCOUNT as any);
      logsRepo.update.mockResolvedValue(undefined);

      const result = await svc.retryFailed('client-1');
      expect(result).toEqual({ retried: 2 });
      expect(queue.add).toHaveBeenCalledTimes(2);
    });
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx jest --testPathPattern=media-library.service.spec
```

Expected: FAIL — methods don't match new signatures yet.

- [ ] **Step 4: Implement the refactored MediaLibraryService**

Replace `src/modules/media-library/media-library.service.ts` entirely:

```typescript
import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as fs from 'fs';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { FileNamerService } from './services/file-namer.service.js';
import { GoogleDriveService } from './services/google-drive.service.js';
import { UploadMediaDto } from './dto/upload-media.dto.js';
import { MediaUploadLog } from './entities/media-upload-log.entity.js';
import { MediaUploadStatus } from './enums/media-upload-status.enum.js';
import { MetaUploadJobPayload } from './types/meta-upload-job.type.js';
import { PaginatedLogs, UploadInitiatedResult } from './types/upload-result.type.js';

@Injectable()
export class MediaLibraryService {
  constructor(
    private readonly adAccounts: AdAccountsService,
    private readonly clients: ClientsService,
    private readonly crypto: AesCryptoService,
    private readonly fileNamer: FileNamerService,
    private readonly drive: GoogleDriveService,
    @InjectRepository(MediaUploadLog)
    private readonly logsRepo: Repository<MediaUploadLog>,
    @InjectQueue('media-upload')
    private readonly queue: Queue,
  ) {}

  async upload(dto: UploadMediaDto, file: Express.Multer.File): Promise<UploadInitiatedResult> {
    const [adAccount, client] = await Promise.all([
      this.adAccounts.findByAdAccountId(dto.adAccountId),
      this.clients.findOne(dto.clientId),
    ]);

    if (!client.googleDriveFolderUrl) {
      throw new UnprocessableEntityException(
        `Client ${dto.clientId} has no Google Drive folder configured`,
      );
    }

    const mediaName = await this.fileNamer.generateName(
      file,
      dto.intention,
      dto.productName,
      dto.clientId,
      new Date(),
      dto.startVersion,
    );

    const { fileId: driveFileId, webViewLink: driveUrl } = await this.drive.upload(
      client.googleDriveFolderUrl,
      file.path,
      mediaName,
      file.mimetype,
    );

    fs.unlink(file.path, () => {});

    const log = await this.logsRepo.save({
      clientId: dto.clientId,
      adAccountId: dto.adAccountId,
      mediaName,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      status: MediaUploadStatus.PROCESSING,
      driveFileId,
      driveUrl,
      metaAssetId: null,
      errorMessage: null,
      attemptCount: 0,
    });

    const payload: MetaUploadJobPayload = {
      logId: log.id,
      driveFileId,
      adAccountId: dto.adAccountId,
      encryptedAccessToken: adAccount.accessToken,
      mimeType: file.mimetype,
      mediaName,
    };

    await this.queue.add('meta-upload', payload, { attempts: 1 });

    return { logId: log.id, mediaName, driveUrl, status: MediaUploadStatus.PROCESSING };
  }

  async getLogs(clientId: string, page: number, limit: number): Promise<PaginatedLogs> {
    const [data, total] = await this.logsRepo.findAndCount({
      where: { clientId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  async retryOne(logId: string): Promise<{ logId: string; status: MediaUploadStatus }> {
    const log = await this.logsRepo.findOneOrFail({ where: { id: logId } });

    if (log.status !== MediaUploadStatus.FAILED) {
      throw new BadRequestException(`Log ${logId} is not in FAILED status`);
    }

    const adAccount = await this.adAccounts.findByAdAccountId(log.adAccountId);

    await this.logsRepo.update(logId, {
      status: MediaUploadStatus.PROCESSING,
      errorMessage: null,
      attemptCount: log.attemptCount + 1,
    });

    const payload: MetaUploadJobPayload = {
      logId: log.id,
      driveFileId: log.driveFileId,
      adAccountId: log.adAccountId,
      encryptedAccessToken: adAccount.accessToken,
      mimeType: log.mimeType,
      mediaName: log.mediaName,
    };

    await this.queue.add('meta-upload', payload, { attempts: 1 });

    return { logId, status: MediaUploadStatus.PROCESSING };
  }

  async retryFailed(clientId: string): Promise<{ retried: number }> {
    const failedLogs = await this.logsRepo.find({
      where: { clientId, status: MediaUploadStatus.FAILED },
    });

    if (failedLogs.length === 0) return { retried: 0 };

    await Promise.all(failedLogs.map(log => this.retryOne(log.id)));
    return { retried: failedLogs.length };
  }
}
```

- [ ] **Step 5: Run tests and confirm they pass**

```bash
npx jest --testPathPattern=media-library.service.spec
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/media-library/media-library.service.ts \
        src/modules/media-library/media-library.service.spec.ts \
        src/modules/media-library/types/upload-result.type.ts
git commit -m "feat(media-library): refactor service to single-file upload with async Meta queue and retry"
```

---

### Task 7: DTOs + Controller refactor + Module update

**Files:**
- Create: `src/modules/media-library/dto/get-logs-query.dto.ts`
- Create: `src/modules/media-library/dto/retry-failed.dto.ts`
- Modify: `src/modules/media-library/media-library.controller.ts`
- Modify: `src/modules/media-library/media-library.module.ts`

**Interfaces:**
- Consumes: all prior tasks
- Produces: public REST API with 4 endpoints

- [ ] **Step 1: Create GetLogsQueryDto**

`src/modules/media-library/dto/get-logs-query.dto.ts`:

```typescript
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class GetLogsQueryDto {
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
```

- [ ] **Step 2: Create RetryFailedDto**

`src/modules/media-library/dto/retry-failed.dto.ts`:

```typescript
import { IsNotEmpty, IsString } from 'class-validator';

export class RetryFailedDto {
  @IsString()
  @IsNotEmpty()
  clientId: string;
}
```

- [ ] **Step 3: Replace the controller**

Replace `src/modules/media-library/media-library.controller.ts` entirely:

```typescript
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as os from 'os';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { MediaLibraryService } from './media-library.service.js';
import { UploadMediaDto } from './dto/upload-media.dto.js';
import { GetLogsQueryDto } from './dto/get-logs-query.dto.js';
import { RetryFailedDto } from './dto/retry-failed.dto.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';

const ACCEPTED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
]);

const MAX_FILE_SIZE_BYTES = (parseInt(process.env.MAX_FILE_SIZE_MB ?? '500', 10)) * 1024 * 1024;

@ApiTags('media-library')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(AuthGuard)
@Controller('media-library')
export class MediaLibraryController {
  constructor(
    private readonly service: MediaLibraryService,
    private readonly adAccounts: AdAccountsService,
  ) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload one media file to Google Drive and queue Meta Ads upload' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: os.tmpdir(),
        filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
      }),
      fileFilter: (_req, file, cb) => {
        if (ACCEPTED_MIMES.has(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error(`Unsupported MIME type: ${file.mimetype}`), false);
        }
      },
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  async upload(
    @Body() dto: UploadMediaDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const adAccount = await this.adAccounts.findByAdAccountId(dto.adAccountId);
    if (adAccount.clientId !== dto.clientId) {
      throw new ForbiddenException('Ad account does not belong to the specified client');
    }
    return this.service.upload(dto, file);
  }

  @Get('logs')
  @ApiOperation({ summary: 'List upload history for a client' })
  async getLogs(@Query() query: GetLogsQueryDto) {
    return this.service.getLogs(query.clientId, query.page, query.limit);
  }

  // NOTE: this route must be declared BEFORE logs/:id/retry to avoid
  // 'retry-failed' being matched as the :id param
  @Post('logs/retry-failed')
  @ApiOperation({ summary: 'Re-enqueue all failed uploads for a client' })
  async retryFailed(@Body() dto: RetryFailedDto) {
    return this.service.retryFailed(dto.clientId);
  }

  @Post('logs/:id/retry')
  @ApiOperation({ summary: 'Re-enqueue a single failed upload' })
  async retryOne(@Param('id') id: string) {
    return this.service.retryOne(id);
  }
}
```

- [ ] **Step 4: Update MediaLibraryModule**

Replace `src/modules/media-library/media-library.module.ts` entirely:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AdAccountsModule } from '../ad-accounts/ad-accounts.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { CryptoModule } from '../../common/crypto/crypto.module.js';
import { MediaLibraryController } from './media-library.controller.js';
import { MediaLibraryService } from './media-library.service.js';
import { FileNamerService } from './services/file-namer.service.js';
import { GoogleDriveService } from './services/google-drive.service.js';
import { MetaMediaService } from './services/meta-media.service.js';
import { MetaUploadProcessor } from './processors/meta-upload.processor.js';
import { MediaUploadLog } from './entities/media-upload-log.entity.js';

@Module({
  imports: [
    AdAccountsModule,
    ClientsModule,
    CryptoModule,
    TypeOrmModule.forFeature([MediaUploadLog]),
    BullModule.registerQueue({ name: 'media-upload' }),
  ],
  controllers: [MediaLibraryController],
  providers: [MediaLibraryService, FileNamerService, GoogleDriveService, MetaMediaService, MetaUploadProcessor],
})
export class MediaLibraryModule {}
```

- [ ] **Step 5: Run the full test suite**

```bash
npm run test
```

Expected: all tests PASS.

- [ ] **Step 6: Build to catch any remaining type errors**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/media-library/dto/get-logs-query.dto.ts \
        src/modules/media-library/dto/retry-failed.dto.ts \
        src/modules/media-library/media-library.controller.ts \
        src/modules/media-library/media-library.module.ts
git commit -m "feat(media-library): add history and retry endpoints, wire BullMQ queue in module"
```
