# Media Upload Dashboard — Design Spec

**Date:** 2026-08-25
**Status:** Approved

---

## Context

The async upload pipeline (`POST /media-library/upload`) now returns immediately with a `logId` and queues the Meta upload via BullMQ. Traffic managers need visibility into every upload's outcome — whether it succeeded, is still processing, or failed — and the ability to retry failures individually or in bulk.

The existing dashboard (`trafegoflow-dashboard`) has a `/media-library` page with the upload form but no history view. This spec adds a **history section** below the upload form and the minimal backend filter extension it requires.

This spec also covers a **prerequisite fix** to the existing upload hook (`use-media-upload.ts`), which still targets the old batch API.

---

## Goals

1. Show upload history per client with status, names, Drive link, error detail, and attempt count.
2. Filter by status, date range, and media name — server-side, so it works at any scale.
3. Allow retrying failed uploads individually or all at once for the selected client.
4. Fix the upload hook to match the new single-file async API.

---

## Repositories

| Repo | Path | Changes |
|------|------|---------|
| `trafegoflow` | Backend NestJS API | `GetLogsQueryDto` + `MediaLibraryService.getLogs()` |
| `trafegoflow-dashboard` | Next.js 15 frontend | Types, hooks, components, page update |

---

## Architecture

### Data flow

```
User selects client
  → UploadHistorySection sets clientId
  → useMediaLogs({ clientId, ...filters }) fires
  → GET /api/proxy/media-library/logs?clientId=X&...
  → Next.js proxy → NestJS GET /media-library/logs
  → PaginatedLogs response
  → UploadHistoryTable renders rows

Retry individual (status=failed row)
  → useRetryLog(logId) mutation
  → POST /api/proxy/media-library/logs/:id/retry
  → onSuccess: invalidate ['media-logs'] query

Retry all failed
  → useRetryAllFailed() mutation({ clientId })
  → POST /api/proxy/media-library/logs/retry-failed { clientId }
  → onSuccess: invalidate ['media-logs'] query

Filter change / page change
  → query key changes → TanStack Query refetches automatically
```

---

## Backend Changes (`trafegoflow`)

### 1. `GetLogsQueryDto` — add 4 optional filter fields

File: `src/modules/media-library/dto/get-logs-query.dto.ts`

```typescript
@IsOptional()
@IsEnum(MediaUploadStatus)
status?: MediaUploadStatus;

@IsOptional()
@IsDateString()
startDate?: string;   // ISO 8601 date: "2026-08-01"

@IsOptional()
@IsDateString()
endDate?: string;     // ISO 8601 date: "2026-08-25" (treated as end-of-day UTC)

@IsOptional()
@IsString()
mediaName?: string;   // case-insensitive substring match
```

### 2. `MediaLibraryService.getLogs()` — apply filters in TypeORM query

File: `src/modules/media-library/media-library.service.ts`

Add imports: `ILike`, `Between`, `MoreThanOrEqual`, `LessThanOrEqual` from `typeorm`.

```typescript
async getLogs(
  clientId: string,
  page: number,
  limit: number,
  status?: MediaUploadStatus,
  startDate?: string,
  endDate?: string,
  mediaName?: string,
): Promise<PaginatedLogs> {
  const where: FindOptionsWhere<MediaUploadLog> = { clientId };

  if (status) where.status = status;
  if (mediaName) where.mediaName = ILike(`%${mediaName}%`);
  if (startDate && endDate) {
    where.createdAt = Between(new Date(startDate), new Date(endDate + 'T23:59:59.999Z'));
  } else if (startDate) {
    where.createdAt = MoreThanOrEqual(new Date(startDate));
  } else if (endDate) {
    where.createdAt = LessThanOrEqual(new Date(endDate + 'T23:59:59.999Z'));
  }

  const [data, total] = await this.logsRepo.findAndCount({
    where,
    order: { createdAt: 'DESC' },
    skip: (page - 1) * limit,
    take: limit,
  });
  return { data, total, page, limit };
}
```

### 3. Controller — pass new params through

File: `src/modules/media-library/media-library.controller.ts`

```typescript
@Get('logs')
async getLogs(@Query() query: GetLogsQueryDto) {
  return this.service.getLogs(
    query.clientId,
    query.page,
    query.limit,
    query.status,
    query.startDate,
    query.endDate,
    query.mediaName,
  );
}
```

**No new endpoints.** `GET /media-library/logs` absorbs all filters via query params.

---

## Frontend Changes (`trafegoflow-dashboard`)

### Prerequisite: fix `use-media-upload.ts`

The existing hook uses the old batch API. Must be updated before the history section is useful.

**Old:** sends `files` (plural), expects `UploadResult[]`
**New:** sends one file per call as `file` (singular), expects `{ logId, mediaName, driveUrl, status }`

File: `hooks/use-media-upload.ts`

```typescript
interface UploadPayload {
  clientId: string;
  adAccountId: string;
  intention: MediaIntention;
  productName: string;
  startVersion?: number;
  file: File;   // single file
}

interface UploadInitiatedResult {
  logId: string;
  mediaName: string;
  driveUrl: string;
  status: 'processing';
}

async function uploadMedia(payload: UploadPayload): Promise<UploadInitiatedResult> {
  const form = new FormData();
  form.append('clientId', payload.clientId);
  form.append('adAccountId', payload.adAccountId);
  form.append('intention', payload.intention);
  form.append('productName', payload.productName);
  if (payload.startVersion !== undefined) {
    form.append('startVersion', String(payload.startVersion));
  }
  form.append('file', payload.file);   // singular, matches FileInterceptor('file')

  const res = await fetch('/api/proxy/media-library/upload', {
    method: 'POST',
    body: form,
  });

  if (res.status === 401) throw new Error('UNAUTHORIZED');
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 403) throw new Error('FORBIDDEN');
    if (res.status === 422) throw new Error('NO_DRIVE_FOLDER');
    if (res.status === 413) throw new Error('FILE_TOO_LARGE');
    throw new Error(data?.message ?? `Erro ${res.status}`);
  }
  return data as UploadInitiatedResult;
}

export function useMediaUpload() {
  return useMutation<UploadInitiatedResult, Error, UploadPayload>({
    mutationFn: uploadMedia,
  });
}
```

**Note:** `MediaUploadForm` and `UploadResultTable` must also be updated to work with the new single-file flow and `UploadInitiatedResult` shape. `UploadResultTable` becomes `UploadInitiatedCard` showing `logId`, `mediaName`, `driveUrl`, and a "processing" status indicator that directs the user to the history section below.

---

### New types — `types/media-library.ts`

Add alongside the existing `UploadResult` type (which can be removed once the upload form is updated):

```typescript
export type MediaUploadStatus = 'processing' | 'success' | 'failed';

export interface MediaUploadLog {
  id: string;
  clientId: string;
  adAccountId: string;
  mediaName: string;
  originalFileName: string;
  mimeType: string;
  status: MediaUploadStatus;
  driveFileId: string;
  driveUrl: string;
  metaAssetId: string | null;
  errorMessage: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedLogs {
  data: MediaUploadLog[];
  total: number;
  page: number;
  limit: number;
}

export interface UploadLogsParams {
  clientId: string;
  page?: number;
  limit?: number;
  status?: MediaUploadStatus;
  startDate?: string;
  endDate?: string;
  mediaName?: string;
}
```

---

### New hook — `hooks/use-media-logs.ts`

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { PaginatedLogs, UploadLogsParams } from '@/types/media-library';

export function useMediaLogs(params: UploadLogsParams) {
  const query = new URLSearchParams({
    clientId: params.clientId,
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 20),
    ...(params.status && { status: params.status }),
    ...(params.startDate && { startDate: params.startDate }),
    ...(params.endDate && { endDate: params.endDate }),
    ...(params.mediaName && { mediaName: params.mediaName }),
  });

  return useQuery<PaginatedLogs>({
    queryKey: ['media-logs', params],
    queryFn: () => apiFetch<PaginatedLogs>(`/media-library/logs?${query}`),
    enabled: !!params.clientId,
  });
}

export function useRetryLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (logId: string) =>
      apiFetch(`/media-library/logs/${logId}/retry`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media-logs'] }),
  });
}

export function useRetryAllFailed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) =>
      apiFetch('/media-library/logs/retry-failed', {
        method: 'POST',
        body: JSON.stringify({ clientId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media-logs'] }),
  });
}
```

---

### New components

#### `components/media-library/StatusBadge.tsx`

```typescript
import { Badge } from '@/components/ui/badge';
import type { MediaUploadStatus } from '@/types/media-library';

const config: Record<MediaUploadStatus, { label: string; className: string }> = {
  processing: { label: 'Processando', className: 'text-amber-700 border-amber-300 bg-amber-50' },
  success:    { label: 'Concluído',   className: 'text-green-700 border-green-300 bg-green-50' },
  failed:     { label: 'Falhou',      className: 'text-red-700 border-red-300 bg-red-50' },
};

export function StatusBadge({ status }: { status: MediaUploadStatus }) {
  const { label, className } = config[status];
  return (
    <Badge variant="outline" className={`text-xs ${className}`}>
      {label}
    </Badge>
  );
}
```

#### `components/media-library/UploadHistoryFilters.tsx`

Props: `filters`, `onFiltersChange`, `clients` (from `useClients()`).

Controls (horizontal bar, wraps on mobile):
- **Cliente** — `Select` populated from `useClients()`. Required; nothing displays until selected.
- **Status** — `Select` with options: Todos / Processando / Concluído / Falhou.
- **De / Até** — two `<input type="date">` inputs.
- **Nome da mídia** — text `Input` with 500ms debounce before updating filter state.

#### `components/media-library/UploadHistoryTable.tsx`

Columns: Nome da mídia (truncated, full name in `title` tooltip) | Arquivo original | Drive (external link icon, opens `driveUrl`) | Status (`StatusBadge`) | Tentativas | Ações.

- Rows with `status = failed`: show "Retentar" button (refresh icon + text) in Ações column. On click: calls `useRetryLog(row.id)` → shows loading state on that row.
- Rows with `status = processing`: show spinner in Ações column, no button.
- Rows with `status = success` and `errorMessage`: show "Ver erro" tooltip with the last error message (useful when a log eventually succeeded after manual retry).
- Footer: pagination (← 1 2 3 →) + "Mostrando X–Y de Z" label.

#### `components/media-library/UploadHistorySection.tsx`

Root client component. Owns all filter state. Renders:

```
<section>
  <div> {/* header row */}
    <h2>Histórico de Uploads</h2>
    {clientId && hasFailed && (
      <Button onClick={() => retryAllFailed(clientId)}>
        Retentar com falha ({failedCount})
      </Button>
    )}
  </div>
  <UploadHistoryFilters ... />
  {!clientId && <EmptyState>Selecione um cliente para ver o histórico.</EmptyState>}
  {clientId && <UploadHistoryTable ... />}
</section>
```

`hasFailed` is determined by issuing a separate lightweight query `GET /media-library/logs?clientId=X&status=failed&limit=1` to know whether any failed logs exist — so the "Retentar com falha" button only appears when relevant.

---

### Page update — `app/(dashboard)/media-library/page.tsx`

```typescript
import { MediaUploadForm } from '@/components/media-library/MediaUploadForm';
import { UploadHistorySection } from '@/components/media-library/UploadHistorySection';

export default function MediaLibraryPage() {
  return (
    <div className="space-y-10 max-w-5xl">
      <div>
        <h1 className="font-display text-4xl font-light text-obsidiana">Biblioteca de Mídias</h1>
        <p className="text-sm text-nevoa mt-1">
          Faça upload de imagens e vídeos para o Google Drive e Meta Ads simultaneamente.
        </p>
      </div>

      <MediaUploadForm />

      <hr className="border-nevoa/20" />

      <UploadHistorySection />
    </div>
  );
}
```

---

## Files to Create / Modify

### `trafegoflow` (backend)

| File | Action |
|------|--------|
| `src/modules/media-library/dto/get-logs-query.dto.ts` | Modify — add 4 optional filter fields |
| `src/modules/media-library/media-library.service.ts` | Modify — dynamic WHERE in `getLogs()` |
| `src/modules/media-library/media-library.controller.ts` | Modify — pass new params to service |

### `trafegoflow-dashboard` (frontend)

| File | Action |
|------|--------|
| `hooks/use-media-upload.ts` | Modify — single-file, new response type |
| `components/media-library/MediaUploadForm.tsx` | Modify — adapt to single-file flow |
| `components/media-library/UploadResultTable.tsx` | Replace — becomes `UploadInitiatedCard` |
| `types/media-library.ts` | Modify — add `MediaUploadLog`, `PaginatedLogs`, `UploadLogsParams`, `MediaUploadStatus` |
| `hooks/use-media-logs.ts` | Create |
| `components/media-library/StatusBadge.tsx` | Create |
| `components/media-library/UploadHistoryFilters.tsx` | Create |
| `components/media-library/UploadHistoryTable.tsx` | Create |
| `components/media-library/UploadHistorySection.tsx` | Create |
| `app/(dashboard)/media-library/page.tsx` | Modify — add `UploadHistorySection` |

---

## Error States

| Scenario | Behavior |
|----------|----------|
| Nenhum cliente selecionado | Empty state: "Selecione um cliente para ver o histórico." |
| Query loading | Skeleton rows na tabela |
| Query error | Toast de erro + botão "Tentar novamente" |
| Retry individual falha | Toast de erro; linha volta para `failed` após invalidação |
| Retry-all falha | Toast de erro |
| Nenhum resultado com filtros ativos | Empty state: "Nenhum upload encontrado com esses filtros." |

---

## Non-goals

- Exportar histórico para CSV
- Notificações push/SSE para atualização em tempo real (polling via `refetchInterval` pode ser adicionado depois)
- Paginação por scroll infinito
- Filtro por `adAccountId`
