# Portal do Cliente — Frontend (projeto novo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o projeto novo `trafegoflow-client-portal` — repo próprio no GitHub, harness completo (lint, format, type-check, testes, CI), e a aplicação: login/convite/reset de senha, e a tela de regras de auto-resposta (galeria por tipo + expansão inline), consumindo a API do `trafegoflow` com o token `client-portal`.

**Architecture:** Next.js 15 (App Router) + TypeScript, mesmo padrão arquitetural do `trafegoflow-dashboard` (proxy route server-side pra nunca expor o JWT ao browser, cookie `httpOnly`, Server Actions pra login, TanStack Query pros dados). UI com shadcn/ui + Tailwind + `motion` pras transições decididas nos mockups (galeria de cards, expansão inline).

**Tech Stack:** Next.js 15, React 19, TypeScript (strict), Tailwind CSS 4, shadcn/ui, TanStack Query, react-hook-form + zod, `motion`, ESLint 9 (flat config) + Prettier, Vitest + Testing Library, GitHub Actions, pnpm.

**Spec:** `/Users/filipesteodoro/Github/trafegoflow/docs/superpowers/specs/2026-10-27-client-portal-auto-reply-design.md`
**Depende de:** `/Users/filipesteodoro/Github/trafegoflow/docs/superpowers/plans/2026-10-27-client-portal-backend.md` — todos os endpoints `/auth/client-*` e a checagem de posse em `/conversation-rules` precisam existir no ambiente usado para testar esta aplicação de ponta a ponta. As Tasks 1–3 deste plano (scaffold, harness, CI) não dependem do backend e podem rodar em paralelo.

## Global Constraints

- Repo novo: `fstufop/trafegoflow-client-portal`, privado, criado e enviado via GitHub CLI (`gh`).
- O JWT do portal nunca é lido nem armazenado no lado do browser — fica num cookie `httpOnly` (`client-portal-token`), igual ao padrão `auth-token` do `trafegoflow-dashboard`; todo acesso à API passa por uma rota proxy server-side.
- As 4 telas de regra seguem exatamente os tipos e campos já validados em `trafegoflow-dashboard/components/conversation-rules/conversation-rule-upsert-dialog.tsx` (schema zod nas linhas 44–109 desse arquivo) — fonte de verdade pros limites de caracteres e campos obrigatórios por tipo, não os DTOs do backend isoladamente.
- Estrutura de tela decidida nos mockups do brainstorming: galeria de 4 cards por tipo (não lista única, não wizard); dentro de um tipo, criar/editar expande **inline na lista** (não modal, não painel lateral).
- Harness mínimo exigido antes de qualquer tela de produto: lint, format check, type-check, testes unitários e build, todos rodando no CI em cada push/PR.

## Review Focus

- Sessão expirada (cookie presente mas o backend responde `401`) no meio do uso — a chamada via proxy deve limpar o cookie e redirecionar pro login, não deixar a tela presa num estado de erro silencioso.
- Link de `/definir-senha?token=...` acessado duas vezes (token já consumido) — a segunda tentativa deve mostrar uma mensagem clara ("link expirado ou já usado"), não um erro genérico.
- Criar uma 5ª regra de ice breaker (limite de 4 já validado no backend com `409`) — a UI deve mostrar o erro do backend, e idealmente desabilitar "adicionar" ao notar 4 já ativas.
- Client sem nenhuma integração do Instagram ativa tentando abrir o tipo "Comentário em post" (que depende de `GET /conversation-rules/posts`, que por sua vez depende de uma integração ativa) — a tela deve mostrar um estado vazio claro, não uma falha de rede sem explicação.
- Campo de botão (`buttonText`/`buttonUrl`) sendo preenchido só parcialmente em `keyword_dm`/`icebreaker`/`default` — mesma regra do dashboard admin ("preencha os dois, ou nenhum") precisa valer aqui também.

---

### Task 1: Scaffold do projeto + harness de lint/format/type-check

**Files:**
- Create: projeto inteiro em `/Users/filipesteodoro/Github/trafegoflow-client-portal/` (via `create-next-app`)
- Modify: `package.json` (scripts), `eslint.config.mjs`, criar `.prettierrc`, `.prettierignore`
- Create: `.husky/pre-commit`, `lint-staged.config.js` (ou seção `lint-staged` no `package.json`)

- [ ] **Step 1: Criar o projeto**

```bash
cd /Users/filipesteodoro/Github
pnpm dlx create-next-app@latest trafegoflow-client-portal \
  --typescript --tailwind --eslint --app --src-dir=false \
  --import-alias "@/*" --use-pnpm --turbopack
cd trafegoflow-client-portal
```

- [ ] **Step 2: Inicializar shadcn/ui** (mesma config de estilo do dashboard — `base-nova`, `baseColor: neutral`, `iconLibrary: lucide`):

```bash
pnpm dlx shadcn@latest init
```

- [ ] **Step 3: Adicionar Prettier**, consistente com o estilo já usado no resto da família de repos (aspas simples, vírgula final em tudo):

```bash
pnpm add -D prettier eslint-config-prettier
```

Criar `.prettierrc` (`{ "singleQuote": true, "trailingComma": "all" }`) e `.prettierignore` (`.next`, `node_modules`, `pnpm-lock.yaml`).

- [ ] **Step 4: Atualizar `eslint.config.mjs`** para incluir `eslint-config-prettier` por último (evita conflito entre regras de formatação do ESLint e do Prettier), mantendo o que `create-next-app` já gerou (`next/core-web-vitals`, `next/typescript`).

- [ ] **Step 5: Adicionar scripts ao `package.json`**:

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build --turbopack",
    "start": "next start",
    "lint": "eslint .",
    "format": "prettier --check .",
    "format:write": "prettier --write .",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 6: Configurar Husky + lint-staged** (hook de pre-commit rodando lint e format só nos arquivos staged):

```bash
pnpm add -D husky lint-staged
pnpm exec husky init
```

`lint-staged` no `package.json`:
```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,css}": ["prettier --write"]
  }
}
```

`.husky/pre-commit`:
```bash
pnpm exec lint-staged
```

- [ ] **Step 7: Verificar**

Run: `pnpm lint && pnpm format && pnpm typecheck && pnpm build`
Expected: os 4 comandos passam sem erro no projeto recém-criado (antes de qualquer código de produto).

- [ ] **Step 8: Substituir o `README.md`** que o `create-next-app` gerou por documentação real do projeto: o que este app é (portal self-service pra clients gerenciarem suas próprias regras de auto-resposta do Instagram, consumindo a API do `trafegoflow` com um token de escopo `client-portal`), stack, como rodar localmente (inclui a variável de ambiente `API_URL` apontando pro backend), o padrão de sessão (cookie `httpOnly` `client-portal-token`, nunca lido no browser, rota proxy server-side), e um link para o spec (`/Users/filipesteodoro/Github/trafegoflow/docs/superpowers/specs/2026-10-27-client-portal-auto-reply-design.md`) como referência de arquitetura mais completa.

- [ ] **Step 9: Criar `.gitignore`** (o do `create-next-app` já cobre `node_modules`/`.next`; confirmar que `.env*.local` está incluído) e primeiro commit:

```bash
git init
git add -A
git commit -m "chore: scaffold trafegoflow-client-portal (Next.js 15 + TS + Tailwind + shadcn)"
```

---

### Task 2: Harness de testes (Vitest + Testing Library) e CI

**Files:**
- Create: `vitest.config.ts`, `vitest.setup.ts`
- Create: `lib/utils.test.ts` (smoke test, prova que o harness funciona)
- Create: `.github/workflows/ci.yml`
- Modify: `package.json` (scripts `test`, `test:watch`)

- [ ] **Step 1: Instalar as dependências de teste**

```bash
pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Criar `vitest.config.ts`** (plugin React, `environment: 'jsdom'`, `setupFiles: ['./vitest.setup.ts']`, alias `@` apontando pra raiz do projeto, igual ao `tsconfig.json`) e `vitest.setup.ts` (`import '@testing-library/jest-dom/vitest'`).

- [ ] **Step 3: Adicionar scripts**: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 4: Escrever um teste de verificação do harness** em `lib/utils.test.ts` — exercita a função `cn()` que o `shadcn init` já gerou em `lib/utils.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges class names and resolves Tailwind conflicts', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm test`
Expected: PASS — prova que o harness de testes está funcional antes de qualquer teste de produto.

- [ ] **Step 6: Criar `.github/workflows/ci.yml`** — roda em `push`/`pull_request` pra `main`: setup do pnpm (via `pnpm/action-setup`), `actions/setup-node` com cache `pnpm`, `pnpm install --frozen-lockfile`, depois `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test`, `pnpm build`, nessa ordem, falhando o job no primeiro que falhar.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: add Vitest harness and GitHub Actions CI"
```

---

### Task 3: Repositório no GitHub

**Files:** nenhum arquivo de código — só operação de infra.

- [ ] **Step 1: Criar o repo e enviar o código**, com a conta já autenticada (`fstufop`, confirmado via `gh auth status`):

```bash
gh repo create fstufop/trafegoflow-client-portal --private --source=. --remote=origin --push
```

- [ ] **Step 2: Verificar**

Run: `gh repo view fstufop/trafegoflow-client-portal` e `git log origin/main -1`
Expected: repo existe, é privado, e o commit mais recente local bate com o do remoto.

- [ ] **Step 3: Confirmar que o CI do Task 2 rodou e passou**

Run: `gh run list --limit 1`
Expected: o workflow do push inicial aparece com status `success` (se falhar, corrigir antes de seguir pras próximas tasks — nenhuma tarefa de produto deve empilhar em cima de um CI quebrado).

---

### Task 4: Sessão e autenticação (proxy, middleware, login)

**Files:**
- Create: `app/api/proxy/[...path]/route.ts`
- Create: `app/actions/auth.ts`
- Create: `middleware.ts`
- Create: `app/(auth)/login/page.tsx`
- Create: `lib/api-client.ts`
- Test: `app/actions/auth.test.ts`

**Interfaces:**
- Produces: `apiFetch<T>(path: string, options?: RequestInit): Promise<T>` (mesma assinatura do `trafegoflow-dashboard/lib/api-client.ts`); `loginAction`, `logoutAction`; cookie `client-portal-token`.

- [ ] **Step 1: Escrever o teste falhando** em `app/actions/auth.test.ts` (mock de `fetch` global e de `next/headers`):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const setCookie = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ set: setCookie, delete: vi.fn() }) }));

describe('loginAction', () => {
  beforeEach(() => { setCookie.mockClear(); });

  it('sets the client-portal-token cookie on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accessToken: 'tok-123' }) }) as any;
    const formData = new FormData();
    formData.set('email', 'client@x.com');
    formData.set('password', 'senha-valida');

    const result = await loginAction(undefined, formData);

    expect(setCookie).toHaveBeenCalledWith('client-portal-token', 'tok-123', expect.objectContaining({ httpOnly: true }));
    expect(result.success).toBe(true);
  });

  it('returns an error message on invalid credentials, without setting a cookie', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as any;
    const formData = new FormData();
    formData.set('email', 'client@x.com');
    formData.set('password', 'errada');

    const result = await loginAction(undefined, formData);

    expect(result.error).toBeTruthy();
    expect(setCookie).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test auth.test.ts`
Expected: FAIL — `app/actions/auth.ts` não existe.

- [ ] **Step 3: Implementar `app/actions/auth.ts`**, espelhando `trafegoflow-dashboard/app/actions/auth.ts`: `loginAction` chama `POST ${API_URL}/auth/client-login`, seta o cookie `client-portal-token` (`httpOnly`, `secure` em produção, `sameSite: 'strict'`, `maxAge` de 7 dias — mesmo valor usado no `trafegoflow-dashboard`; não escrever no código/comentário que isso "casa com o `auth.jwtExpiresIn` do backend", porque não casa: o padrão real do backend é `1d` (`JWT_EXPIRES_IN=1d` no `.env.example`), não 7 dias. O cookie sobrevivendo além do token é aceitável aqui porque o Step 6 já trata `401`/`403` limpando o cookie e redirecionando no primeiro request que falhar — não propagar a justificativa errada pro código.), `logoutAction` deleta o cookie e redireciona pra `/login`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test auth.test.ts`
Expected: PASS

- [ ] **Step 5: Implementar a rota proxy** `app/api/proxy/[...path]/route.ts`, cópia direta do padrão em `trafegoflow-dashboard` trocando o nome do cookie lido para `client-portal-token`. Em caso de resposta `401` do backend, a rota limpa o cookie antes de repassar a resposta (diferença em relação ao dashboard — ver Review Focus).

- [ ] **Step 6: Implementar `lib/api-client.ts`** (`apiFetch`), idêntico ao do dashboard (`fetch('/api/proxy' + path, ...)`, trata `401` **e `403`** lançando `Error('UNAUTHORIZED')`, trata `204`) — correção em relação ao backend original do plano: depois que o backend ganhou a checagem de revogação em cascata (`/auth/client-portal/me` agora pode responder `403` pra um client desativado, não só `401` pra token expirado), este frontend trata os dois códigos como "sessão inválida, volte pro login" — não existe nenhum caso legítimo em que este app específico (single-tenant, sempre o próprio client logado) deveria receber um `403` por outro motivo.

- [ ] **Step 7: Implementar `middleware.ts`**, mesmo padrão do dashboard: sem cookie `client-portal-token` e fora de `/login`, `/esqueci-senha`, `/definir-senha` → redireciona pro `/login`; com cookie e em `/login` → redireciona pra `/` (tela principal).

- [ ] **Step 8: Implementar `app/(auth)/login/page.tsx`**, mesmo padrão visual/estrutural do `trafegoflow-dashboard` (`useActionState(loginAction, undefined)`, redireciona em `state.success`), com um link "Esqueci minha senha" apontando pra `/esqueci-senha`.

- [ ] **Step 9: Verificar manualmente** (precisa do backend do plano separado rodando local, ou um mock de API_URL)

Run: `pnpm dev`, acessar `/`, confirmar redirecionamento para `/login`; logar com uma conta de teste válida, confirmar redirecionamento de volta pra `/`.

- [ ] **Step 10: Commit**

```bash
git add app/api/proxy app/actions/auth.ts app/actions/auth.test.ts middleware.ts "app/(auth)/login" lib/api-client.ts
git commit -m "feat(auth): session cookie, proxy route and login"
```

---

### Task 5: Definir senha (convite/reset) e esqueci minha senha

**Files:**
- Create: `app/(auth)/definir-senha/page.tsx`
- Create: `app/(auth)/esqueci-senha/page.tsx`
- Modify: `app/actions/auth.ts` (`resetPasswordAction`, `forgotPasswordAction`)
- Test: `app/actions/auth.test.ts`

**Interfaces:**
- Produces: `resetPasswordAction(prevState, formData): Promise<{ error: string; success?: boolean }>` (chama `POST /auth/client-reset-password` com `token` + `password`), `forgotPasswordAction(prevState, formData): Promise<{ error: string; success?: boolean }>` (chama `POST /auth/client-forgot-password`).

- [ ] **Step 1: Escrever os testes falhando** em `app/actions/auth.test.ts`:

```typescript
describe('resetPasswordAction', () => {
  it('returns success on a valid, unexpired token', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;
    const formData = new FormData();
    formData.set('token', 'valid-token');
    formData.set('password', 'nova-senha-123');
    const result = await resetPasswordAction(undefined, formData);
    expect(result.success).toBe(true);
  });

  it('returns a clear error for an expired or already-used token', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as any;
    const formData = new FormData();
    formData.set('token', 'expired-token');
    formData.set('password', 'nova-senha-123');
    const result = await resetPasswordAction(undefined, formData);
    expect(result.error).toMatch(/expirado|inválido/i);
  });
});

describe('forgotPasswordAction', () => {
  it('always returns success, regardless of whether the email exists', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;
    const formData = new FormData();
    formData.set('email', 'qualquer@x.com');
    const result = await forgotPasswordAction(undefined, formData);
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test auth.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar as duas actions** em `app/actions/auth.ts`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test auth.test.ts`
Expected: PASS

- [ ] **Step 5: Implementar `app/(auth)/definir-senha/page.tsx`** — lê `token` da query string (`useSearchParams`), formulário de nova senha (+ confirmação, validada no cliente com zod: as duas devem ser iguais), usa `resetPasswordAction`; em sucesso, redireciona pro `/login` com uma mensagem de "senha definida, faça login".

- [ ] **Step 6: Implementar `app/(auth)/esqueci-senha/page.tsx`** — formulário de e-mail, usa `forgotPasswordAction`; sempre mostra a mesma mensagem de sucesso ("se o e-mail existir, você vai receber um link"), nunca revela se o e-mail existe (mesma regra do backend).

- [ ] **Step 7: Verificar manualmente**

Run: `pnpm dev`, acessar `/definir-senha?token=algumtoken` e `/esqueci-senha`, confirmar que os formulários renderizam e submetem.

- [ ] **Step 8: Commit**

```bash
git add "app/(auth)/definir-senha" "app/(auth)/esqueci-senha" app/actions/auth.ts app/actions/auth.test.ts
git commit -m "feat(auth): set-password and forgot-password flows"
```

---

### Task 6: Identidade do client logado (`useMe`) + shell da área logada

**Files:**
- Create: `hooks/use-me.ts`
- Create: `app/(portal)/layout.tsx`
- Test: `hooks/use-me.test.ts`

**Interfaces:**
- Produces: `useMe(): UseQueryResult<{ clientId: string; email: string }>`.

- [ ] **Step 1: Escrever o teste falhando** em `hooks/use-me.test.ts` (mesmo padrão de teste de hook do TanStack Query — `renderHook` com um `QueryClientProvider` de teste):

```typescript
it('fetches the current client identity from /auth/client-portal/me', async () => {
  vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ clientId: 'c1', email: 'a@b.com' });
  const { result } = renderHook(() => useMe(), { wrapper: createQueryWrapper() });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toEqual({ clientId: 'c1', email: 'a@b.com' });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test use-me.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `useMe()`** em `hooks/use-me.ts` (`useQuery({ queryKey: ['me'], queryFn: () => apiFetch('/auth/client-portal/me') })`).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test use-me.test.ts`
Expected: PASS

- [ ] **Step 5: Implementar `app/(portal)/layout.tsx`** — layout da área logada: chama `useMe()`, mostra um header simples (e-mail do client + botão "Sair" chamando `logoutAction`), `<Skeleton />` enquanto carrega, e em erro (`401`) deixa o `middleware.ts` cuidar do redirect (a própria chamada via `apiFetch` lançando `UNAUTHORIZED` já é suficiente — não precisa de lógica extra aqui além de propagar o erro pro boundary padrão do Next).

- [ ] **Step 6: Commit**

```bash
git add hooks/use-me.ts hooks/use-me.test.ts "app/(portal)/layout.tsx"
git commit -m "feat(portal): resolve the logged-in client's identity"
```

---

### Task 7: Dados das regras (hooks) — escopados ao client logado

**Files:**
- Create: `types/conversation-rule.ts`
- Create: `hooks/use-conversation-rules.ts`
- Test: `hooks/use-conversation-rules.test.ts`

**Interfaces:**
- Consumes: `useMe()` (Task 6).
- Produces: mesmas assinaturas de `trafegoflow-dashboard/hooks/use-conversation-rules.ts` (`useConversationRules`, `useCreateConversationRule`, `useUpdateConversationRule`, `useDeleteConversationRule`, `useInstagramPosts`), mas `clientId` vem de `useMe().data?.clientId` dentro do próprio hook em vez de ser passado por um componente pai — aqui não existe "outro client" pra selecionar, é sempre o do usuário logado.

- [ ] **Step 1: Copiar `types/conversation-rule.ts`** de `trafegoflow-dashboard/types/conversation-rule.ts` sem alterações (mesmo contrato de API).

- [ ] **Step 2: Escrever o teste falhando** em `hooks/use-conversation-rules.test.ts`:

```typescript
it('does not fetch until the client identity (useMe) has resolved', () => {
  vi.spyOn(meHook, 'useMe').mockReturnValue({ data: undefined, isSuccess: false } as any);
  const spy = vi.spyOn(apiClient, 'apiFetch');
  renderHook(() => useConversationRules(), { wrapper: createQueryWrapper() });
  expect(spy).not.toHaveBeenCalled();
});

it('fetches /conversation-rules?clientId= once the client identity is known', async () => {
  vi.spyOn(meHook, 'useMe').mockReturnValue({ data: { clientId: 'c1' }, isSuccess: true } as any);
  const spy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue([]);
  renderHook(() => useConversationRules(), { wrapper: createQueryWrapper() });
  await waitFor(() => expect(spy).toHaveBeenCalledWith('/conversation-rules?clientId=c1'));
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `pnpm test use-conversation-rules.test.ts`
Expected: FAIL

- [ ] **Step 4: Implementar `hooks/use-conversation-rules.ts`**, portando a lógica de `trafegoflow-dashboard/hooks/use-conversation-rules.ts`, com cada hook chamando `useMe()` internamente e usando `enabled: !!clientId` (query) / lançando se chamado antes de `clientId` existir (mutation). `useInstagramPosts` chama o mesmo endpoint `/conversation-rules/posts` sem precisar de `pageId` (o backend resolve a partir do token — Task 9 do plano de backend) — então a assinatura perde o parâmetro `pageId`.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm test use-conversation-rules.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add types/conversation-rule.ts hooks/use-conversation-rules.ts hooks/use-conversation-rules.test.ts
git commit -m "feat(rules): data hooks scoped to the logged-in client"
```

---

### Task 8: Tela principal — galeria de cards por tipo

**Files:**
- Create: `app/(portal)/page.tsx`
- Create: `components/rules/rule-type-card.tsx`
- Test: `components/rules/rule-type-card.test.tsx`

**Interfaces:**
- Consumes: `useConversationRules()` (Task 7).
- Produces: `RuleTypeCard({ type, label, icon, activeCount, href }: RuleTypeCardProps)`.

- [ ] **Step 1: Escrever o teste falhando** em `rule-type-card.test.tsx`:

```typescript
it('shows the active rule count for its type', () => {
  render(<RuleTypeCard type="keyword_dm" label="Palavra-chave no DM" icon={<span />} activeCount={3} href="/regras/keyword_dm" />);
  expect(screen.getByText('3 regras ativas')).toBeInTheDocument();
});

it('shows singular phrasing for exactly one active rule', () => {
  render(<RuleTypeCard type="default" label="Padrão" icon={<span />} activeCount={1} href="/regras/default" />);
  expect(screen.getByText('1 regra ativa')).toBeInTheDocument();
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm test rule-type-card.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar `RuleTypeCard`** — `Link` do Next pro `href`, animação de hover via `motion` (`whileHover={{ y: -4 }}`), pluralização simples do contador.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm test rule-type-card.test.tsx`
Expected: PASS

- [ ] **Step 5: Implementar `app/(portal)/page.tsx`** — busca `useConversationRules()`, agrupa por `type`, renderiza os 4 `RuleTypeCard` (post_comment, keyword_dm, icebreaker, default) em grid responsivo, cada um linkando pra `/regras/[type]` (Task 9).

- [ ] **Step 6: Verificar manualmente**

Run: `pnpm dev`, logar, confirmar que a galeria mostra os 4 cards com as contagens corretas.

- [ ] **Step 7: Commit**

```bash
git add "app/(portal)/page.tsx" components/rules/rule-type-card.tsx components/rules/rule-type-card.test.tsx
git commit -m "feat(rules): main gallery screen"
```

---

### Task 9: Drill-down por tipo + expansão inline (criar/editar)

**Files:**
- Create: `app/(portal)/regras/[type]/page.tsx`
- Create: `components/rules/rule-list.tsx`
- Create: `components/rules/rule-inline-form.tsx`
- Create: `components/rules/rule-type-schemas.ts`
- Test: `components/rules/rule-type-schemas.test.ts`
- Test: `components/rules/rule-inline-form.test.tsx`

**Interfaces:**
- Consumes: `useConversationRules`, `useCreateConversationRule`, `useUpdateConversationRule`, `useDeleteConversationRule`, `useInstagramPosts` (Task 7).
- Produces: `schemaForType(type: RuleType): ZodSchema` (uma por tipo, não um schema único condicional — aqui o tipo já é fixo pela rota, diferente do dialog do dashboard); `RuleInlineForm({ type, rule, onDone }: RuleInlineFormProps)`; `RuleList({ type }: { type: RuleType })`.

- [ ] **Step 1: Escrever os testes falhando** em `rule-type-schemas.test.ts` — portando as regras exatas de `trafegoflow-dashboard/components/conversation-rules/conversation-rule-upsert-dialog.tsx:44-109`, uma `describe` por tipo:

```typescript
describe('schemaForType("post_comment")', () => {
  it('requires triggerValue (post), commentKeyword and publicReply', () => {
    const result = schemaForType('post_comment').safeParse({ reply: { text: 'oi' } });
    expect(result.success).toBe(false);
  });
  it('rejects a button on reply (post_comment never supports one)', () => {
    const result = schemaForType('post_comment').safeParse({
      triggerValue: 'p1', commentKeyword: 'k', publicReply: 'r',
      reply: { text: 'oi', buttonText: 'x', buttonUrl: 'https://x.com' },
    });
    expect(result.success).toBe(false);
  });
});

describe('schemaForType("icebreaker")', () => {
  it('requires icebreakerQuestion (max 80 chars) and at least one reply field', () => {
    expect(schemaForType('icebreaker').safeParse({ reply: {} }).success).toBe(false);
    expect(schemaForType('icebreaker').safeParse({ icebreakerQuestion: 'a'.repeat(81), reply: { text: 'oi' } }).success).toBe(false);
  });
});

describe('schemaForType("keyword_dm")', () => {
  it('requires triggerValue (the keyword) and at least one reply field', () => {
    expect(schemaForType('keyword_dm').safeParse({ reply: {} }).success).toBe(false);
  });
  it('requires both buttonText and buttonUrl, or neither', () => {
    const result = schemaForType('keyword_dm').safeParse({
      triggerValue: 'oi', reply: { text: 'x', buttonText: 'Entrar' },
    });
    expect(result.success).toBe(false);
  });
});

describe('schemaForType("default")', () => {
  it('only requires at least one reply field, no trigger', () => {
    expect(schemaForType('default').safeParse({ reply: { text: 'oi' } }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `pnpm test rule-type-schemas.test.ts`
Expected: FAIL — arquivo não existe.

- [ ] **Step 3: Implementar `rule-type-schemas.ts`**, portando exatamente as regras citadas (limites: `reply.text` máx. 2000, `reply.quickReplies` máx. 13 itens de até 13 caracteres cada, `reply.buttonText` máx. 20, `icebreakerQuestion` máx. 80, URL do botão deve começar com `https://`), uma função `schemaForType(type)` que retorna o schema já fixado pro tipo (sem o campo `type` em si, já que a rota fixa isso).

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `pnpm test rule-type-schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Escrever o teste falhando** de `rule-inline-form.test.tsx`:

```typescript
it('calls onDone after a successful create', async () => {
  const onDone = vi.fn();
  vi.spyOn(hooks, 'useCreateConversationRule').mockReturnValue({ mutate: (_, { onSuccess }) => onSuccess(), isPending: false } as any);
  render(<RuleInlineForm type="default" rule={null} onDone={onDone} />);
  await userEvent.type(screen.getByLabelText(/texto da mensagem/i), 'Olá!');
  await userEvent.click(screen.getByRole('button', { name: /criar/i }));
  expect(onDone).toHaveBeenCalled();
});

it('shows a validation error without calling the mutation when required fields are empty', async () => {
  const mutate = vi.fn();
  vi.spyOn(hooks, 'useCreateConversationRule').mockReturnValue({ mutate, isPending: false } as any);
  render(<RuleInlineForm type="keyword_dm" rule={null} onDone={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: /criar/i }));
  expect(mutate).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Rodar e confirmar que falham**

Run: `pnpm test rule-inline-form.test.tsx`
Expected: FAIL

- [ ] **Step 7: Implementar `RuleInlineForm`** — campos condicionais por `type` (post: `InstagramPostsPicker` equivalente ao do dashboard + palavra-chave + resposta pública; keyword_dm: palavra-chave; icebreaker: pergunta, com aviso quando já houver 4 ativas — contagem vem de `useConversationRules` filtrando `type === 'icebreaker' && isActive`; default: nenhum campo de trigger), mais os campos comuns de `reply` (texto, quick replies dinâmicas, botão opcional exceto em `post_comment`). Usa `react-hook-form` + `zodResolver(schemaForType(type))`. Anima entrada/saída com `motion` (`AnimatePresence` + altura automática).

- [ ] **Step 8: Rodar e confirmar que passam**

Run: `pnpm test rule-inline-form.test.tsx`
Expected: PASS

- [ ] **Step 9: Implementar `RuleList`** — lista as regras do tipo (via `useConversationRules` filtrado), cada item com `Switch` de ativar/desativar (`useUpdateConversationRule`) e botão excluir (`useDeleteConversationRule`, com confirmação simples); um botão "+ Nova regra" no topo que expande `RuleInlineForm` inline (estado local `creating: boolean`); "Editar" num item troca aquele item pelo form inline preenchido (estado local `editingId: string | null`) — igual à opção C escolhida nos mockups (sem modal, sem painel lateral).

- [ ] **Step 10: Implementar `app/(portal)/regras/[type]/page.tsx`** — valida que `params.type` é um dos 4 tipos válidos (`notFound()` caso contrário), breadcrumb "← Minhas Regras" voltando pra `/`, renderiza `<RuleList type={type} />`.

- [ ] **Step 11: Verificar manualmente**

Run: `pnpm dev`, navegar pela galeria até cada um dos 4 tipos, criar, editar e excluir uma regra de cada tipo, confirmar que a expansão é inline (sem modal/drawer) e que os totais na galeria atualizam ao voltar.

- [ ] **Step 12: Commit**

```bash
git add "app/(portal)/regras" components/rules
git commit -m "feat(rules): per-type drill-down with inline create/edit"
```

---

## O que fica a cargo de quem for construir

- Paleta de cores, tipografia e identidade visual exata do portal (a spec só pede "moderno, com animação, prático" — não herda necessariamente as cores do `trafegoflow-dashboard`).
- Ícone de cada tipo de regra na galeria.
- `InstagramPostsPicker` equivalente ao do dashboard (`trafegoflow-dashboard/components/conversation-rules/instagram-posts-picker.tsx`) — portar a lógica de paginação/seleção, adaptando pra não receber `pageId` por prop (vem do backend via token).
- Estados vazios e de erro detalhados além dos citados em Review Focus.
- Testes e2e (Playwright ou similar) — este plano cobre unitário/componente; e2e fica como evolução.
- Favicon, metadata, título da aba.
