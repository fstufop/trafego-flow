# Media Upload Async + History — Design Spec

**Date:** 2026-08-25
**Status:** Approved

---

## Context

The current `POST /media-library/upload` endpoint accepts multiple files, uploads them synchronously to Google Drive and Meta Ads Manager in parallel, and blocks the HTTP response until all uploads complete. This causes timeouts for large videos, provides no upload history, and has no retry mechanism.

## Goals

1. Track every upload attempt with status, names, and timestamps persisted in the database.
2. Make Meta uploads asynchronous — the HTTP response returns once the Drive upload is done.
3. Allow retrying failed Meta uploads individually or in bulk.
4. Switch from batch (N files per request) to one file per request so the frontend can track progress per file independently.

---

## Architecture

### Upload Flow

```
POST /media-library/upload  (1 file per request)
  │
  ├─ Validate MIME, size, clientId vs adAccountId
  ├─ FileNamerService.generateName() → query DB for existing names today → auto-version if needed
  ├─ GoogleDriveService.upload() → sync, awaits Drive confirmation → { driveFileId, driveUrl }
  ├─ MediaUploadLog.save({ status: PROCESSING, driveFileId, driveUrl, mediaName, originalFileName, ... })
  ├─ BullMQ.add('meta-upload', { logId, filePath, adAccountId, encryptedAccessToken })
  └─ return 201 { logId, mediaName, driveUrl, status: "processing" }

  ↓ background (BullMQ worker)

MetaUploadProcessor
  ├─ Decrypt access token
  ├─ MetaMediaService.upload(filePath, ...)
  ├─ On success → update log { status: SUCCESS, metaAssetId }
  ├─ On failure → update log { status: FAILED, errorMessage }
  └─ fs.unlink(filePath) — temp file deleted only after worker finishes
```

**Key invariants:**
- The controller's `finally` block does **not** delete the temp file — that responsibility moves to the worker.
- If the Drive upload fails in the request, no log is created and a standard HTTP error is returned.
- The BullMQ job payload carries the access token **encrypted** (same ciphertext from the database); the worker decrypts it before use.
- Retry jobs download the file from Google Drive (via `driveFileId`) instead of relying on the temp file, which may no longer exist.

---

## Data Model

### `MediaUploadLog` entity

| Column             | Type                     | Notes                                      |
|--------------------|--------------------------|--------------------------------------------|
| `id`               | UUID (PK)                | From `BaseEntity`                          |
| `clientId`         | string                   |                                            |
| `adAccountId`      | string                   |                                            |
| `mediaName`        | string                   | Generated name (ex: `PRD - VID - Nike - Ago 26 - V1.mp4`) |
| `originalFileName` | string                   | Original filename from user (ex: `IMG_4247.MOV`) |
| `mimeType`         | string                   |                                            |
| `status`           | enum (see below)         |                                            |
| `driveFileId`      | string                   | Set at request time (Drive always succeeds before log is created) |
| `driveUrl`         | string                   | Shareable Drive link                       |
| `metaAssetId`      | string \| null           | Set by worker on success                   |
| `errorMessage`     | string \| null           | Last Meta error message                    |
| `attemptCount`     | integer (default 0)      | Incremented on each retry                  |
| `createdAt`        | timestamp                | From `BaseEntity`                          |
| `updatedAt`        | timestamp                | From `BaseEntity`                          |

### Status enum: `MediaUploadStatus`

| Value        | Meaning                                              |
|--------------|------------------------------------------------------|
| `processing` | Drive done, Meta upload enqueued or in progress      |
| `success`    | Meta upload confirmed                                |
| `failed`     | Meta upload failed; eligible for retry               |

---

## API Endpoints

### `POST /media-library/upload`

Accepts one file per request (multipart/form-data).

**Request body (form fields):**
- `adAccountId` — Meta ad account ID
- `clientId` — trafegoflow client ID
- `intention` — `PRD` | `CAP`
- `productName` — max 100 chars
- `startVersion?` — optional version override
- `files` — single file (JPEG, PNG, WebP, MP4, QuickTime; max 500 MB)

**Response `201`:**
```json
{
  "logId": "uuid",
  "mediaName": "PRD - VID - Nike - Ago 26 - V1.mp4",
  "driveUrl": "https://drive.google.com/...",
  "status": "processing"
}
```

---

### `GET /media-library/logs`

Returns paginated upload history for a client.

**Query params:** `clientId` (required), `page` (default 1), `limit` (default 20).

**Response `200`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "mediaName": "PRD - VID - Nike - Ago 26 - V1.mp4",
      "originalFileName": "IMG_4247.MOV",
      "status": "processing" | "success" | "failed",
      "driveUrl": "https://drive.google.com/...",
      "metaAssetId": "123456789",
      "errorMessage": null,
      "attemptCount": 1,
      "createdAt": "2026-08-25T14:30:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

---

### `POST /media-library/logs/:id/retry`

Re-enqueues a single failed upload for Meta retry.

- Returns `400` if status is not `FAILED`.
- The **service layer** (not the worker) downloads the file from Drive via `driveFileId` to a fresh temp path, then enqueues the job with that path.
- This keeps the worker simple: it always receives a valid `filePath` regardless of whether it's a first attempt or a retry.
- Sets `status → PROCESSING`, increments `attemptCount`.

**Response `200`:**
```json
{ "logId": "uuid", "status": "processing" }
```

---

### `POST /media-library/logs/retry-failed`

Re-enqueues all logs with `status = FAILED` for a given `clientId`.

Same download-then-enqueue logic as the individual retry, applied to all failed logs in a single call.

**Request body:** `{ "clientId": "..." }`

**Response `200`:**
```json
{ "retried": 5 }
```

---

## Queue Infrastructure

- **Package:** `@nestjs/bullmq` + `bullmq` (Redis already configured via `redis.config.ts`)
- **Queue name:** `media-upload`
- **Job name:** `meta-upload`
- **Job payload:** `{ logId, filePath, adAccountId, encryptedAccessToken }`
- **Retry policy:** 3 automatic attempts with exponential backoff before marking as `FAILED`
- **Worker:** `MetaUploadProcessor` (`@Processor('media-upload')`) — handles the Meta upload and log update

---

## FileNamer Changes

`FileNamerService.generateName()` (singular, replaces `generateNames()` batch) receives the single file and queries the `MediaUploadLog` table:

- Counts existing logs for the same `clientId` + `intention` + `productName` + current date
- If count > 0 (or `startVersion` set), appends `-V{n}` to the name
- This replaces the current in-memory duplicate detection across a batch

---

## Files to Create / Modify

| Path | Action |
|------|--------|
| `src/modules/media-library/entities/media-upload-log.entity.ts` | Create |
| `src/modules/media-library/enums/media-upload-status.enum.ts` | Create |
| `src/modules/media-library/processors/meta-upload.processor.ts` | Create |
| `src/modules/media-library/dto/retry-failed.dto.ts` | Create |
| `src/database/migrations/XXXX-CreateMediaUploadLogsTable.ts` | Create |
| `src/modules/media-library/media-library.service.ts` | Modify (Drive sync + enqueue) |
| `src/modules/media-library/media-library.controller.ts` | Modify (single file, new endpoints) |
| `src/modules/media-library/media-library.module.ts` | Modify (BullMQ, TypeORM entity) |
| `src/modules/media-library/services/file-namer.service.ts` | Modify (DB lookup for versioning) |
| `src/modules/media-library/services/google-drive.service.ts` | Modify (add `download(fileId)` method for retry flow) |
| `src/app.module.ts` | Modify (BullMQ global registration) |
| `package.json` | Add `@nestjs/bullmq`, `bullmq` |
