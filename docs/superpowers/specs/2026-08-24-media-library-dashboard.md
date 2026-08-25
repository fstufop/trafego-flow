# Spec: Media Library — trafegoflow-dashboard

**Data:** 2026-08-24
**Status:** Pronto para implementação
**Backend:** já implementado em `trafegoflow` (`POST /api/v1/media-library/upload`)

---

## Contexto

O gestor de tráfego precisa de uma página no dashboard para selecionar um cliente, escolher a conta de anúncios, preencher metadados do criativo e fazer upload de imagens/vídeos. O backend já orquestra os uploads para Google Drive e Meta em paralelo e retorna o resultado por arquivo.

---

## Rota

```
/media-library
```

Top-level no nav principal — o gestor alterna frequentemente entre clientes durante o dia, então não deve estar aninhada em `/clients/:id`.

---

## Endpoints consumidos

### `GET /api/v1/clients`
Retorna lista de clientes ativos para popular o dropdown.

```ts
// Resposta relevante
{ id: string; name: string }[]
```

### `GET /api/v1/ad-accounts?clientId=:id`
Retorna contas de anúncios do cliente selecionado.

```ts
{ id: string; adAccountId: string; accountName: string | null }[]
```

> `adAccountId` é o valor que vai no campo `adAccountId` do upload (ex: `act_123456`). O campo `id` é o UUID interno — não confundir.

### `POST /api/v1/media-library/upload`
`multipart/form-data` com os campos:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `clientId` | string | UUID do cliente |
| `adAccountId` | string | ID Meta da conta (`act_...`) |
| `intention` | `"PRD"` \| `"CAP"` | Intenção do criativo |
| `productName` | string | Nome do produto (max 100 chars) |
| `startVersion` | number (opcional) | Versão inicial do lote (inteiro ≥ 1). Se fornecido, todos os arquivos recebem sufixo de versão a partir desse número. Se ausente, versão só é aplicada quando há duplicatas no lote, começando em V1. |
| `files` | File[] | Até 20 arquivos |

**Resposta de sucesso (200):**

```ts
interface UploadResult {
  fileName: string;       // nome canonizado gerado pelo backend
  driveFileId?: string;
  driveUrl?: string;
  metaAssetId?: string;
  errors: {
    destination: 'drive' | 'meta';
    message: string;      // ex: "Meta API 400: Permissions error (code 200)"
  }[];
}

// Response: UploadResult[]
```

**Erros HTTP esperados:**

| Status | Causa |
|--------|-------|
| 400 | `intention` inválido ou `productName` vazio |
| 403 | `adAccountId` não pertence ao `clientId` |
| 422 | Cliente sem Google Drive configurado |
| 413 | Arquivo maior que `MAX_FILE_SIZE_MB` (500 MB default) |

---

## Layout da página

```
┌──────────────────────────────────────────────────────────────┐
│  Biblioteca de Mídias                                        │
├──────────────────────────────────────────────────────────────┤
│  SEÇÃO 1 — CONTEXTO                                          │
│  ┌─────────────────────┐  ┌──────────────────────────────┐  │
│  │  Cliente            ▼│  │  Conta de anúncios          ▼│  │
│  └─────────────────────┘  └──────────────────────────────┘  │
│  (disabled até cliente     (carrega após selecionar cliente) │
│   selecionado)                                               │
├──────────────────────────────────────────────────────────────┤
│  SEÇÃO 2 — METADADOS                                         │
│  Intenção:  ● PRD — Produto   ○ CAP — Captação              │
│  Produto:   [____________________________________________]   │
│  Versão inicial (opcional): [___]                            │
├──────────────────────────────────────────────────────────────┤
│  SEÇÃO 3 — ARQUIVOS                                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Arraste imagens e vídeos aqui                       │   │
│  │  ou clique para selecionar                           │   │
│  │  .jpg  .png  .webp  .mp4  .mov                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  arquivo1.mp4   PRD - VID - Produto Teste - Ago 26  [✕]    │
│  arquivo2.jpg   PRD - IMG - Produto Teste - Ago 26  [✕]    │
│  arquivo3.jpg   PRD - IMG - Produto Teste - Ago 26 - V2 [✕]│
│                  (preview do nome atualiza em tempo real)    │
│                                                              │
│                    [ Fazer Upload ]                          │
└──────────────────────────────────────────────────────────────┘
```

---

## Componentes

### `MediaUploadForm`
Componente raiz da página. Gerencia o estado global com **React Hook Form**.

**Estado:**
```ts
{
  clientId: string;
  adAccountId: string;
  intention: 'PRD' | 'CAP';
  productName: string;
  startVersion?: number;
  files: File[];
}
```

**Responsabilidades:**
- Busca a lista de clientes no mount
- Busca contas de anúncios quando `clientId` muda (invalida `adAccountId`)
- Submete o `FormData` via fetch/axios para `/api/v1/media-library/upload`
- Exibe `UploadProgressCard` durante o upload
- Exibe `UploadResultTable` após conclusão

---

### `FileDropzone`
Área de drag & drop para seleção de arquivos.

**Comportamentos:**
- Aceita `image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `video/quicktime`
- Rejeita outros tipos com mensagem inline (não toast)
- Limite visual de 500 MB por arquivo (validação client-side antes do envio)
- Ao adicionar arquivos, exibe lista com preview do nome canonizado

**Preview do nome (client-side):**

O frontend deve replicar a lógica de nomenclatura do `FileNamerService` para mostrar o nome final antes do upload. Regras:

```ts
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
const PT_MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function previewNames(
  files: File[],
  intention: string,
  productName: string,
  startVersion?: number,
): string[] {
  const product = productName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim();
  const now = new Date();
  const date = `${PT_MONTHS[now.getMonth()]} ${String(now.getFullYear()).slice(-2)}`;

  const entries = files.map((file) => {
    const dotIdx = file.name.lastIndexOf('.');
    const ext = dotIdx >= 0 ? file.name.slice(dotIdx) : '';
    const type = VIDEO_EXTS.has(ext.toLowerCase()) ? 'VID' : 'IMG';
    const base = `${intention} - ${type} - ${product} - ${date}`;
    return { base, ext };
  });

  if (startVersion !== undefined) {
    const baseVersions = new Map<string, number>();
    return entries.map(({ base, ext }) => {
      const v = (baseVersions.get(base) ?? startVersion - 1) + 1;
      baseVersions.set(base, v);
      return `${base} - V${v}${ext}`;
    });
  }

  const baseCounts = new Map<string, number>();
  for (const { base } of entries) baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);

  const baseVersions = new Map<string, number>();
  return entries.map(({ base, ext }) => {
    if (baseCounts.get(base)! > 1) {
      const v = (baseVersions.get(base) ?? 0) + 1;
      baseVersions.set(base, v);
      return `${base} - V${v}${ext}`;
    }
    return `${base}${ext}`;
  });
}
```

> O preview deve atualizar em tempo real conforme `intention`, `productName` e `startVersion` mudam.

**Itens na lista:**

```
[ícone tipo]  arquivo-original.mp4  →  PRD - VID - Produto - Ago 26.mp4  [✕]
```

- Ícone diferente para IMG vs VID
- Botão [✕] remove o arquivo da lista
- Nome do arquivo original à esquerda, nome canonizado à direita

---

### `UploadProgressCard`
Exibido durante o upload (substituiu o formulário ou aparece abaixo).

Como o backend retorna apenas após todos os uploads terminarem (response única, sem streaming), mostrar um **spinner global** é suficiente. Se quiser granularidade por arquivo, seria necessário SSE ou polling — fora de escopo por ora.

```
┌──────────────────────────────────┐
│  Enviando 3 arquivos...          │
│  ████████████░░░░  (indeterminate)│
│  Aguarde, isso pode levar alguns │
│  segundos para vídeos grandes.   │
└──────────────────────────────────┘
```

**Estado durante upload:**
- Botão "Fazer Upload" desabilitado e com spinner
- Dropzone desabilitada
- Formulário em modo read-only

---

### `UploadResultTable`
Exibido após a resposta do backend. Substitui o `UploadProgressCard`.

**Colunas:**

| Arquivo | Drive | Meta | Ações |
|---------|-------|------|-------|
| PRD - IMG - Produto - Ago 26.jpg | ✓ Link | ✓ `abc123` | — |
| PRD - VID - Produto - Ago 26.mp4 | ✓ Link | ✗ Token expirado | — |

**Regras de exibição:**
- Drive com sucesso: ícone ✓ verde + link clicável para `driveUrl`
- Drive com erro: ícone ✗ vermelho + mensagem do `errors[]`
- Meta com sucesso: ícone ✓ verde + asset ID copiável
- Meta com erro: ícone ✗ vermelho + mensagem do `errors[]`
- Linha inteira com sucesso em ambos: fundo verde claro
- Linha com qualquer erro: fundo amarelo claro (não vermelho — upload parcial não é falha total)

**Ações após resultado:**
- Botão "Novo upload" — reseta o formulário completamente
- Botão "Copiar todos os IDs Meta" — copia os `metaAssetId` de todos os arquivos bem-sucedidos

---

## Estados da página

```
idle          → usuário preenchendo o formulário
uploading     → POST em andamento (spinner, form bloqueado)
result        → exibindo UploadResultTable
error-global  → erro HTTP 403, 422, 413 (toast + form editável)
```

**Erros globais (não por arquivo):**

| HTTP | Mensagem ao usuário |
|------|---------------------|
| 403 | "A conta de anúncios não pertence ao cliente selecionado." |
| 422 | "Este cliente não tem pasta do Google Drive configurada. Contate o suporte." |
| 413 | "Um ou mais arquivos excedem o tamanho máximo de 500 MB." |
| 401/403 auth | "Sessão expirada. Faça login novamente." |

---

## Fluxo de dados completo

```
mount
  → GET /clients → popula dropdown clientes

onChange(clientId)
  → GET /ad-accounts?clientId=X → popula dropdown contas
  → reseta adAccountId selecionado

onChange(intention | productName | startVersion | files)
  → atualiza preview de nomes (client-side, sem request)

onSubmit
  → monta FormData:
      clientId, adAccountId, intention, productName
      startVersion (se preenchido)
      files[0], files[1], ...
  → POST /api/v1/media-library/upload
  → estado: uploading

onResponse(200)
  → estado: result
  → exibe UploadResultTable

onResponse(4xx)
  → estado: error-global
  → exibe toast com mensagem mapeada
```

---

## Validações client-side (antes do POST)

| Campo | Validação |
|-------|-----------|
| `clientId` | obrigatório |
| `adAccountId` | obrigatório |
| `intention` | obrigatório (`PRD` ou `CAP`) |
| `productName` | obrigatório, max 100 chars |
| `startVersion` | opcional; se preenchido, inteiro ≥ 1 |
| `files` | mínimo 1 arquivo |
| MIME type por arquivo | validado no `fileFilter` do dropzone |
| Tamanho por arquivo | alerta visual se > 500 MB (não bloqueia — o backend valida) |

---

## Dependências sugeridas

| Lib | Uso |
|-----|-----|
| `react-hook-form` | gerenciamento do formulário |
| `react-dropzone` | área de drag & drop |
| `shadcn/ui` (Select, RadioGroup, Input, Button, Table, Badge) | componentes visuais |
| `sonner` ou `react-hot-toast` | toasts de erro global |

---

## Estrutura de arquivos sugerida

```
app/(dashboard)/media-library/
├── page.tsx                          # Server Component — layout e título
├── MediaUploadForm.tsx               # Client Component — formulário principal
├── FileDropzone.tsx                  # Client Component — drag & drop
├── UploadResultTable.tsx             # Client Component — tabela de resultados
├── UploadProgressCard.tsx            # Client Component — estado de loading
└── lib/
    └── file-namer.ts                 # Lógica de preview de nomes (replicada do backend)
```

---

## Pontos de atenção

- **`adAccountId` vs `id`:** o dropdown mostra `accountName`, mas o valor enviado no FormData deve ser `adAccountId` (`act_...`), não o UUID interno da entidade.
- **Upload de vídeos grandes:** o backend implementa chunked upload internamente, mas do ponto de vista do frontend é uma request única normal. Para arquivos de 100-500 MB, a request pode demorar 30-60s — o spinner precisa comunicar isso.
- **Sem polling:** a response só chega quando todos os arquivos terminaram (Drive + Meta em paralelo por arquivo). Não há endpoint de status intermediário.
- **Reset do formulário:** após "Novo upload", limpar também a lista de arquivos do dropzone (estado interno do `react-dropzone`).
