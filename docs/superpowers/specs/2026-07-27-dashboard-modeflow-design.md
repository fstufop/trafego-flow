# Dashboard ModeFlow — Design Spec

**Data:** 2026-07-27
**Escopo:** MVP — Slice A (Gestão de Clientes) + Slice B (Relatórios e Disparos)
**Status:** Aprovado para implementação

---

## 1. Visão Geral

Dashboard interno da ModeFlow para gestão operacional de clientes e controle de disparos de relatórios semanais via WhatsApp. Substitui o processo manual atual de acompanhamento de mensalidades, vínculos de contas e envio de relatórios.

**O que entra neste MVP:**
- CRUD completo de clientes com campos operacionais (telefone, WhatsApp, Google Drive)
- Gestão de billing por cliente (tipo de recorrência, valor, desconto, forma de pagamento)
- Visualização de contas Meta Ads vinculadas por cliente
- Histórico de disparos de relatórios por cliente
- Trigger manual de disparo de relatório
- Histórico geral de todos os disparos

**O que fica fora deste MVP:**
- Dashboard de performance (KPIs, gráficos Meta Ads)
- Editor de templates de relatório
- Agendamento de relatórios via UI
- Sistema de notificações
- Integração Google Ads

---

## 2. Arquitetura

```
┌─────────────────────────────┐     REST + JWT      ┌──────────────────────────┐
│  trafegoflow-dashboard      │ ──────────────────► │  trafegoflow (NestJS)    │
│  Next.js App Router         │                     │  API existente + expansão│
│  shadcn/ui + TanStack Query │                     │  PostgreSQL + Redis       │
└─────────────────────────────┘                     └──────────────────────────┘
         (novo repo)                                        (este repo)
```

**Dois repositórios com responsabilidade única cada:**
- `trafegoflow` — backend NestJS, expande entidades e endpoints por slice
- `trafegoflow-dashboard` — Next.js App Router, consome a API via JWT Bearer

**Deploy alvo:** Dashboard na Vercel, backend onde já está.

---

## 3. Identidade Visual (ModeFlow)

| Token | Hex | Uso |
|---|---|---|
| Obsidiana | `#141210` | Sidebar, fundos escuros, texto principal |
| Terracota | `#C4523A` | Botões primários, badges, CTAs |
| Âmbar | `#C9955A` | Acento secundário, ícones de estado |
| Creme | `#F5EFE6` | Fundo principal (área de conteúdo) |
| Névoa | `#B4AEA7` | Textos secundários, bordas, placeholders |

**Tipografia:**
- **Cormorant Garamond** — títulos de página (display)
- **DM Sans** — todo o restante: labels, tabelas, botões, formulários

**Layout geral:**
```
┌──────────────────┬────────────────────────────────────────┐
│  SIDEBAR         │  CONTEÚDO                              │
│  bg #141210      │  bg #F5EFE6                            │
│                  │                                        │
│  M modeflow      │  [Título Cormorant Garamond]           │
│  ─────────────   │                                        │
│  • Clientes      │  [Tabela / Formulário / Perfil]        │
│  • Relatórios    │  DM Sans, texto #141210                │
│  • Contas        │                                        │
│                  │  Botões primários: bg #C4523A          │
│  [avatar]        │  Badges status: variantes Terracota    │
│  Filipe          │                                        │
└──────────────────┴────────────────────────────────────────┘
```

---

## 4. Stack Frontend

| Pacote | Função |
|---|---|
| Next.js 15 (App Router) | Framework, roteamento, Server Actions |
| shadcn/ui | Componentes base (Table, Form, Dialog, Badge, Toast) |
| TanStack Query | Cache e estado de servidor |
| TanStack Table | Tabelas com filtros e ordenação |
| Recharts | Gráficos (fase futura — já incluso na dep) |

---

## 5. Mudanças no Backend (trafegoflow)

### 5.1 Expansão do `ClientEntity`

Campos novos em `clients`:

| Campo | Tipo | Observação |
|---|---|---|
| `phone` | varchar, nullable | Telefone com DDD |
| `whatsappGroupCode` | varchar, nullable | JID do grupo WhatsApp |
| `googleDriveFolderUrl` | varchar, nullable | URL da pasta no Drive |

### 5.2 Nova entidade `ClientBillingEntity`

Tabela: `client_billings` (1:1 com `clients`)

| Campo | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | |
| `clientId` | FK → clients | unique |
| `type` | enum | `MONTHLY \| QUARTERLY \| SEMIANNUAL \| ANNUAL` |
| `amount` | decimal(10,2) | Valor cheio |
| `discountType` | enum, nullable | `FIXED \| PERCENTAGE` |
| `discountValue` | decimal(10,2), nullable | Valor do desconto |
| `paymentMethod` | enum | `PIX \| BOLETO \| DEBIT \| CREDIT` |
| `dueDay` | integer (1–31) | Dia do mês de vencimento |
| `status` | enum | `PAID \| PENDING \| OVERDUE` |
| `lastPaidAt` | timestamptz, nullable | Data do último pagamento |

`ClientEntity` ganha `@OneToOne(() => ClientBillingEntity) billing`.

### 5.3 Novo endpoint

| Endpoint | Descrição |
|---|---|
| `GET /clients/:id/ad-accounts` | Lista contas Meta Ads de um cliente |

### 5.4 Endpoints existentes reutilizados / ajustados

| Endpoint | Status |
|---|---|
| `GET /clients` | OK |
| `POST /clients` | OK — DTOs serão expandidos |
| `GET /clients/:id` | OK |
| `PATCH /clients/:id` | OK |
| `DELETE /clients/:id` | OK |
| `GET /report-dispatches?clientId=` | Ajuste: tornar `clientId` opcional — sem ele retorna todos os logs (necessário para `/relatorios`) |
| `POST /report-dispatches/trigger` | OK |

---

## 6. Rotas do Dashboard

| Rota | Tela |
|---|---|
| `/login` | Formulário de autenticação JWT |
| `/clientes` | Listagem com filtros (status, busca por nome/email) |
| `/clientes/novo` | Formulário de cadastro (dados + billing) |
| `/clientes/[id]` | Perfil: dados, billing, contas vinculadas, histórico de disparos |
| `/clientes/[id]/editar` | Formulário de edição |
| `/relatorios` | Histórico geral de disparos + trigger manual |

---

## 7. Autenticação

1. Usuário posta credenciais em `/login`
2. Server Action chama `POST /auth/login` no NestJS
3. JWT retornado é armazenado em cookie `httpOnly` (inacessível por JS no cliente)
4. Middleware Next.js lê o cookie e injeta `Authorization: Bearer <token>` em todas as chamadas à API
5. Resposta `401` → redirect automático para `/login`

---

## 8. Fluxo de Dados por Tela

### `/clientes` (listagem)
- `GET /clients` via TanStack Query
- TanStack Table renderiza com filtro client-side por status e busca textual
- Paginação server-side entra quando volume justificar (fora do MVP)

### `/clientes/[id]` (perfil)
Três queries em paralelo:
- `GET /clients/:id` — dados cadastrais + billing
- `GET /clients/:id/ad-accounts` — contas Meta vinculadas
- `GET /report-dispatches?clientId=:id` — histórico de disparos

Cada seção renderiza com seu próprio loading state — sem bloquear a tela inteira.

### `/relatorios` (histórico geral)
- `GET /report-dispatches` (sem filtro de cliente) — histórico completo
- Botão "Disparar agora" → `POST /report-dispatches/trigger` → toast de sucesso/erro → invalidate query

---

## 9. Tratamento de Erros

| Situação | Comportamento |
|---|---|
| Token expirado (401) | Redirect automático para `/login` |
| Cliente não encontrado (404) | Mensagem inline na página, sem crash |
| Falha no disparo de relatório | Toast de erro com `errorMessage` retornado pelo log |
| Conta Meta desconectada | Badge de aviso "Desconectada" no perfil do cliente |

---

## 10. Sequência de Implementação (Slices)

| Slice | Backend | Frontend |
|---|---|---|
| **1** | Migration + expansão ClientEntity + ClientBillingEntity + DTOs | Lista de clientes + formulário de cadastro/edição |
| **2** | Endpoint `GET /clients/:id/ad-accounts` | Perfil do cliente (dados + billing + contas) |
| **3** | — (já existe) | Histórico de disparos no perfil + trigger manual |
| **4** | — (já existe) | Página `/relatorios` com histórico geral |

Cada slice entrega valor funcional completo end-to-end antes do próximo começar.
