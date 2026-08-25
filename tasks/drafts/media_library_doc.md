# Documentação: Media Library

**Data:** 2026-08-24
**Tipo:** Módulo Novo
**Arquivos analisados:**
- `src/modules/media-library/media-library.module.ts`
- `src/modules/media-library/media-library.controller.ts`
- `src/modules/media-library/media-library.service.ts`
- `src/modules/media-library/dto/upload-media.dto.ts`
- `src/modules/media-library/types/upload-result.type.ts`
- `src/modules/media-library/services/file-namer.service.ts`
- `src/modules/media-library/services/google-drive.service.ts`
- `src/modules/media-library/services/meta-media.service.ts`
- `src/config/google.config.ts`

---

## Visão Geral

O módulo `media-library` automatiza o envio de criativos (imagens e vídeos) para dois destinos em paralelo: a pasta do cliente no Google Drive e a biblioteca de mídias da conta de anúncios no Meta Ads Manager. Substitui um fluxo manual de upload realizado por gestor de tráfego via um projeto separado (`upload-midias`). O módulo não persiste dados no banco — é stateless e opera exclusivamente como orquestrador de uploads externos.

---

## Contexto de Isolamento por Cliente

- **Dados isolados por cliente:** `adAccountId` (acessa `AdAccountEntity.clientId`), `googleDriveFolderUrl` (campo de `ClientEntity`)
- **Dados globais:** Credenciais Google Drive (service account via env vars) e versão da Graph API
- **Sem tabela própria:** O módulo não tem entity nem repositório; lê de `ad_accounts` e `clients`

---

## Fluxo de Dados

```
multipart/form-data (files + DTO)
    ↓ Guard: AuthGuard (JWT + x-api-key)
    ↓ multer FilesInterceptor — disk storage em os.tmpdir()
    ↓   fileFilter: valida MIME type (rejeita fora da allowlist)
    ↓   limits: MAX_FILE_SIZE_MB × 1024² bytes (default 500 MB)
MediaLibraryController.upload()
    ↓ IDOR check: adAccount.clientId === dto.clientId  ← HTTP 403 se falhar
MediaLibraryService.upload()
    ↓ Promise.all([AdAccountsService.findByAdAccountId(), ClientsService.findOne()])
    ↓   ← AdAccountEntity.accessToken (criptografado)
    ↓   ← ClientEntity.googleDriveFolderUrl
    ↓ guard: googleDriveFolderUrl presente  ← HTTP 422 se ausente
    ↓ AesCryptoService.decrypt(accessToken)  ← token Meta em plaintext
    ↓ FileNamerService.generateNames()  ← nomes canonizados para todos os arquivos
    ↓
    por arquivo (Promise.all):
        Promise.allSettled([
            GoogleDriveService.upload()   → Drive API v3 (stream)
            MetaMediaService.upload()     → Graph API v21.0 (Blob em memória)
        ])
    ↓
    deleta arquivos temporários em finally (controller)
← UploadResult[] — resultado por arquivo com erros parciais
```

---

## Regras de Negócio Identificadas

### RN-01: Validação IDOR no controller
**Onde no código:** `media-library.controller.ts:66`
**Descrição:** Antes de processar qualquer upload, verifica que a `adAccountId` informada no DTO pertence de fato ao `clientId` informado. A busca é feita em `ad_accounts` via `AdAccountsService.findByAdAccountId()` e compara `adAccount.clientId === dto.clientId`.
**Condição:** Sempre que `POST /media-library/upload` é chamado.
**Falha:** HTTP 403 `"Ad account does not belong to the specified client"`.

### RN-02: Cliente sem pasta Drive bloqueia upload inteiro
**Onde no código:** `media-library.service.ts:28`
**Descrição:** Se `ClientEntity.googleDriveFolderUrl` for nulo, o upload é rejeitado antes de qualquer requisição às APIs externas.
**Condição:** Clientes que ainda não tiveram a pasta Drive configurada.
**Falha:** HTTP 422 `"Client {id} has no Google Drive folder configured"`.

### RN-03: Falha parcial não bloqueia os demais arquivos
**Onde no código:** `media-library.service.ts:42` (`Promise.allSettled`)
**Descrição:** Para cada arquivo, Drive e Meta são chamados em paralelo via `Promise.allSettled`. Se um destino falhar (token expirado, quota, erro de rede), o outro ainda é executado. O resultado retornado inclui o campo `errors[]` com destino e mensagem do erro — o gestor vê exatamente qual destino falhou por arquivo.
**Condição:** Qualquer erro em um dos destinos externos.

### RN-04: Convenção de nomenclatura canônica
**Onde no código:** `services/file-namer.service.ts`
**Descrição:** Todos os arquivos são renomeados para o formato `[INTENÇÃO] - [TIPO_MÍDIA] - [PRODUTO] - [MÊS ANO].[ext]` antes de qualquer upload. O nome original do arquivo é descartado. Acentos e caracteres especiais são removidos via NFD + regex. Quando múltiplos arquivos do mesmo batch resultam no mesmo nome base (e.g. dois JPEGs com mesmo produto/intenção), todos recebem sufixo ` - V1`, ` - V2`, etc.
**Condição:** Sempre; não há opção de manter o nome original.

### RN-05: Token Meta descriptografado apenas em memória
**Onde no código:** `media-library.service.ts:34`
**Descrição:** O `accessToken` da `AdAccountEntity` é armazenado criptografado (AES-256-GCM). O plaintext é obtido via `AesCryptoService.decrypt()` e usado diretamente na chamada à Graph API, nunca persistido ou logado.
**Condição:** Toda requisição de upload que envolve Meta.

### RN-06: Cleanup de temporários garantido por `finally`
**Onde no código:** `media-library.controller.ts:73`
**Descrição:** Os arquivos salvos em `os.tmpdir()` pelo multer são deletados via `fs.unlink` no bloco `finally`, independente de sucesso ou falha no processamento. A deleção é fire-and-forget (callback vazia) para não bloquear a response.
**Condição:** Toda requisição — inclusive em caso de erro IDOR ou 422.

---

## Endpoint Exposto

| Método | Path | Guard | DTO | Descrição |
|--------|------|-------|-----|-----------|
| POST | `/media-library/upload` | `AuthGuard` (JWT + x-api-key) | `UploadMediaDto` + `files[]` | Envia criativos ao Google Drive e Meta em paralelo |

### DTO: `UploadMediaDto`

| Campo | Tipo | Validação | Descrição |
|-------|------|-----------|-----------|
| `adAccountId` | `string` | `@IsNotEmpty` | ID da conta de anúncios Meta (ex: `act_123456`) |
| `clientId` | `string` | `@IsNotEmpty` | UUID do cliente no trafegoflow |
| `intention` | `"PRD" \| "CAP"` | `@IsEnum` | Intenção do criativo: Produto ou Captação |
| `productName` | `string` | `@IsNotEmpty`, `@MaxLength(100)` | Nome do produto/campanha |

### Resposta: `UploadResult[]`

```typescript
interface UploadResult {
  fileName: string;       // nome canonizado gerado pelo FileNamerService
  driveFileId?: string;   // ID do arquivo criado no Drive (ausente se falhou)
  driveUrl?: string;      // link webViewLink do Drive
  metaAssetId?: string;   // hash (imagens) ou video_id (vídeos) do Meta
  errors: {
    destination: 'drive' | 'meta';
    message: string;
  }[];
}
```

---

## MIME Types Aceitos (allowlist no controller)

| MIME | Tipo detectado | Extensões comuns |
|------|---------------|-----------------|
| `image/jpeg` | IMG | `.jpg`, `.jpeg` |
| `image/png` | IMG | `.png` |
| `image/webp` | IMG | `.webp` |
| `video/mp4` | VID | `.mp4` |
| `video/quicktime` | VID | `.mov` |

Qualquer outro MIME é rejeitado pelo multer antes de atingir o controller (sem body parsing).

---

## Convenção de Nomenclatura (FileNamerService)

**Formato:** `[INTENÇÃO] - [TIPO] - [PRODUTO] - [MÊS ANO].[ext]`

**Exemplos:**
- `PRD - IMG - Produto X - Ago 26.jpg`
- `CAP - VID - Oferta Black - Nov 26.mp4`
- `PRD - IMG - Produto X - Ago 26 - V1.jpg` ← batch com duplicatas

**Regras:**
- `INTENÇÃO`: `PRD` (Produto) ou `CAP` (Captação)
- `TIPO`: `VID` para `.mp4 .mov .avi .mkv .webm`; `IMG` para qualquer outra extensão
- `PRODUTO`: sanitizado — NFD decomposition → remove diacríticos → remove não-alfanuméricos exceto espaço, `_`, `-`
- `MÊS ANO`: mês em PT-BR abreviado (3 letras) + 2 dígitos do ano (`Ago 26`)
- Versionamento: apenas quando múltiplos arquivos resultam no mesmo nome base; todos recebem V1, V2, etc.

---

## Integração Google Drive (GoogleDriveService)

- **Auth:** OAuth2 com `refresh_token` (service account delegada) — token renovado automaticamente pelo cliente googleapis
- **Upload:** `drive.files.create` com `body: fs.createReadStream(filePath)` — streaming direto do disco temporário, adequado para arquivos grandes
- **`supportsAllDrives: true`:** Necessário para drives compartilhados (Shared Drives)
- **`folderId`:** Extraído da `ClientEntity.googleDriveFolderUrl` — suporta dois formatos de URL do Drive:
  - `/folders/<id>` (formato moderno)
  - `?id=<id>` (formato legado)
- **Duplicatas:** O Drive cria um novo arquivo mesmo se existir outro com o mesmo nome no mesmo folder (comportamento padrão da API, sem verificação de deduplicação)

---

## Integração Meta Ads Manager (MetaMediaService)

| Tipo | Endpoint | Campo do arquivo | Retorno |
|------|----------|-----------------|---------|
| Imagem | `POST /{adAccountId}/adimages` | `filename` | `hash` (string) |
| Vídeo | `POST /{adAccountId}/advideos` | `source` | `id` (video_id) |

- **Token:** passado como campo `access_token` no FormData (requerido pela Graph API para uploads de mídia)
- **Payload:** arquivo lido inteiro em memória (`fs.promises.readFile`) e encapsulado em `Blob` + `FormData` nativo do Node.js 22
- **Versão API:** `META_GRAPH_API_URL` + `META_GRAPH_API_VERSION` (default `https://graph.facebook.com/v21.0`)
- **Token expirado:** A Graph API retorna erro HTTP — propagado como string no `errors[]` do `UploadResult`; sem retry automático

---

## Estratégia de Cache Redis

**Módulo sem cache Redis próprio.** Lê dados via `AdAccountsService` e `ClientsService`, que possuem seus próprios caches (`ad-account:id:*`, `client:id:*`). O módulo se beneficia indiretamente desses caches nas buscas de contexto.

---

## Sem Persistência no Banco

O módulo não tem entity própria nem repositório. Não registra histórico de uploads. O estado do upload (sucesso/falha) é retornado apenas na response HTTP — não é consultável posteriormente.

---

## Critérios de Aceitação (extraídos do código)

```gherkin
Feature: Media Library Upload

  Scenario: Upload bem-sucedido para ambos os destinos
    Given gestor autenticado com JWT válido
    And adAccountId pertence ao clientId informado
    And cliente tem googleDriveFolderUrl configurado
    When POST /media-library/upload com 1 JPG e intention=PRD productName="Produto X"
    Then response 201 com UploadResult[]
    And fileName = "PRD - IMG - Produto X - Ago 26.jpg"
    And driveFileId presente e metaAssetId presente
    And errors = []

  Scenario: Falha no Meta não impede upload no Drive
    Given token Meta expirado para a adAccount
    When POST /media-library/upload com 1 arquivo válido
    Then response 201 com UploadResult[]
    And driveFileId presente
    And metaAssetId ausente
    And errors = [{ destination: "meta", message: "..." }]

  Scenario: IDOR — adAccount de outro cliente
    Given adAccountId pertencente ao clientId "X"
    When POST /media-library/upload com clientId "Y"
    Then response 403

  Scenario: Cliente sem pasta Drive configurada
    Given cliente sem googleDriveFolderUrl
    When POST /media-library/upload
    Then response 422 "Client {id} has no Google Drive folder configured"

  Scenario: MIME type não suportado
    Given arquivo com mimetype "application/pdf"
    When POST /media-library/upload
    Then multer rejeita antes do controller (erro 400)

  Scenario: Batch com dois arquivos de mesmo tipo
    Given 2 JPEGs com mesmo productName e intention
    When POST /media-library/upload
    Then fileNames = ["PRD - IMG - Produto - Ago 26 - V1.jpg", "PRD - IMG - Produto - Ago 26 - V2.jpg"]
```

---

## Variáveis de Ambiente

| Variável | Obrigatória | Default | Descrição |
|----------|-------------|---------|-----------|
| `GOOGLE_CLIENT_ID` | Não (para Drive) | — | OAuth2 Client ID da service account Google |
| `GOOGLE_CLIENT_SECRET` | Não (para Drive) | — | OAuth2 Client Secret |
| `GOOGLE_REFRESH_TOKEN` | Não (para Drive) | — | Refresh token da service account |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Não | — | Pasta raiz (referência; folderId real vem da ClientEntity) |
| `MAX_FILE_SIZE_MB` | Não | `500` | Tamanho máximo por arquivo em MB |
| `META_GRAPH_API_URL` | Não | `https://graph.facebook.com` | Base URL da Graph API |
| `META_GRAPH_API_VERSION` | Não | `v21.0` | Versão da Graph API |

> As variáveis Google são opcionais na validação do Joi (`.optional()`), mas o upload para Drive falhará em runtime se estiverem ausentes. Não há validação early-fail para credenciais Google.

---

## Dependências Externas

**APIs externas:**
- Google Drive API v3 — upload de arquivos para pastas de clientes
- Meta Graph API v21.0 — criação de assets em `/adimages` e `/advideos`

**Módulos NestJS internos:**
- `AdAccountsModule` — busca `AdAccountEntity` por `adAccountId`; descriptografia via `CryptoModule`
- `ClientsModule` — busca `ClientEntity` por `clientId` para obter `googleDriveFolderUrl`
- `CryptoModule` — `AesCryptoService` para descriptografar o `accessToken` da conta de anúncios

**Pacotes npm adicionados:**
- `googleapis@176` — cliente oficial Google APIs para Node.js
- `multer@2` + `@types/multer@2` — processamento de `multipart/form-data`

---

## Pontos de Atenção / Dívida Técnica

### ⚠️ Leitura de arquivo inteiro em memória (MetaMediaService)
`fs.promises.readFile(filePath)` carrega o arquivo completo em um `Buffer` antes de criar o `Blob`. Para vídeos de até 500 MB (default `MAX_FILE_SIZE_MB`), isso consome memória equivalente por request simultâneo. A solução adequada seria usar a API de upload resumable da Graph API (suportada para vídeos via `/{adAccountId}/advideos` com `upload_phase`), mas requer controle de sessão de upload — complexidade de futuro.

### ⚠️ Credenciais Google sem validação early-fail
As env vars `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REFRESH_TOKEN` são marcadas como `.optional()` no Joi. Se ausentes, o módulo sobe sem erro mas toda requisição ao Drive falha em runtime. Seria mais seguro exigir essas variáveis no schema de validação ou pelo menos logar um aviso no `onModuleInit`.

### ⚠️ Sem histórico de uploads
O módulo é stateless — não persiste nenhum registro de upload. O gestor não tem como consultar o que foi enviado, quando, ou qual `metaAssetId` foi gerado para um determinado criativo. Uma tabela `media_uploads` seria necessária para auditoria.

### ⚠️ Limite de arquivos hardcoded em 20 por request
`FilesInterceptor('files', 20, ...)` — o limite máximo de arquivos por chamada é fixo no código, não configurável via env.

### ℹ️ Duplicatas no Drive são permitidas
A API do Drive cria um novo arquivo mesmo se já existir outro com o mesmo nome no mesmo folder. Isso é o comportamento esperado (espelhando o `upload-midias` original), mas pode causar confusão ao gestor se o mesmo criativo for enviado duas vezes.

### ℹ️ `MAX_FILE_SIZE_BYTES` lido via `process.env` no tempo de classe
O limite de tamanho do multer é calculado em tempo de definição da classe (fora do construtor), portanto usa `process.env.MAX_FILE_SIZE_MB` diretamente em vez de `ConfigService`. Funciona corretamente — apenas diverge do padrão NestJS de injetar configs via `ConfigService`.
