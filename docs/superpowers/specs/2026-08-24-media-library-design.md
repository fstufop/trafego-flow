# Design Spec: Media Library Upload

**Data:** 2026-08-24  
**Status:** Aprovado para implementação

## Contexto

O fluxo atual usa um projeto separado (`upload-midias`) para salvar criativos renomeados no Google Drive. Depois, o gestor de tráfego faz upload manual para a biblioteca de mídias de cada cliente no Meta Ads Manager. Este spec define a migração desse fluxo para o trafegoflow, automatizando o envio para o Meta.

**Fase atual:** Google Drive como arquivo permanente + Meta como destino de publicação (uploads em paralelo).  
**Fase futura:** remoção do Google Drive — o design isola essa dependência para facilitar.

---

## Escopo

- Novo módulo `media-library` no backend NestJS (`trafegoflow`)
- Nova página `/media-library` no frontend Next.js (`trafegoflow-dashboard`)
- Destino Meta: biblioteca criativa da conta de anúncios (`/{ad-account-id}/adimages` e `/{ad-account-id}/advideos`)
- Destino Drive: pasta do cliente (`ClientEntity.googleDriveFolderUrl`)
- Upload disparado pelo gestor de tráfego no dashboard (não pelo cliente final)

Fora de escopo: refresh automático de tokens Meta, tela de listagem de mídias já enviadas, integração com Meta Page media library.

---

## Arquitetura e Fluxo de Dados

```
trafegoflow-dashboard (Next.js)          trafegoflow (NestJS)
─────────────────────────────            ──────────────────────────────────────────
                                         media-library module
 [Upload Page]                           ┌─────────────────────────────────────┐
   1. Seleciona cliente                  │ POST /media-library/upload          │
   2. Seleciona ad account    ──────────▶│   multer (disk storage)             │
   3. Preenche metadados                 │   FileNamerService (naming conv.)   │
      (intenção, produto)                │                                     │
   4. Seleciona arquivos                 │   Promise.allSettled([              │
   5. Submit                            │     GoogleDriveService.upload(),    │
                                         │     MetaMediaService.upload()       │
 [Status / Result]           ◀──────────│   ]) por arquivo                    │
   - Link do Drive                       │                                     │
   - Meta asset ID                       │   deleta temporário ao final        │
   - erros por destino                   └─────────────────────────────────────┘
                                                    │              │
                                         Google Drive API    Meta Graph API
                                         (client folder)    /{ad-account-id}
                                                            /adimages ou /advideos
```

**Credenciais:**
- Drive: service account via env vars `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`
- Meta: `AdAccountEntity.accessToken` descriptografado via `CryptoService` existente

---

## Estrutura do Módulo NestJS

```
src/modules/media-library/
├── media-library.module.ts
├── media-library.controller.ts       # POST /media-library/upload
├── media-library.service.ts          # orquestração (Drive + Meta em paralelo)
├── dto/
│   └── upload-media.dto.ts           # adAccountId, clientId, intention, productName
├── services/
│   ├── file-namer.service.ts         # convenção de nomenclatura (portada do upload-midias)
│   ├── google-drive.service.ts       # upload para pasta do cliente no Drive
│   └── meta-media.service.ts         # POST para /adimages ou /advideos
└── types/
    └── upload-result.type.ts         # { fileName, driveFileId?, driveUrl?, metaAssetId?, errors[] }
```

**Dependências novas:**
- `googleapis` — Google Drive API v3
- `multer` + `@types/multer` — disk storage para arquivos grandes
- `@nestjs/platform-express` — já incluso no NestJS, habilita multer

**Integrações com módulos existentes:**
- `AdAccountsModule` — buscar conta e descriptografar token Meta
- `ClientsModule` — buscar `googleDriveFolderUrl` do cliente

### Responsabilidades por peça

**`MediaLibraryController`**
- Recebe `multipart/form-data` com os arquivos e o DTO
- Valida que `adAccountId` pertence ao `clientId` (prevenção de IDOR)
- Deleta arquivos temporários do disk após processamento (em `finally`)

**`MediaLibraryService`**
- Para cada arquivo: chama `FileNamerService` → `Promise.allSettled([Drive, Meta])`
- Retorna array de `UploadResult` — erros parciais não bloqueiam outros arquivos

**`FileNamerService`**
- Porta a lógica do `fileNamer.ts` do upload-midias
- Formato: `[INTENÇÃO] - [TIPO_MIDIA] - [NOME_PRODUTO] - [DATA].[ext]`
- `INTENÇÃO`: `PRD` ou `CAP`
- `TIPO_MIDIA`: detectado por extensão — `VID` para `.mp4 .mov .avi .mkv .webm`, `IMG` para `.jpg .png .webp`
- `DATA`: mês PT-BR abreviado + 2 dígitos do ano (ex: `Ago 26`)
- Batch: adiciona ` - V1`, ` - V2` etc. quando múltiplos arquivos têm mesmo nome base

**`GoogleDriveService`**
- Autentica com service account OAuth2
- Extrai `folderId` da `googleDriveFolderUrl` da `ClientEntity`
- Upload resumable para suportar vídeos grandes

**`MetaMediaService`**
- Imagens: `POST /{ad-account-id}/adimages` (multipart/form-data)
- Vídeos: `POST /{ad-account-id}/advideos` (multipart/form-data, suporta até 1GB)
- Retorna `hash` (imagens) ou `video_id` (vídeos) como `metaAssetId`

---

## Interface do Dashboard

**Rota:** `/media-library` (top-level — gestor frequentemente alterna entre clientes)

**Fluxo em 3 seções:**

```
┌─────────────────────────────────────────────────────┐
│  1. CONTEXTO                                        │
│  [ Cliente ▼ ]  [ Conta de anúncios ▼ ]            │
│   (dropdown)     (carrega após selecionar cliente)   │
├─────────────────────────────────────────────────────┤
│  2. METADADOS DO CRIATIVO                           │
│  Intenção:  ○ PRD — Produto  ○ CAP — Captação       │
│  Produto:   [________________________]              │
├─────────────────────────────────────────────────────┤
│  3. ARQUIVOS                                        │
│  ┌───────────────────────────────────────────────┐  │
│  │  Arraste imagens e vídeos aqui                │  │
│  │  .jpg .png .webp .mp4 .mov                    │  │
│  └───────────────────────────────────────────────┘  │
│  arquivo1.mp4  →  [PRD] - [VID] - Produto - Ago 26  │
│  arquivo2.jpg  →  [PRD] - [IMG] - Produto - Ago 26  │
│                                                     │
│              [ Fazer Upload ]                       │
└─────────────────────────────────────────────────────┘
```

**Durante upload** — status por arquivo com dois indicadores (Drive e Meta) via polling ou response streaming.

**Resultado** — tabela por arquivo com status individual:
- `✓ Drive` / `✗ Drive — mensagem de erro`
- `✓ Meta (asset: 123456789)` / `✗ Meta — token expirado`

**Componentes novos (shadcn/ui):**
- `MediaUploadForm` — formulário completo com React Hook Form
- `FileDropzone` — área de drag & drop com preview de nome gerado
- `UploadProgressCard` — status por arquivo durante upload
- `UploadResultTable` — resultado final

---

## Tratamento de Erros

### Validações no controller (antes de qualquer upload)

| Validação | Comportamento em falha |
|---|---|
| `adAccountId` pertence ao `clientId` | HTTP 403 |
| `intention` é `PRD` ou `CAP` | HTTP 400 |
| `productName` não vazio, max 100 chars | HTTP 400 |
| MIME type aceito | Rejeitado pelo multer antes de processar |
| Tamanho máximo (env `MAX_FILE_SIZE_MB`, default 500MB) | Rejeitado pelo multer |
| `googleDriveFolderUrl` configurado no cliente | HTTP 422 com mensagem clara |

**MIME types aceitos:** `image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `video/quicktime`

### Erros em runtime

- **Batch com erro parcial:** `Promise.allSettled` por arquivo — falha de um não bloqueia os outros
- **Drive ok + Meta falha:** retorna resultado parcial; gestor vê qual destino falhou
- **Token Meta expirado:** erro descritivo no resultado; sem retry automático (refresh é manual)
- **Nomes duplicados no Drive:** Drive cria duplicata por padrão (mesmo comportamento do upload-midias)
- **Arquivo temporário não deletado:** `finally` no controller garante deleção; path de disk storage configurável via env

---

## Testes

### Unitários (um `.spec.ts` por service)

| Service | Casos cobertos |
|---|---|
| `FileNamerService` | formato correto PRD/CAP, detecção VID/IMG por extensão, versionamento V1/V2 batch, sanitização de acentos e caracteres especiais |
| `MetaMediaService` | endpoint `/adimages` para imagem, `/advideos` para vídeo, propagação de erro HTTP do Meta |
| `GoogleDriveService` | extração correta de `folderId` da URL, montagem do request de upload |
| `MediaLibraryService` | resultado parcial (Drive ok + Meta falha), IDOR — ad account de outro cliente rejeitado |

**Estratégia de mock:** services de Drive e Meta mockados via `jest.fn()`; lógica de negócio testada pura, sem banco.

### E2E

Fora de escopo para CI. Validação manual com conta de teste no Meta Ads Manager.

---

## Variáveis de Ambiente Novas

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_DRIVE_ROOT_FOLDER_ID=   # raiz; cada cliente usa seu folderId extraído da clientEntity
MAX_FILE_SIZE_MB=500
```

---

## Dependências Externas

| API | Autenticação | Limite relevante |
|---|---|---|
| Google Drive API v3 | Service Account OAuth2 | Upload resumable para arquivos grandes |
| Meta Graph API v21.0 | Ad Account access token (já no AdAccountEntity) | Vídeos até 1GB via multipart |
