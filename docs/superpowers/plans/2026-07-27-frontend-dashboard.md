# Dashboard ModeFlow — Frontend (trafegoflow-dashboard)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o repositório `trafegoflow-dashboard` (Next.js) com autenticação JWT, gestão completa de clientes e histórico de disparos de relatórios, com a identidade visual ModeFlow.

**Architecture:** Next.js 15 App Router. Login via Server Action que seta cookie httpOnly. Todas as chamadas à API NestJS passam por um Route Handler proxy em `/api/proxy/[...path]` que lê o cookie e injeta o Authorization header — assim o token nunca fica exposto no browser. TanStack Query gerencia cache client-side.

**Dependência:** O plano de backend (`2026-07-27-backend-expansion.md`) deve estar 100% concluído antes de iniciar este plano.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui, TanStack Query v5, TanStack Table v8, react-hook-form, zod

## Global Constraints

- Repo criado em `~/Github/trafegoflow-dashboard` (irmão de `trafegoflow`)
- API NestJS em `http://localhost:3000` em dev, configurável via `NEXT_PUBLIC_API_URL` (mas chamadas do proxy usam `API_URL` server-side)
- Identidade visual ModeFlow: Obsidiana `#141210`, Terracota `#C4523A`, Âmbar `#C9955A`, Creme `#F5EFE6`, Névoa `#B4AEA7`
- Tipografia: Cormorant Garamond (títulos de página), DM Sans (interface)
- Sidebar fundo Obsidiana, área de conteúdo fundo Creme
- Botões primários: bg Terracota, hover escurece 10%
- Nenhum `console.log` em produção — usar `process.env.NODE_ENV !== 'production'` para debug
- Todas as rotas exceto `/login` são protegidas pelo middleware

---

### Task 4: Setup do Repositório + Auth + Proxy

**Files:**
- Create: `package.json` (via create-next-app)
- Create: `middleware.ts`
- Create: `app/api/proxy/[...path]/route.ts`
- Create: `app/(auth)/login/page.tsx`
- Create: `app/actions/auth.ts`
- Create: `lib/api-client.ts`
- Modify: `tailwind.config.ts` — adicionar cores ModeFlow
- Modify: `app/globals.css` — CSS variables + fontes

**Interfaces:**
- Produces: `apiFetch(path, options)` — função base para todas as queries TanStack; cookie `auth-token` httpOnly como fonte de auth

---

- [ ] **Step 1: Criar o projeto Next.js**

```bash
cd ~/Github
npx create-next-app@15 trafegoflow-dashboard \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --import-alias "@/*" \
  --no-eslint
cd trafegoflow-dashboard
```

- [ ] **Step 2: Instalar dependências**

```bash
npm install @tanstack/react-query@5 @tanstack/react-table@8 \
  react-hook-form @hookform/resolvers zod \
  next-themes

npx shadcn@latest init
# Ao perguntar style: Default | Base color: Neutral | CSS variables: yes

npx shadcn@latest add button input label table badge toast \
  sheet dialog form select card separator skeleton dropdown-menu
```

- [ ] **Step 3: Instalar fontes ModeFlow**

```bash
npm install @fontsource/cormorant-garamond @fontsource/dm-sans
```

- [ ] **Step 4: Configurar cores ModeFlow no `tailwind.config.ts`**

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidiana: '#141210',
        terracota: '#C4523A',
        ambar: '#C9955A',
        creme: '#F5EFE6',
        nevoa: '#B4AEA7',
      },
      fontFamily: {
        display: ['Cormorant Garamond', 'serif'],
        sans: ['DM Sans', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
```

- [ ] **Step 5: Atualizar `app/globals.css`**

```css
/* app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@import '@fontsource/cormorant-garamond/300.css';
@import '@fontsource/cormorant-garamond/400.css';
@import '@fontsource/cormorant-garamond/300-italic.css';
@import '@fontsource/dm-sans/400.css';
@import '@fontsource/dm-sans/500.css';

:root {
  --background: #F5EFE6;
  --foreground: #141210;
}

body {
  background-color: var(--background);
  color: var(--foreground);
  font-family: 'DM Sans', sans-serif;
}
```

- [ ] **Step 6: Criar o proxy de API em `app/api/proxy/[...path]/route.ts`**

Este arquivo é o único que conhece a URL interna do NestJS. O browser nunca chama o NestJS diretamente.

```typescript
// app/api/proxy/[...path]/route.ts
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

async function handler(req: NextRequest, { params }: { params: { path: string[] } }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth-token')?.value;

  const path = params.path.join('/');
  const url = new URL(req.url);
  const targetUrl = `${API_URL}/${path}${url.search}`;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const body = req.method !== 'GET' && req.method !== 'HEAD'
    ? await req.text()
    : undefined;

  const res = await fetch(targetUrl, {
    method: req.method,
    headers,
    body,
  });

  const data = res.status !== 204 ? await res.text() : '';
  return new NextResponse(data || null, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
```

- [ ] **Step 7: Criar a Server Action de autenticação**

```typescript
// app/actions/auth.ts
'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

// prevState é exigido pelo useActionState — mesmo que não seja usado aqui
export async function loginAction(_prevState: { error: string } | undefined, formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    return { error: 'Email ou senha inválidos.' };
  }

  const { access_token } = await res.json();
  const cookieStore = await cookies();
  cookieStore.set('auth-token', access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 dias
  });

  redirect('/clientes');
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete('auth-token');
  redirect('/login');
}
```

- [ ] **Step 8: Criar o middleware de proteção de rotas**

```typescript
// middleware.ts
import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value;
  const isLoginPage = req.nextUrl.pathname === '/login';

  if (!token && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  if (token && isLoginPage) {
    return NextResponse.redirect(new URL('/clientes', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 9: Criar o cliente de API para TanStack Query**

```typescript
// lib/api-client.ts
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (res.status === 204) return undefined as T;

  const data = await res.json();
  if (!res.ok) throw new Error(data?.message ?? `Erro ${res.status}`);
  return data as T;
}
```

- [ ] **Step 10: Criar a página de login**

```typescript
// app/(auth)/login/page.tsx
'use client';
import { useActionState } from 'react';
import { loginAction } from '@/app/actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  // useActionState é o substituto de useFormState no React 19 / Next.js 15
  const [state, action, isPending] = useActionState(loginAction, undefined);

  return (
    <div className="min-h-screen bg-creme flex items-center justify-center">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <p className="text-sm tracking-widest text-nevoa uppercase mb-2">Performance que converte</p>
          <h1 className="font-display text-5xl font-light text-obsidiana">modeflow</h1>
        </div>

        <form action={action} className="space-y-4 bg-white/60 p-8 rounded-lg shadow-sm">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required placeholder="contato@modeflow.com.br" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input id="password" name="password" type="password" required />
          </div>
          {state?.error && (
            <p className="text-sm text-terracota">{state.error}</p>
          )}
          <Button
            type="submit"
            disabled={isPending}
            className="w-full bg-terracota hover:bg-terracota/90 text-creme"
          >
            {isPending ? 'Entrando...' : 'Entrar'}
          </Button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 11: Configurar `.env.local`**

```bash
# .env.local
API_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=ModeFlow Dashboard
```

- [ ] **Step 12: Testar o fluxo de login**

```bash
npm run dev
```

Abrir `http://localhost:3001`. Deve redirecionar para `/login`. Testar com credenciais válidas do NestJS — deve redirecionar para `/clientes` (que ainda não existe, mas o redirect deve acontecer).

- [ ] **Step 13: Commit**

```bash
git add .
git commit -m "feat: scaffold Next.js app with ModeFlow theme, auth, and API proxy"
```

---

### Task 5: Layout com Sidebar + Providers

**Files:**
- Create: `components/providers.tsx`
- Create: `components/layout/sidebar.tsx`
- Create: `app/(dashboard)/layout.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `logoutAction` de `app/actions/auth.ts`
- Produces: layout com sidebar disponível para todas as rotas em `(dashboard)`

---

- [ ] **Step 1: Criar o provider de TanStack Query**

```typescript
// components/providers.tsx
'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
```

- [ ] **Step 2: Atualizar `app/layout.tsx`**

```typescript
// app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: 'ModeFlow Dashboard',
  description: 'Gestão de clientes e relatórios ModeFlow',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Criar o componente sidebar**

```typescript
// components/layout/sidebar.tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users, FileText, LogOut } from 'lucide-react';
import { logoutAction } from '@/app/actions/auth';

const navItems = [
  { href: '/clientes', label: 'Clientes', icon: Users },
  { href: '/relatorios', label: 'Relatórios', icon: FileText },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 min-h-screen bg-obsidiana flex flex-col">
      <div className="px-6 py-8">
        <p className="text-nevoa text-xs tracking-widest uppercase mb-1">Performance</p>
        <span className="font-display text-2xl font-light text-creme">modeflow</span>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                active
                  ? 'bg-terracota text-creme'
                  : 'text-nevoa hover:text-creme hover:bg-white/10'
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-6">
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex items-center gap-3 px-3 py-2 w-full rounded-md text-sm text-nevoa hover:text-creme hover:bg-white/10 transition-colors"
          >
            <LogOut size={16} />
            Sair
          </button>
        </form>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Criar o layout do dashboard**

```typescript
// app/(dashboard)/layout.tsx
import { Sidebar } from '@/components/layout/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 bg-creme p-8 overflow-auto">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Instalar lucide-react**

```bash
npm install lucide-react
```

- [ ] **Step 6: Testar o layout**

Criar um arquivo temporário `app/(dashboard)/clientes/page.tsx` com `export default function Page() { return <p>Clientes</p> }` e verificar que a sidebar aparece com as cores corretas.

- [ ] **Step 7: Commit**

```bash
git add app/ components/
git commit -m "feat: add sidebar layout with ModeFlow visual identity and TanStack Query provider"
```

---

### Task 6: Página de Lista de Clientes

**Files:**
- Create: `types/client.ts`
- Create: `hooks/use-clients.ts`
- Create: `components/clients/clients-table.tsx`
- Modify: `app/(dashboard)/clientes/page.tsx`

**Interfaces:**
- Consumes: `apiFetch` de `lib/api-client.ts`; `GET /api/proxy/clients` → `ClientEntity[]`
- Produces: `useClients()` hook; página `/clientes` com tabela filtrável

---

- [ ] **Step 1: Criar os tipos compartilhados**

```typescript
// types/client.ts
export type BillingType = 'monthly' | 'quarterly' | 'semiannual' | 'annual';
export type PaymentMethod = 'pix' | 'boleto' | 'debit' | 'credit';
export type BillingStatus = 'paid' | 'pending' | 'overdue';
export type DiscountType = 'fixed' | 'percentage';

export interface ClientBilling {
  id: string;
  type: BillingType;
  amount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  paymentMethod: PaymentMethod;
  dueDay: number;
  status: BillingStatus;
  lastPaidAt: string | null;
}

export interface Client {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  phone: string | null;
  whatsappGroupCode: string | null;
  googleDriveFolderUrl: string | null;
  billing: ClientBilling | null;
  createdAt: string;
  updatedAt: string;
}

export interface DispatchLog {
  id: string;
  clientId: string;
  groupJid: string;
  adAccountId: string;
  weekStartDate: string;
  status: 'sent' | 'failed';
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface AdAccount {
  id: string;
  clientId: string;
  adAccountId: string;
  accountName: string | null;
  tokenExpiresAt: string | null;
  isActive: boolean;
}
```

- [ ] **Step 2: Criar o hook `useClients`**

```typescript
// hooks/use-clients.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { Client } from '@/types/client';

export function useClients() {
  return useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => apiFetch<Client[]>('/clients'),
  });
}

export function useClient(id: string) {
  return useQuery<Client>({
    queryKey: ['clients', id],
    queryFn: () => apiFetch<Client>(`/clients/${id}`),
    enabled: !!id,
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) =>
      apiFetch<Client>('/clients', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useUpdateClient(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) =>
      apiFetch<Client>(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['clients', id] });
    },
  });
}
```

- [ ] **Step 3: Criar o componente `clients-table.tsx`**

```typescript
// components/clients/clients-table.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Client } from '@/types/client';

const BILLING_STATUS_LABEL: Record<string, string> = {
  paid: 'Pago',
  pending: 'Pendente',
  overdue: 'Atrasado',
};

const BILLING_STATUS_VARIANT: Record<string, string> = {
  paid: 'bg-green-100 text-green-800',
  pending: 'bg-yellow-100 text-yellow-800',
  overdue: 'bg-red-100 text-red-800',
};

const col = createColumnHelper<Client>();

const columns = [
  col.accessor('name', { header: 'Nome' }),
  col.accessor('email', { header: 'Email' }),
  col.accessor('phone', { header: 'Telefone', cell: (i) => i.getValue() ?? '—' }),
  // accessorFn é necessário para campos nested — accessor string com dot notation não funciona em v8
  col.display({
    id: 'billing_amount',
    header: 'Mensalidade',
    cell: ({ row }) => {
      const v = row.original.billing?.amount;
      return v != null ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—';
    },
  }),
  col.display({
    id: 'billing_status',
    header: 'Pagamento',
    cell: ({ row }) => {
      const v = row.original.billing?.status;
      if (!v) return <span className="text-nevoa">—</span>;
      return (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${BILLING_STATUS_VARIANT[v] ?? ''}`}>
          {BILLING_STATUS_LABEL[v] ?? v}
        </span>
      );
    },
  }),
  col.accessor('isActive', {
    header: 'Status',
    cell: (i) => (
      <Badge className={i.getValue() ? 'bg-terracota text-white' : 'bg-nevoa text-white'}>
        {i.getValue() ? 'Ativo' : 'Inativo'}
      </Badge>
    ),
  }),
  col.display({
    id: 'actions',
    header: '',
    cell: ({ row }) => <ActionsCell id={row.original.id} />,
  }),
];

function ActionsCell({ id }: { id: string }) {
  const router = useRouter();
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="ghost" onClick={() => router.push(`/clientes/${id}`)}>
        Ver
      </Button>
      <Button size="sm" variant="ghost" onClick={() => router.push(`/clientes/${id}/editar`)}>
        Editar
      </Button>
    </div>
  );
}

export function ClientsTable({ data }: { data: Client[] }) {
  const [globalFilter, setGlobalFilter] = useState('');

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
  });

  return (
    <div className="space-y-4">
      <Input
        placeholder="Buscar por nome, email ou telefone..."
        value={globalFilter}
        onChange={(e) => setGlobalFilter(e.target.value)}
        className="max-w-sm bg-white"
      />
      <div className="rounded-lg border border-nevoa/30 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-creme hover:bg-creme">
                {hg.headers.map((h) => (
                  <TableHead key={h.id} className="text-obsidiana font-medium text-xs uppercase tracking-wider">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-nevoa py-8">
                  Nenhum cliente encontrado.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="hover:bg-creme/50">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Criar a página `/clientes`**

```typescript
// app/(dashboard)/clientes/page.tsx
'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ClientsTable } from '@/components/clients/clients-table';
import { useClients } from '@/hooks/use-clients';

export default function ClientesPage() {
  const { data, isLoading, error } = useClients();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl font-light text-obsidiana">Clientes</h1>
        <Button asChild className="bg-terracota hover:bg-terracota/90 text-white">
          <Link href="/clientes/novo">+ Novo Cliente</Link>
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      )}

      {error && (
        <p className="text-terracota">Erro ao carregar clientes. Tente novamente.</p>
      )}

      {data && <ClientsTable data={data} />}
    </div>
  );
}
```

- [ ] **Step 5: Testar no browser**

```bash
npm run dev
```

Navegar para `/clientes`. A tabela deve exibir os clientes do NestJS. Testar a busca por nome/email.

- [ ] **Step 6: Commit**

```bash
git add types/ hooks/use-clients.ts components/clients/clients-table.tsx app/\(dashboard\)/clientes/page.tsx
git commit -m "feat: add clients list page with filterable TanStack Table"
```

---

### Task 7: Formulário de Cadastro e Edição de Cliente

**Files:**
- Create: `components/clients/client-form.tsx`
- Create: `app/(dashboard)/clientes/novo/page.tsx`
- Create: `app/(dashboard)/clientes/[id]/editar/page.tsx`

**Interfaces:**
- Consumes: `useCreateClient()`, `useUpdateClient(id)`, `useClient(id)` de `hooks/use-clients.ts`
- Produces: formulário validado com zod, campos de dados do cliente + billing

---

- [ ] **Step 1: Criar o componente `client-form.tsx`**

```typescript
// components/clients/client-form.tsx
'use client';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type { Client } from '@/types/client';

const schema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(200),
  email: z.string().email('Email inválido'),
  phone: z.string().optional(),
  whatsappGroupCode: z.string().optional(),
  googleDriveFolderUrl: z.string().url('URL inválida').optional().or(z.literal('')),
  billing: z.object({
    type: z.enum(['monthly', 'quarterly', 'semiannual', 'annual']),
    amount: z.coerce.number().positive('Valor deve ser positivo'),
    discountType: z.enum(['fixed', 'percentage']).optional(),
    discountValue: z.coerce.number().optional(),
    paymentMethod: z.enum(['pix', 'boleto', 'debit', 'credit']),
    dueDay: z.coerce.number().int().min(1).max(31),
    status: z.enum(['paid', 'pending', 'overdue']),
  }).optional(),
});

type FormValues = z.infer<typeof schema>;

interface ClientFormProps {
  defaultValues?: Partial<FormValues>;
  onSubmit: (data: FormValues) => Promise<void>;
  isSubmitting: boolean;
  submitLabel: string;
}

const BILLING_TYPE_LABEL = { monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual' };
const PAYMENT_METHOD_LABEL = { pix: 'Pix', boleto: 'Boleto', debit: 'Débito', credit: 'Crédito' };
const BILLING_STATUS_LABEL = { paid: 'Pago', pending: 'Pendente', overdue: 'Atrasado' };
const DISCOUNT_TYPE_LABEL = { fixed: 'Valor fixo (R$)', percentage: 'Percentual (%)' };

export function ClientForm({ defaultValues, onSubmit, isSubmitting, submitLabel }: ClientFormProps) {
  const router = useRouter();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 max-w-2xl">

        <section className="space-y-4">
          <h2 className="font-display text-2xl font-light text-obsidiana">Dados do Cliente</h2>
          <Separator className="bg-nevoa/30" />

          <div className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>Nome *</FormLabel>
                <FormControl><Input {...field} placeholder="Agência XYZ" className="bg-white" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email *</FormLabel>
                <FormControl><Input {...field} type="email" placeholder="contato@agencia.com" className="bg-white" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="phone" render={({ field }) => (
              <FormItem>
                <FormLabel>Telefone</FormLabel>
                <FormControl><Input {...field} placeholder="(32) 99999-0000" className="bg-white" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="whatsappGroupCode" render={({ field }) => (
              <FormItem>
                <FormLabel>Código do Grupo WhatsApp</FormLabel>
                <FormControl><Input {...field} placeholder="120363000000000000@g.us" className="bg-white" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="googleDriveFolderUrl" render={({ field }) => (
              <FormItem>
                <FormLabel>Pasta Google Drive</FormLabel>
                <FormControl><Input {...field} placeholder="https://drive.google.com/drive/folders/..." className="bg-white" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-2xl font-light text-obsidiana">Faturamento</h2>
          <Separator className="bg-nevoa/30" />

          <div className="grid grid-cols-2 gap-4">
            {(['type', 'paymentMethod', 'status'] as const).map((name) => {
              const labels = name === 'type' ? BILLING_TYPE_LABEL : name === 'paymentMethod' ? PAYMENT_METHOD_LABEL : BILLING_STATUS_LABEL;
              const labelText = name === 'type' ? 'Periodicidade' : name === 'paymentMethod' ? 'Forma de Pagamento' : 'Status';
              return (
                <FormField key={name} control={form.control} name={`billing.${name}` as any} render={({ field }) => (
                  <FormItem>
                    <FormLabel>{labelText}</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger className="bg-white"><SelectValue placeholder="Selecionar" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {Object.entries(labels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              );
            })}

            <FormField control={form.control} name="billing.amount" render={({ field }) => (
              <FormItem>
                <FormLabel>Valor (R$)</FormLabel>
                <FormControl><Input {...field} type="number" step="0.01" placeholder="1500.00" className="bg-white" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="billing.dueDay" render={({ field }) => (
              <FormItem>
                <FormLabel>Dia de Vencimento</FormLabel>
                <FormControl><Input {...field} type="number" min={1} max={31} placeholder="10" className="bg-white" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="billing.discountType" render={({ field }) => (
              <FormItem>
                <FormLabel>Tipo de Desconto</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger className="bg-white"><SelectValue placeholder="Sem desconto" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {Object.entries(DISCOUNT_TYPE_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="billing.discountValue" render={({ field }) => (
              <FormItem>
                <FormLabel>Valor do Desconto</FormLabel>
                <FormControl><Input {...field} type="number" step="0.01" placeholder="0" className="bg-white" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </section>

        <div className="flex gap-3">
          <Button type="submit" disabled={isSubmitting} className="bg-terracota hover:bg-terracota/90 text-white">
            {isSubmitting ? 'Salvando...' : submitLabel}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancelar
          </Button>
        </div>
      </form>
    </Form>
  );
}
```

- [ ] **Step 2: Criar a página de cadastro**

```typescript
// app/(dashboard)/clientes/novo/page.tsx
'use client';
import { useRouter } from 'next/navigation';
import { ClientForm } from '@/components/clients/client-form';
import { useCreateClient } from '@/hooks/use-clients';

export default function NovoClientePage() {
  const router = useRouter();
  const { mutateAsync, isPending } = useCreateClient();

  async function handleSubmit(data: any) {
    await mutateAsync(data);
    router.push('/clientes');
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-4xl font-light text-obsidiana">Novo Cliente</h1>
      <ClientForm onSubmit={handleSubmit} isSubmitting={isPending} submitLabel="Cadastrar Cliente" />
    </div>
  );
}
```

- [ ] **Step 3: Criar a página de edição**

```typescript
// app/(dashboard)/clientes/[id]/editar/page.tsx
'use client';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { ClientForm } from '@/components/clients/client-form';
import { useClient, useUpdateClient } from '@/hooks/use-clients';
import { Skeleton } from '@/components/ui/skeleton';

export default function EditarClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: client, isLoading } = useClient(id);
  const { mutateAsync, isPending } = useUpdateClient(id);

  async function handleSubmit(data: any) {
    await mutateAsync(data);
    router.push(`/clientes/${id}`);
  }

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (!client) return <p className="text-terracota">Cliente não encontrado.</p>;

  const defaultValues = {
    name: client.name,
    email: client.email,
    phone: client.phone ?? undefined,
    whatsappGroupCode: client.whatsappGroupCode ?? undefined,
    googleDriveFolderUrl: client.googleDriveFolderUrl ?? undefined,
    billing: client.billing ? {
      type: client.billing.type,
      amount: client.billing.amount,
      discountType: client.billing.discountType ?? undefined,
      discountValue: client.billing.discountValue ?? undefined,
      paymentMethod: client.billing.paymentMethod,
      dueDay: client.billing.dueDay,
      status: client.billing.status,
    } : undefined,
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-4xl font-light text-obsidiana">Editar Cliente</h1>
      <ClientForm defaultValues={defaultValues} onSubmit={handleSubmit} isSubmitting={isPending} submitLabel="Salvar Alterações" />
    </div>
  );
}
```

- [ ] **Step 4: Testar create e edit no browser**

Criar um novo cliente com billing e verificar que aparece na lista. Editar e verificar que os dados são preservados no formulário.

- [ ] **Step 5: Commit**

```bash
git add components/clients/client-form.tsx \
        app/\(dashboard\)/clientes/novo/ \
        app/\(dashboard\)/clientes/\[id\]/editar/
git commit -m "feat: add client create/edit form with billing fields"
```

---

### Task 8: Perfil do Cliente

**Files:**
- Create: `hooks/use-dispatches.ts`
- Create: `hooks/use-ad-accounts.ts`
- Create: `components/reports/dispatch-history.tsx`
- Create: `app/(dashboard)/clientes/[id]/page.tsx`

**Interfaces:**
- Consumes: `useClient(id)`, `GET /api/proxy/ad-accounts?clientId=`, `GET /api/proxy/report-dispatches?clientId=`
- Produces: página de perfil com 3 seções independentes (dados, contas, dispatches)

---

- [ ] **Step 1: Criar `hooks/use-ad-accounts.ts`**

```typescript
// hooks/use-ad-accounts.ts
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { AdAccount } from '@/types/client';

export function useAdAccounts(clientId: string) {
  return useQuery<AdAccount[]>({
    queryKey: ['ad-accounts', clientId],
    queryFn: () => apiFetch<AdAccount[]>(`/ad-accounts?clientId=${clientId}`),
    enabled: !!clientId,
  });
}
```

- [ ] **Step 2: Criar `hooks/use-dispatches.ts`**

```typescript
// hooks/use-dispatches.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { DispatchLog } from '@/types/client';

export function useDispatchLogs(clientId?: string) {
  const path = clientId ? `/report-dispatches?clientId=${clientId}` : '/report-dispatches';
  return useQuery<DispatchLog[]>({
    queryKey: ['dispatches', clientId ?? 'all'],
    queryFn: () => apiFetch<DispatchLog[]>(path),
  });
}

export function useTriggerDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId?: string) =>
      apiFetch<{ dispatched: number; failed: number }>('/report-dispatches/trigger', {
        method: 'POST',
        body: JSON.stringify(clientId ? { clientId } : {}),
      }),
    onSuccess: (_, clientId) => {
      qc.invalidateQueries({ queryKey: ['dispatches', clientId ?? 'all'] });
      if (clientId) qc.invalidateQueries({ queryKey: ['dispatches', clientId] });
    },
  });
}
```

- [ ] **Step 3: Criar o componente `dispatch-history.tsx`**

```typescript
// components/reports/dispatch-history.tsx
'use client';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { DispatchLog } from '@/types/client';

const STATUS_STYLE = {
  sent: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

const STATUS_LABEL = { sent: 'Enviado', failed: 'Falhou' };

export function DispatchHistory({ logs }: { logs: DispatchLog[] }) {
  if (!logs.length) {
    return <p className="text-nevoa text-sm">Nenhum disparo registrado.</p>;
  }

  return (
    <div className="space-y-2">
      {logs.map((log) => (
        <div key={log.id} className="flex items-start gap-4 p-3 bg-white rounded-lg border border-nevoa/20">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_STYLE[log.status]}`}>
            {STATUS_LABEL[log.status]}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-obsidiana truncate">Conta: {log.adAccountId}</p>
            <p className="text-xs text-nevoa">
              Semana de {log.weekStartDate} · {log.sentAt ? format(new Date(log.sentAt), "d 'de' MMM, HH:mm", { locale: ptBR }) : '—'}
            </p>
            {log.errorMessage && (
              <p className="text-xs text-terracota mt-1 truncate">{log.errorMessage}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Instalar date-fns**

```bash
npm install date-fns
```

- [ ] **Step 5: Criar a página de perfil**

```typescript
// app/(dashboard)/clientes/[id]/page.tsx
'use client';
import { use } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DispatchHistory } from '@/components/reports/dispatch-history';
import { useClient } from '@/hooks/use-clients';
import { useAdAccounts } from '@/hooks/use-ad-accounts';
import { useDispatchLogs, useTriggerDispatch } from '@/hooks/use-dispatches';

const BILLING_TYPE_LABEL: Record<string, string> = {
  monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual',
};

export default function ClienteProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: client, isLoading: loadingClient } = useClient(id);
  const { data: accounts, isLoading: loadingAccounts } = useAdAccounts(id);
  const { data: logs, isLoading: loadingLogs } = useDispatchLogs(id);
  const { mutate: trigger, isPending: triggering, data: triggerResult } = useTriggerDispatch();

  if (loadingClient) return <Skeleton className="h-64 w-full" />;
  if (!client) return <p className="text-terracota">Cliente não encontrado.</p>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl font-light text-obsidiana">{client.name}</h1>
          <p className="text-nevoa">{client.email}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/clientes/${id}/editar`}>Editar</Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Dados */}
        <section className="bg-white rounded-lg p-6 border border-nevoa/20 space-y-3">
          <h2 className="font-medium text-obsidiana">Dados</h2>
          <dl className="space-y-2 text-sm">
            {[
              ['Telefone', client.phone ?? '—'],
              ['WhatsApp Group', client.whatsappGroupCode ?? '—'],
              ['Google Drive', client.googleDriveFolderUrl
                ? <a href={client.googleDriveFolderUrl} target="_blank" rel="noreferrer" className="text-terracota underline">Abrir pasta</a>
                : '—'],
            ].map(([label, value]) => (
              <div key={label as string} className="flex gap-2">
                <dt className="text-nevoa w-28 shrink-0">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Billing */}
        {client.billing && (
          <section className="bg-white rounded-lg p-6 border border-nevoa/20 space-y-3">
            <h2 className="font-medium text-obsidiana">Faturamento</h2>
            <dl className="space-y-2 text-sm">
              {[
                ['Tipo', BILLING_TYPE_LABEL[client.billing.type]],
                ['Mensalidade', `R$ ${Number(client.billing.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`],
                ['Vencimento', `Dia ${client.billing.dueDay}`],
                ['Status', client.billing.status],
              ].map(([label, value]) => (
                <div key={label as string} className="flex gap-2">
                  <dt className="text-nevoa w-28 shrink-0">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>

      {/* Contas Meta Ads */}
      <section className="bg-white rounded-lg p-6 border border-nevoa/20">
        <h2 className="font-medium text-obsidiana mb-4">Contas Meta Ads</h2>
        {loadingAccounts ? <Skeleton className="h-12 w-full" /> : (
          accounts?.length ? (
            <div className="space-y-2">
              {accounts.map((acc) => (
                <div key={acc.id} className="flex items-center gap-3 text-sm">
                  <span className={`w-2 h-2 rounded-full ${acc.isActive ? 'bg-green-500' : 'bg-nevoa'}`} />
                  <span>{acc.accountName ?? acc.adAccountId}</span>
                  {!acc.isActive && <span className="text-xs text-terracota">Desconectada</span>}
                </div>
              ))}
            </div>
          ) : <p className="text-nevoa text-sm">Nenhuma conta vinculada.</p>
        )}
      </section>

      {/* Histórico de Disparos */}
      <section className="bg-white rounded-lg p-6 border border-nevoa/20">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-obsidiana">Histórico de Relatórios</h2>
          <div className="flex items-center gap-3">
            {triggerResult && (
              <span className="text-xs text-nevoa">
                {triggerResult.dispatched} enviado(s), {triggerResult.failed} falha(s)
              </span>
            )}
            <Button
              size="sm"
              onClick={() => trigger(id)}
              disabled={triggering}
              className="bg-terracota hover:bg-terracota/90 text-white"
            >
              {triggering ? 'Disparando...' : 'Disparar agora'}
            </Button>
          </div>
        </div>
        {loadingLogs ? <Skeleton className="h-32 w-full" /> : <DispatchHistory logs={logs ?? []} />}
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Testar o perfil no browser**

Navegar para `/clientes/<id>`. As 3 seções devem carregar independentemente. Testar o botão "Disparar agora" — deve aparecer o resultado e o histórico deve atualizar.

- [ ] **Step 7: Commit**

```bash
git add hooks/ components/reports/dispatch-history.tsx app/\(dashboard\)/clientes/\[id\]/page.tsx
git commit -m "feat: add client profile with ad accounts, billing summary, and dispatch history"
```

---

### Task 9: Página de Histórico Geral de Relatórios

**Files:**
- Create: `app/(dashboard)/relatorios/page.tsx`

**Interfaces:**
- Consumes: `useDispatchLogs()` sem clientId, `useTriggerDispatch()` de `hooks/use-dispatches.ts`
- Produces: página `/relatorios` com histórico de todos os clientes + trigger global

---

- [ ] **Step 1: Criar a página `/relatorios`**

```typescript
// app/(dashboard)/relatorios/page.tsx
'use client';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useDispatchLogs, useTriggerDispatch } from '@/hooks/use-dispatches';

const STATUS_STYLE: Record<string, string> = {
  sent: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

const STATUS_LABEL: Record<string, string> = { sent: 'Enviado', failed: 'Falhou' };

export default function RelatoriosPage() {
  const { data: logs, isLoading } = useDispatchLogs();
  const { mutate: trigger, isPending, data: result } = useTriggerDispatch();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl font-light text-obsidiana">Relatórios</h1>
        <div className="flex items-center gap-4">
          {result && (
            <span className="text-sm text-nevoa">
              Último disparo: {result.dispatched} enviado(s), {result.failed} falha(s)
            </span>
          )}
          <Button
            onClick={() => trigger(undefined)}
            disabled={isPending}
            className="bg-terracota hover:bg-terracota/90 text-white"
          >
            {isPending ? 'Disparando para todos...' : 'Disparar para todos'}
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      )}

      {logs && logs.length === 0 && (
        <p className="text-nevoa">Nenhum disparo registrado ainda.</p>
      )}

      {logs && logs.length > 0 && (
        <div className="bg-white rounded-lg border border-nevoa/20 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-creme">
              <tr>
                {['Status', 'Cliente', 'Conta', 'Semana', 'Enviado em', 'Erro'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-nevoa uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-nevoa/10">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-creme/50">
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[log.status]}`}>
                      {STATUS_LABEL[log.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-obsidiana truncate max-w-[120px]">{log.clientId}</td>
                  <td className="px-4 py-3 text-nevoa truncate max-w-[160px]">{log.adAccountId}</td>
                  <td className="px-4 py-3 text-nevoa">{log.weekStartDate}</td>
                  <td className="px-4 py-3 text-nevoa">
                    {log.sentAt ? format(new Date(log.sentAt), "d MMM, HH:mm", { locale: ptBR }) : '—'}
                  </td>
                  <td className="px-4 py-3 text-terracota text-xs truncate max-w-[200px]">
                    {log.errorMessage ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Testar no browser**

Navegar para `/relatorios`. A tabela deve exibir todos os logs. Testar "Disparar para todos" — o resultado deve aparecer e a tabela deve atualizar.

- [ ] **Step 3: Commit final**

```bash
git add app/\(dashboard\)/relatorios/page.tsx
git commit -m "feat: add general reports history page with global dispatch trigger"
```
