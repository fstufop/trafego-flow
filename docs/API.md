# TrafegoFlow API — Documentação

**Versão:** 2.0  
**Base URL:** `http://localhost:3002` (desenvolvimento)  
**Documentação interativa (Swagger):** `GET /docs`

---

## Sumário

1. [O que é esta API](#1-o-que-é-esta-api)
2. [Como a API funciona](#2-como-a-api-funciona)
3. [Pré-requisitos e configuração](#3-pré-requisitos-e-configuração)
4. [Variáveis de ambiente](#4-variáveis-de-ambiente)
5. [Autenticação](#5-autenticação)
6. [Passo a passo para colocar em funcionamento](#6-passo-a-passo-para-colocar-em-funcionamento)
7. [Módulos e endpoints](#7-módulos-e-endpoints)
   - [Health](#71-health)
   - [Auth (Autenticação JWT)](#72-auth-autenticação-jwt)
   - [Clients (Clientes)](#73-clients-clientes)
   - [Integrations (Integrações Meta)](#74-integrations-integrações-meta)
   - [Ad Accounts (Contas de Anúncio)](#75-ad-accounts-contas-de-anúncio)
   - [Campaign Reports (Relatórios de Campanhas)](#76-campaign-reports-relatórios-de-campanhas)
   - [WhatsApp Groups (Grupos WhatsApp)](#77-whatsapp-groups-grupos-whatsapp)
   - [WhatsApp Session (Sessão WhatsApp)](#78-whatsapp-session-sessão-whatsapp)
   - [Report Dispatches (Envio de Relatórios)](#79-report-dispatches-envio-de-relatórios)
   - [Media Library (Biblioteca de Mídia)](#710-media-library-biblioteca-de-mídia)
   - [Ad Library (Biblioteca de Anúncios Meta)](#711-ad-library-biblioteca-de-anúncios-meta)
   - [Adset Alerts (Alertas de Adsets)](#712-adset-alerts-alertas-de-adsets)
   - [Alert Jobs (Jobs de Alerta)](#713-alert-jobs-jobs-de-alerta)
   - [Webhook Instagram](#714-webhook-instagram)
8. [Modelos de dados](#8-modelos-de-dados)
9. [Cache e performance](#9-cache-e-performance)
10. [Monitoramento de tokens](#10-monitoramento-de-tokens)
11. [Erros comuns](#11-erros-comuns)
12. [Limitações conhecidas](#12-limitações-conhecidas)

---

## 1. O que é esta API

O TrafegoFlow é uma plataforma backend para gestores de tráfego que gerenciam campanhas pagas no Meta (Facebook/Instagram). A API oferece:

- **Gestão de clientes** — cadastro de clientes com billing, perfil de IA e links de integração
- **Integrações de mensageria** — recebimento de mensagens do Instagram e WhatsApp via webhook
- **Relatórios de campanhas** — consumo da Marketing API da Meta para buscar dados de campanhas, insights e métricas
- **Envio automatizado de relatórios** — despacho semanal de relatórios gerados por IA para grupos WhatsApp dos clientes
- **Biblioteca de mídia** — upload de criativos para Google Drive e Meta Ads simultaneamente
- **Biblioteca de anúncios** — pesquisa de concorrentes na Meta Ad Library pública
- **Alertas de adsets** — monitoramento automático de métricas de adsets com alertas via WhatsApp
- **Monitoramento de tokens** — alertas automáticos sobre tokens de acesso prestes a vencer

A arquitetura é **multi-tenant**: cada cliente possui seus próprios tokens, contas de anúncio e integrações, completamente isolados entre si.

---

## 2. Como a API funciona

```
                        ┌──────────────────────────────────────────────────────┐
                        │              TrafegoFlow API (NestJS)                 │
                        │                                                       │
Seu frontend/sistema ──►│  POST /api/v1/auth/login          ← JWT              │
                        │  POST /api/v1/clients                                 │──► PostgreSQL
                        │  POST /api/v1/ad-accounts                            │
                        │  GET  /api/v1/campaign-reports/...                   │──► Redis (cache)
                        │  POST /api/v1/whatsapp-groups                        │
                        │  POST /api/v1/report-dispatches/trigger              │──► WhatsApp (Baileys)
                        │  POST /api/v1/media-library/upload                   │──► Google Drive
                        │  GET  /api/v1/ad-library/search                      │──► Meta Ad Library
                        │                                                       │
Meta (Facebook/Insta) ──►│  POST /webhook/instagram                             │──► Meta Marketing API
                        │  GET  /webhook/instagram (verificação)               │
                        └──────────────────────────────────────────────────────┘
```

**Fluxo típico:**
1. Faça login com email/senha e obtenha um JWT, **ou** use a `MASTER_API_KEY`
2. Cadastre um **cliente** (gestor ou agência) com billing e perfil
3. Adicione as **integrações** de Instagram/WhatsApp e as **contas de anúncio** Meta Ads
4. Cadastre os **grupos WhatsApp** do cliente para receber relatórios
5. Consulte **relatórios de campanhas** em tempo real (com cache Redis)
6. Dispare o **envio de relatórios** manualmente ou aguarde o job semanal
7. Faça **upload de mídias** para criativo que serão enviadas ao Google Drive e à Meta Ads

**Tokens e segurança:**
- Todos os access tokens são criptografados com AES-256-GCM antes de serem persistidos no banco
- Tokens nunca aparecem em respostas da API (excluídos pelo `ClassSerializerInterceptor`)
- A autenticação da API aceita `MASTER_API_KEY` no header `x-api-key` **ou** JWT Bearer no header `Authorization`

---

## 3. Pré-requisitos e configuração

### Dependências de infraestrutura

| Serviço | Versão mínima | Finalidade |
|---------|---------------|------------|
| Node.js | 20+ | Runtime |
| PostgreSQL | 14+ | Banco de dados principal |
| Redis | 7+ | Cache de respostas da Meta API |

### Dependências externas (Meta)

Para usar os módulos de webhook e relatórios, você precisa de:

- **Meta App** criado em [developers.facebook.com](https://developers.facebook.com)
  - `App Secret` (para validar webhooks)
  - `Verify Token` (string que você define e configura no painel)
- **User Access Token** de longa duração (para Marketing API)
  - Permissões necessárias: `ads_read`
  - Gerado via Meta Business Manager ou OAuth
- **System User Token** (para Meta Ad Library — dados públicos, sem escopo de cliente)
- **Page Access Token** (para Instagram/WhatsApp messaging)
  - Gerado a partir do User Token com acesso à página

---

## 4. Variáveis de ambiente

Copie `.env.example` para `.env` e preencha todos os valores.

```bash
cp .env.example .env
```

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `MASTER_API_KEY` | Chave mestra para autenticar chamadas à API | `my-secret-api-key-2024` |
| `DATABASE_URL` | URL de conexão PostgreSQL | `postgresql://user:pass@localhost:5432/trafegoflow` |
| `REDIS_URL` | URL de conexão Redis | `redis://:password@localhost:6379` |
| `ENCRYPTION_KEY` | Chave AES-256-GCM para criptografar tokens (64 caracteres hex) | *(veja abaixo)* |
| `META_APP_SECRET` | App Secret do Facebook Developer Console | `abc123...` |
| `META_VERIFY_TOKEN` | Token de verificação configurado no painel Meta | `meu-verify-token-aleatorio` |
| `META_SYSTEM_USER_TOKEN` | System User Token para Meta Ad Library e uploads | `EAAxxxxx...` |
| `JWT_SECRET` | Segredo para assinar tokens JWT | `my-jwt-secret-256bit` |

**Gerar a `ENCRYPTION_KEY`:**
```bash
openssl rand -hex 32
```

### Opcionais (com padrão)

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3000` | Porta do servidor |
| `NODE_ENV` | `development` | Ambiente (`development`, `production`, `test`) |
| `CACHE_TTL_SECONDS` | `3600` | TTL padrão do cache Redis (em segundos) |
| `META_GRAPH_API_URL` | `https://graph.facebook.com` | URL base da Graph API |
| `META_GRAPH_API_VERSION` | `v21.0` | Versão da Graph API (webhooks e messaging) |
| `META_ADS_API_VERSION` | `v21.0` | Versão da Marketing API (relatórios) |
| `INSIGHTS_CACHE_TTL_SECONDS` | `300` | TTL do cache de insights (mín: 30, máx: 3600) |
| `MANAGERS_GROUP_JID` | — | JID do grupo WhatsApp de gestores para alertas de falha de dispatch |
| `MAX_FILE_SIZE_MB` | `500` | Tamanho máximo de arquivo para upload de mídia (MB) |
| `WHATSAPP_PHONE_NUMBER` | — | Número de telefone para pareamento WhatsApp (alternativa ao QR code) |

---

## 5. Autenticação

Todos os endpoints (exceto `/health`, `/auth/login` e `/webhook/*`) exigem autenticação via um dos dois métodos:

### Método 1 — API Key (header)

```
x-api-key: <MASTER_API_KEY>
```

### Método 2 — JWT Bearer Token

```
Authorization: Bearer <token_jwt>
```

Obtenha o JWT via `POST /api/v1/auth/login`.

**Exemplo com curl (API Key):**
```bash
curl -H "x-api-key: minha-chave" https://api.trafegoflow.com/api/v1/clients
```

**Exemplo com curl (JWT):**
```bash
curl -H "Authorization: Bearer eyJhbGci..." https://api.trafegoflow.com/api/v1/clients
```

**Erro sem autenticação:**
```json
{
  "statusCode": 401,
  "message": "Invalid or missing API key"
}
```

> A Swagger UI em `/docs` possui um campo "Authorize" onde você insere a API Key ou o JWT para testar os endpoints diretamente.

---

## 6. Passo a passo para colocar em funcionamento

### Passo 1 — Instalar dependências

```bash
npm install
```

### Passo 2 — Configurar ambiente

```bash
cp .env.example .env
# Edite .env com suas credenciais
```

### Passo 3 — Subir PostgreSQL e Redis (Docker)

```bash
# PostgreSQL
docker run -d \
  --name trafegoflow-postgres \
  -e POSTGRES_USER=trafegoflow \
  -e POSTGRES_PASSWORD=trafegoflow \
  -e POSTGRES_DB=trafegoflow \
  -p 5432:5432 \
  postgres:16

# Redis
docker run -d \
  --name trafegoflow-redis \
  -e REDIS_PASSWORD=trafegoflow \
  -p 6379:6379 \
  redis:7 redis-server --requirepass trafegoflow
```

### Passo 4 — Rodar as migrations

```bash
npm run migration:run
```

### Passo 5 — Iniciar o servidor

```bash
# Desenvolvimento (hot reload)
npm run start:dev

# Produção
npm run build && npm run start:prod
```

O servidor sobe em `http://localhost:3002`.  
A documentação Swagger estará em `http://localhost:3002/docs`.

### Passo 6 — Criar primeiro usuário

```bash
curl -X POST http://localhost:3002/api/v1/auth/users \
  -H "x-api-key: minha-chave" \
  -H "Content-Type: application/json" \
  -d '{"name": "Administrador", "email": "admin@empresa.com", "password": "senha-segura"}'
```

### Passo 7 — Configurar webhook no Meta (para messaging)

1. No [Facebook Developer Console](https://developers.facebook.com), acesse seu App
2. Em **Webhooks**, configure:
   - **Callback URL:** `https://seu-dominio.com/webhook/instagram`
   - **Verify Token:** o valor de `META_VERIFY_TOKEN` no seu `.env`
3. Assine os campos: `messages`, `messaging_postbacks`, `message_reactions`, `message_reads`
4. A API responde automaticamente ao handshake de verificação

> Em desenvolvimento, use um tunnel (ex: [ngrok](https://ngrok.com)) para expor o servidor local: `ngrok http 3002`

### Passo 8 — Conectar sessão WhatsApp

```bash
# Checar status da sessão (retorna QR code se não conectada)
curl http://localhost:3002/api/v1/whatsapp-session/status \
  -H "x-api-key: minha-chave"

# OU usar código de emparelhamento por número
curl http://localhost:3002/api/v1/whatsapp-session/pairing-code \
  -H "x-api-key: minha-chave"
```

---

## 7. Módulos e endpoints

> **Base URL para todos os endpoints abaixo:** `/api/v1`  
> **Header obrigatório:** `x-api-key: <MASTER_API_KEY>` ou `Authorization: Bearer <jwt>` (exceto Health, Auth/login e Webhook)

---

### 7.1 Health

Verifica se a API está de pé e se as dependências (banco e Redis) estão acessíveis. Não requer autenticação.

#### `GET /health`

```bash
curl http://localhost:3002/api/v1/health
```

**Resposta 200:**
```json
{
  "status": "ok",
  "details": {
    "database": { "status": "up" },
    "redis": { "status": "up" }
  }
}
```

---

### 7.2 Auth (Autenticação JWT)

Gerencia autenticação de usuários internos da plataforma (gestores e administradores).

#### `POST /auth/login` — Autenticar com email/senha

Não requer header de autenticação.

```bash
curl -X POST http://localhost:3002/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@empresa.com", "password": "senha-segura"}'
```

| Campo | Tipo | Obrigatório |
|-------|------|-------------|
| `email` | string | Sim |
| `password` | string | Sim |

**Resposta 200:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Resposta 401:** Credenciais inválidas.

---

#### `GET /auth/me` — Perfil do usuário autenticado

Requer JWT Bearer (não aceita `x-api-key`).

```bash
curl http://localhost:3002/api/v1/auth/me \
  -H "Authorization: Bearer eyJhbGci..."
```

**Resposta 200:** Objeto do usuário autenticado (sem senha).

---

#### `POST /auth/users` — Criar usuário

Requer `x-api-key` ou JWT Bearer.

```bash
curl -X POST http://localhost:3002/api/v1/auth/users \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Gestor de Tráfego",
    "email": "gestor@empresa.com",
    "password": "senha-segura-123"
  }'
```

| Campo | Tipo | Obrigatório | Validação |
|-------|------|-------------|-----------|
| `name` | string | Sim | Máx. 200 caracteres |
| `email` | string | Sim | Email válido |
| `password` | string | Sim | 8–72 caracteres |

**Resposta 201:** Objeto do usuário criado (sem senha).

---

### 7.3 Clients (Clientes)

Gerencia os clientes da plataforma. Cada cliente é uma empresa ou pessoa física que contrata o serviço. Suporta billing, perfil de IA e links de integração.

#### `POST /clients` — Criar cliente

```bash
curl -X POST http://localhost:3002/api/v1/clients \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Agência XYZ",
    "email": "contato@agenciaxyz.com.br",
    "phone": "(32) 99999-0000",
    "profileType": "site_sales",
    "billing": {
      "startDate": "2026-01-01",
      "durationMonths": 12,
      "amount": 1500.00,
      "paymentMethod": "pix",
      "dueDay": 10,
      "contractStatus": "active"
    }
  }'
```

| Campo | Tipo | Obrigatório | Validação |
|-------|------|-------------|-----------|
| `name` | string | Sim | Máx. 200 caracteres |
| `email` | string | Sim | Email válido |
| `phone` | string | Não | — |
| `whatsappGroupCode` | string | Não | JID do grupo WhatsApp legado (ex: `120363000@g.us`) |
| `googleDriveFolderUrl` | string | Não | URL da pasta Google Drive |
| `profileType` | string | Não | `site_sales`, `message_sales`, `live_sales` |
| `billing` | objeto | Não | Ver campos abaixo |
| `billing.startDate` | string | Sim (se billing) | `YYYY-MM-DD` |
| `billing.durationMonths` | integer | Sim (se billing) | ≥ 1 |
| `billing.amount` | number | Sim (se billing) | Máx. 2 casas decimais |
| `billing.paymentMethod` | string | Sim (se billing) | `pix`, `boleto`, `debit`, `credit` |
| `billing.dueDay` | integer | Sim (se billing) | 1–31 |
| `billing.contractStatus` | string | Sim (se billing) | `active`, `expired`, `cancelled` |
| `billing.discountType` | string | Não | `fixed`, `percentage` |
| `billing.discountValue` | number | Não | Máx. 2 casas decimais |

**Resposta 201:** `ClientEntity`

---

#### `GET /clients` — Listar clientes ativos

```bash
curl http://localhost:3002/api/v1/clients \
  -H "x-api-key: <KEY>"
```

**Resposta 200:** Array de `ClientEntity` com `billings` incluídos.

---

#### `GET /clients/:id` — Buscar cliente por ID

```bash
curl http://localhost:3002/api/v1/clients/550e8400-e29b-41d4-a716-446655440000 \
  -H "x-api-key: <KEY>"
```

**Resposta 200:** `ClientEntity`  
**Resposta 404:** `{ "statusCode": 404, "message": "Client ... not found" }`

---

#### `PATCH /clients/:id` — Atualizar cliente

```bash
curl -X PATCH http://localhost:3002/api/v1/clients/550e8400-e29b-41d4-a716-446655440000 \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{"isActive": false, "billing": {"contractStatus": "cancelled"}}'
```

Todos os campos do `POST /clients` são opcionais no PATCH.

---

#### `DELETE /clients/:id` — Remover cliente (soft delete)

```bash
curl -X DELETE http://localhost:3002/api/v1/clients/550e8400-e29b-41d4-a716-446655440000 \
  -H "x-api-key: <KEY>"
```

**Resposta 204:** Sem corpo.

---

#### `DELETE /clients/:id/cache` — Invalidar cache do cliente

Limpa o cache Redis do cliente sem alterar os dados no banco.

```bash
curl -X DELETE http://localhost:3002/api/v1/clients/550e8400-e29b-41d4-a716-446655440000/cache \
  -H "x-api-key: <KEY>"
```

**Resposta 204:** Sem corpo.

---

### 7.4 Integrations (Integrações Meta)

Gerencia as integrações de mensageria do cliente (Instagram e WhatsApp). Cada integração vincula uma página/número do cliente à plataforma.

> Os access tokens são criptografados no banco e **nunca** aparecem nas respostas.

#### `POST /integrations` — Criar integração

```bash
curl -X POST http://localhost:3002/api/v1/integrations \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "uuid-do-cliente",
    "platform": "instagram",
    "pageId": "123456789",
    "accessToken": "EAAxxxxx...",
    "tokenExpiresAt": "2026-12-31T00:00:00Z"
  }'
```

| Campo | Tipo | Obrigatório | Validação |
|-------|------|-------------|-----------|
| `clientId` | string | Sim | UUID válido |
| `platform` | string | Sim | `"instagram"` ou `"whatsapp"` |
| `pageId` | string | Sim | Instagram Page ID ou WhatsApp Phone Number ID |
| `accessToken` | string | Sim | Page Access Token da Meta |
| `tokenExpiresAt` | string | Não | ISO 8601 — omitir se token permanente |

**Resposta 201:** `IntegrationEntity` (sem o campo `accessToken`)

---

#### `GET /integrations` — Listar integrações do cliente

```bash
curl "http://localhost:3002/api/v1/integrations?clientId=uuid-do-cliente" \
  -H "x-api-key: <KEY>"
```

| Param | Tipo | Obrigatório |
|-------|------|-------------|
| `clientId` | string (UUID) | Sim |

---

#### `GET /integrations/:id` — Buscar integração por ID

```bash
curl http://localhost:3002/api/v1/integrations/uuid-da-integracao \
  -H "x-api-key: <KEY>"
```

---

#### `PATCH /integrations/:id` — Atualizar integração (rotacionar token)

```bash
curl -X PATCH http://localhost:3002/api/v1/integrations/uuid-da-integracao \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{"accessToken": "EAAyyyyy...", "tokenExpiresAt": "2027-06-30T00:00:00Z"}'
```

| Campo | Tipo | Obrigatório |
|-------|------|-------------|
| `accessToken` | string | Não |
| `tokenExpiresAt` | string (ISO 8601) | Não |
| `isActive` | boolean | Não |

---

#### `DELETE /integrations/:id` — Remover integração

```bash
curl -X DELETE http://localhost:3002/api/v1/integrations/uuid-da-integracao \
  -H "x-api-key: <KEY>"
```

**Resposta 204:** Sem corpo.

---

### 7.5 Ad Accounts (Contas de Anúncio)

Gerencia as contas Meta Ads dos clientes. Cada conta de anúncio requer um **User Access Token** com permissão `ads_read`.

> O `adAccountId` sempre segue o formato `act_{número}` (ex: `act_123456789`).

#### `POST /ad-accounts` — Cadastrar conta de anúncio

```bash
curl -X POST http://localhost:3002/api/v1/ad-accounts \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "uuid-do-cliente",
    "adAccountId": "act_123456789",
    "accessToken": "EAAxxxxx...",
    "accountName": "Conta Principal",
    "tokenExpiresAt": "2026-12-31T00:00:00Z"
  }'
```

| Campo | Tipo | Obrigatório | Validação |
|-------|------|-------------|-----------|
| `clientId` | string | Sim | UUID válido |
| `adAccountId` | string | Sim | Formato `act_\d+` |
| `accessToken` | string | Sim | User Access Token com `ads_read` |
| `accountName` | string | Não | Nome legível da conta |
| `tokenExpiresAt` | string | Não | ISO 8601 — omitir se token permanente |

**Resposta 201:** `AdAccountEntity` (sem `accessToken`, com `hasToken: true`)  
**Resposta 409:** Se `adAccountId` já está cadastrado.

---

#### `GET /ad-accounts` — Listar contas de anúncio

```bash
curl "http://localhost:3002/api/v1/ad-accounts?clientId=uuid-do-cliente" \
  -H "x-api-key: <KEY>"
```

| Param | Tipo | Obrigatório |
|-------|------|-------------|
| `clientId` | string (UUID) | Sim |

---

#### `GET /ad-accounts/expiring` — Listar tokens próximos do vencimento

```bash
curl "http://localhost:3002/api/v1/ad-accounts/expiring?clientId=uuid-do-cliente&daysAhead=14" \
  -H "x-api-key: <KEY>"
```

| Param | Tipo | Obrigatório | Padrão | Máximo |
|-------|------|-------------|--------|--------|
| `clientId` | string (UUID) | Sim | — | — |
| `daysAhead` | number | Não | `7` | `90` |

> Contas com `tokenExpiresAt = null` nunca aparecem neste endpoint.

---

#### `GET /ad-accounts/:id` — Buscar conta por ID

```bash
curl http://localhost:3002/api/v1/ad-accounts/uuid-da-conta \
  -H "x-api-key: <KEY>"
```

---

#### `PATCH /ad-accounts/:id` — Atualizar conta (rotacionar token)

```bash
curl -X PATCH http://localhost:3002/api/v1/ad-accounts/uuid-da-conta \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{"accessToken": "EAAyyyyy...", "tokenExpiresAt": "2027-06-30T00:00:00Z"}'
```

| Campo | Tipo | Obrigatório |
|-------|------|-------------|
| `accessToken` | string | Não |
| `tokenExpiresAt` | string (ISO 8601) | Não |
| `isActive` | boolean | Não |
| `accountName` | string | Não |

---

#### `DELETE /ad-accounts/:id` — Remover conta

```bash
curl -X DELETE http://localhost:3002/api/v1/ad-accounts/uuid-da-conta \
  -H "x-api-key: <KEY>"
```

**Resposta 204:** Sem corpo.

---

### 7.6 Campaign Reports (Relatórios de Campanhas)

Consulta dados da **Meta Marketing API** em tempo real, com cache Redis.

#### `GET /campaign-reports/campaigns` — Listar campanhas

```bash
curl "http://localhost:3002/api/v1/campaign-reports/campaigns?adAccountId=act_123456789" \
  -H "x-api-key: <KEY>"
```

| Param | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `adAccountId` | string | Sim | ID da conta no formato `act_123456789` |
| `cursor` | string | Não | Cursor retornado em `paging.next` |

**Resposta 200:**
```json
{
  "data": [
    {
      "id": "23843210000",
      "name": "Campanha Verão 2026",
      "status": "ACTIVE",
      "objective": "OUTCOME_TRAFFIC",
      "created_time": "2026-01-01T00:00:00Z"
    }
  ],
  "paging": { "next": "cursor_para_proxima_pagina" }
}
```

---

#### `GET /campaign-reports/insights` — Insights da conta

```bash
curl "http://localhost:3002/api/v1/campaign-reports/insights?adAccountId=act_123456789&datePreset=last_30d&level=campaign" \
  -H "x-api-key: <KEY>"
```

| Param | Tipo | Obrigatório | Padrão | Opções |
|-------|------|-------------|--------|--------|
| `adAccountId` | string | Sim | — | — |
| `datePreset` | string | Não | `last_30d` | `today`, `yesterday`, `last_7d`, `last_14d`, `last_30d`, `this_month`, `last_month` |
| `level` | string | Não | `campaign` | `account`, `campaign`, `adset`, `ad` |
| `cursor` | string | Não | — | Cursor de paginação |
| `timeIncrement` | string | Não | — | `1` (diário), `7` (semanal), `monthly`, `all_days` |
| `breakdowns` | string | Não | — | `age`, `gender`, `country`, `region`, `publisher_platform`, `device_platform` (separados por vírgula) |

**Resposta 200:** `PaginatedResult<MetaInsights>` — `{ data: [...], paging: { next? } }`

---

#### `GET /campaign-reports/insights/:campaignId` — Insights de campanha específica

```bash
curl "http://localhost:3002/api/v1/campaign-reports/insights/23843210000?adAccountId=act_123456789&datePreset=last_7d" \
  -H "x-api-key: <KEY>"
```

**Resposta 200 (sem timeIncrement/breakdowns):** `MetaInsights` (objeto único)  
**Resposta 200 (com timeIncrement ou breakdowns):** `PaginatedResult<MetaInsights>`  
**Resposta 404:** Se a campanha não tiver dados para o período.

---

### 7.7 WhatsApp Groups (Grupos WhatsApp)

Gerencia os grupos WhatsApp vinculados a cada cliente. Esses grupos recebem os relatórios semanais automatizados.

> O `groupJid` deve ser obtido via `GET /whatsapp-session/groups` — o formato é `{número}@g.us` ou `{número}-{timestamp}@g.us`.

#### `POST /whatsapp-groups` — Cadastrar grupo

```bash
curl -X POST http://localhost:3002/api/v1/whatsapp-groups \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "uuid-do-cliente",
    "groupJid": "120363000000000000@g.us",
    "label": "Grupo Relatórios - Agência XYZ"
  }'
```

| Campo | Tipo | Obrigatório | Validação |
|-------|------|-------------|-----------|
| `clientId` | string | Sim | UUID válido |
| `groupJid` | string | Sim | Formato `\d+(-\d+)?@g\.us` |
| `label` | string | Não | Máx. 200 caracteres |

**Resposta 201:** `WhatsAppGroupEntity`

---

#### `GET /whatsapp-groups` — Listar grupos ativos do cliente

```bash
curl "http://localhost:3002/api/v1/whatsapp-groups?clientId=uuid-do-cliente" \
  -H "x-api-key: <KEY>"
```

| Param | Tipo | Obrigatório |
|-------|------|-------------|
| `clientId` | string (UUID) | Sim |

**Resposta 200:** Array de `WhatsAppGroupEntity` com `isActive: true`.

---

#### `PATCH /whatsapp-groups/:id` — Atualizar grupo

```bash
curl -X PATCH http://localhost:3002/api/v1/whatsapp-groups/uuid-do-grupo \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{"label": "Novo Nome", "isActive": false}'
```

| Campo | Tipo | Obrigatório |
|-------|------|-------------|
| `label` | string | Não |
| `isActive` | boolean | Não |

---

#### `DELETE /whatsapp-groups/:id` — Remover grupo (soft delete)

```bash
curl -X DELETE http://localhost:3002/api/v1/whatsapp-groups/uuid-do-grupo \
  -H "x-api-key: <KEY>"
```

**Resposta 204:** Sem corpo.

---

### 7.8 WhatsApp Session (Sessão WhatsApp)

Gerencia a sessão do número WhatsApp dedicado da plataforma (via Baileys). A sessão é única e compartilhada para envio de todos os relatórios.

#### `GET /whatsapp-session/status` — Status da sessão

```bash
curl http://localhost:3002/api/v1/whatsapp-session/status \
  -H "x-api-key: <KEY>"
```

**Resposta 200:**
```json
{
  "status": "open",
  "qrCode": null
}
```

| Campo `status` | Descrição |
|----------------|-----------|
| `open` | Sessão ativa — pronta para enviar mensagens |
| `connecting` | Reconectando |
| `close` | Desconectada — escaneie o QR code |

Quando `status` é `close`, `qrCode` contém a string base64 do QR code para escanear no WhatsApp.

---

#### `GET /whatsapp-session/pairing-code` — Código de emparelhamento

Alternativa ao QR code — gera um código de 8 dígitos para inserir no WhatsApp do número definido em `WHATSAPP_PHONE_NUMBER`.

```bash
curl http://localhost:3002/api/v1/whatsapp-session/pairing-code \
  -H "x-api-key: <KEY>"
```

**Resposta 200:**
```json
{
  "pairingCode": "ABCD-1234"
}
```

---

#### `GET /whatsapp-session/groups` — Listar grupos participantes

Lista todos os grupos WhatsApp em que o número dedicado está presente. Use este endpoint para obter os `groupJid` antes de cadastrá-los.

```bash
curl http://localhost:3002/api/v1/whatsapp-session/groups \
  -H "x-api-key: <KEY>"
```

**Resposta 200:**
```json
[
  {
    "jid": "120363000000000000@g.us",
    "subject": "Relatórios - Agência XYZ",
    "participantCount": 5
  }
]
```

---

### 7.9 Report Dispatches (Envio de Relatórios)

Controla o envio semanal automatizado de relatórios de campanhas para grupos WhatsApp dos clientes. Os relatórios são gerados por IA (OpenAI/Gemini) com base nos insights da semana anterior.

**Pré-requisitos para um cliente receber o relatório:**
1. Ter pelo menos um grupo WhatsApp cadastrado e ativo (`POST /whatsapp-groups`)
2. Ter pelo menos uma conta de anúncio ativa com token válido
3. A sessão WhatsApp deve estar conectada (`status: "open"`)

**Job automático:** Todo início de semana o sistema dispara automaticamente para todos os clientes elegíveis.

#### `POST /report-dispatches/trigger` — Disparar relatório manualmente

```bash
# Para um cliente específico
curl -X POST http://localhost:3002/api/v1/report-dispatches/trigger \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{"clientId": "uuid-do-cliente"}'

# Para todos os clientes elegíveis
curl -X POST http://localhost:3002/api/v1/report-dispatches/trigger \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{}'

# Com semana específica
curl -X POST http://localhost:3002/api/v1/report-dispatches/trigger \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{"clientId": "uuid-do-cliente", "weekStartDate": "2026-09-01"}'
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `clientId` | string (UUID) | Não | Omitir para disparar para todos |
| `weekStartDate` | string (ISO 8601) | Não | Omitir para usar a semana anterior |

**Resposta 200:**
```json
{
  "dispatched": 3,
  "failed": 1
}
```

> Clientes sem grupos WhatsApp ou sem contas ativas são silenciosamente ignorados (não contam como falha).

---

#### `GET /report-dispatches` — Listar histórico de despachos

```bash
curl "http://localhost:3002/api/v1/report-dispatches?clientId=uuid-do-cliente" \
  -H "x-api-key: <KEY>"
```

| Param | Tipo | Obrigatório |
|-------|------|-------------|
| `clientId` | string (UUID) | Não |

**Resposta 200:** Array de `ReportDispatchLogEntity`, ordenado por `createdAt DESC`.

```json
[
  {
    "id": "uuid",
    "clientId": "uuid-do-cliente",
    "groupJid": "120363000000000000@g.us",
    "adAccountId": "act_123456789",
    "weekStartDate": "2026-09-01",
    "status": "sent",
    "errorMessage": null,
    "sentAt": "2026-09-08T08:00:00.000Z",
    "createdAt": "2026-09-08T08:00:00.000Z"
  }
]
```

| Campo `status` | Descrição |
|----------------|-----------|
| `sent` | Mensagem entregue ao grupo WhatsApp |
| `failed` | Falha no envio — `errorMessage` contém o motivo |

---

### 7.10 Media Library (Biblioteca de Mídia)

Gerencia uploads de criativos (imagens e vídeos) para uso em campanhas Meta Ads. O arquivo é salvo no **Google Drive** do cliente e enfileirado para upload assíncrono na **Meta Ads**.

**Formatos aceitos:** `image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `video/quicktime`  
**Tamanho máximo:** definido por `MAX_FILE_SIZE_MB` (padrão: 500 MB)

#### `POST /media-library/upload` — Upload de mídia

Requisição `multipart/form-data`.

```bash
curl -X POST http://localhost:3002/api/v1/media-library/upload \
  -H "x-api-key: <KEY>" \
  -F "file=@/caminho/para/criativo.mp4" \
  -F "adAccountId=act_123456789" \
  -F "clientId=uuid-do-cliente" \
  -F "intention=PRD" \
  -F "productName=Produto XYZ" \
  -F "startVersion=1"
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `file` | arquivo | Sim | Arquivo de mídia (form-data) |
| `adAccountId` | string | Sim | ID da conta Meta Ads (`act_...`) |
| `clientId` | string | Sim | UUID do cliente |
| `intention` | string | Sim | `PRD` (produto) ou `CAP` (captação) |
| `productName` | string | Sim | Nome do produto/criativo (máx. 100 chars) |
| `startVersion` | integer | Não | Versão inicial do criativo (padrão: 1) |

> A conta de anúncio deve pertencer ao cliente informado — caso contrário, retorna `403 Forbidden`.

**Resposta 200:** Log do upload com status inicial `processing`.

---

#### `GET /media-library/logs` — Histórico de uploads

```bash
curl "http://localhost:3002/api/v1/media-library/logs?clientId=uuid-do-cliente&page=1&limit=20" \
  -H "x-api-key: <KEY>"
```

| Param | Tipo | Obrigatório | Padrão | Descrição |
|-------|------|-------------|--------|-----------|
| `clientId` | string | Sim | — | UUID do cliente |
| `page` | integer | Não | `1` | Página (≥ 1) |
| `limit` | integer | Não | `20` | Itens por página (1–100) |
| `status` | string | Não | — | `processing`, `success`, `failed` |
| `startDate` | string | Não | — | Data início (ISO 8601) |
| `endDate` | string | Não | — | Data fim (ISO 8601) |
| `mediaName` | string | Não | — | Filtro por nome do arquivo |

**Resposta 200:** Lista paginada de logs de upload.

---

#### `POST /media-library/logs/retry-failed` — Re-enfileirar todos os uploads com falha

```bash
curl -X POST http://localhost:3002/api/v1/media-library/logs/retry-failed \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{"clientId": "uuid-do-cliente"}'
```

**Resposta 200:** Contagem de uploads re-enfileirados.

---

#### `POST /media-library/logs/:id/retry` — Re-enfileirar upload específico

```bash
curl -X POST http://localhost:3002/api/v1/media-library/logs/uuid-do-log/retry \
  -H "x-api-key: <KEY>"
```

**Resposta 200:** Log atualizado com status `processing`.

---

### 7.11 Ad Library (Biblioteca de Anúncios Meta)

Pesquisa anunciantes ativos na **Meta Ad Library** (dados públicos). Útil para triagem de prospecção de clientes — identifica empresas que investem em anúncios no setor de interesse.

> Usa o `META_SYSTEM_USER_TOKEN` — sem custo de token por cliente. Dados são públicos.

#### `GET /ad-library/search` — Buscar anunciantes

```bash
# Busca básica
curl "http://localhost:3002/api/v1/ad-library/search?terms=academia&country=BR" \
  -H "x-api-key: <KEY>"

# Com filtros avançados
curl "http://localhost:3002/api/v1/ad-library/search?terms=ecommerce+moda&country=BR&minSpend=500&minImpressions=10000&limit=100" \
  -H "x-api-key: <KEY>"
```

| Param | Tipo | Obrigatório | Padrão | Descrição |
|-------|------|-------------|--------|-----------|
| `terms` | string | Não | `moda` | Palavras-chave (mín. 2, máx. 100 chars). Espaço = AND |
| `searchType` | string | Não | `KEYWORD_UNORDERED` | `KEYWORD_UNORDERED` ou `KEYWORD_EXACT_PHRASE` |
| `country` | string | Não | `BR` | Código ISO-2. Múltiplos separados por vírgula: `BR,AR` |
| `adType` | string | Não | `ALL` | `ALL`, `EMPLOYMENT_ADS`, `HOUSING_ADS`, `FINANCIAL_PRODUCTS_AND_SERVICES_ADS` |
| `activeStatus` | string | Não | `ACTIVE` | `ACTIVE`, `INACTIVE`, `ALL` |
| `platforms` | string | Não | — | `INSTAGRAM,FACEBOOK` (separados por vírgula) |
| `languages` | string | Não | — | Códigos ISO 639-1 separados por vírgula (ex: `pt,en`) |
| `mediaType` | string | Não | — | `ALL`, `IMAGE`, `MEME`, `VIDEO`, `NONE` |
| `deliveryDateMin` | string | Não | — | Data mínima de veiculação (`YYYY-MM-DD`) |
| `deliveryDateMax` | string | Não | — | Data máxima de veiculação (`YYYY-MM-DD`) |
| `pageIds` | string | Não | — | Até 10 IDs de página separados por vírgula |
| `limit` | integer | Não | `50` | Resultados únicos por página (1–100) |
| `after` | string | Não | — | Cursor de paginação (`paging.cursors.after`) |
| `minSpend` | integer | Não | — | Descarta anunciantes com `spend.lowerBound` abaixo deste valor |
| `minImpressions` | integer | Não | — | Descarta anunciantes com `impressions.lowerBound` abaixo deste valor |

**Resposta 200:**
```json
{
  "data": [
    {
      "pageId": "123456789",
      "pageName": "Loja Exemplo",
      "fundingEntity": "Empresa XYZ",
      "spend": { "lowerBound": "1000", "upperBound": "5000" },
      "impressions": { "lowerBound": "50000", "upperBound": "100000" },
      "estimatedAudienceSize": { "lowerBound": "10000", "upperBound": "50000" },
      "brTotalReach": 75000,
      "adDeliveryStartTime": "2026-01-01",
      "adDeliveryStopTime": null,
      "publisherPlatforms": ["facebook", "instagram"],
      "languages": ["pt"],
      "demographicDistribution": [
        { "age": "25-34", "gender": "female", "percentage": "35.2" }
      ],
      "deliveryByRegion": [
        { "region": "São Paulo", "percentage": "42.1" }
      ],
      "targetAges": ["18-24", "25-34"],
      "targetGender": null,
      "targetLocations": [{ "name": "Brasil", "type": "country" }],
      "adSnapshotUrl": "https://www.facebook.com/ads/library/?id=..."
    }
  ],
  "paging": {
    "cursors": {
      "before": "cursor_anterior",
      "after": "cursor_proximo"
    }
  },
  "total": 42
}
```

> Os resultados são deduplicados por `pageId` — um anunciante com múltiplos anúncios aparece apenas uma vez.

---

### 7.12 Adset Alerts (Alertas de Adsets)

Monitora métricas de adsets automaticamente e envia alertas para grupos WhatsApp quando os limiares são ultrapassados. O job roda em background com schedule configurado via `alert-jobs`.

#### `POST /adset-alerts/trigger` — Disparar alerta manualmente

Executa imediatamente (sem delay aleatório), útil para testar.

```bash
curl -X POST http://localhost:3002/api/v1/adset-alerts/trigger \
  -H "x-api-key: <KEY>"
```

**Resposta 200:**
```json
{ "triggered": true }
```

---

### 7.13 Alert Jobs (Jobs de Alerta)

Gerencia as configurações dos jobs de monitoramento automático. Cada job define qual tipo de alerta está ativo e para quais clientes.

#### `GET /alert-jobs` — Listar jobs de alerta

```bash
# Todos os jobs
curl http://localhost:3002/api/v1/alert-jobs \
  -H "x-api-key: <KEY>"

# Filtrar por status e tipo
curl "http://localhost:3002/api/v1/alert-jobs?status=ACTIVE&type=ADSET_INSIGHTS" \
  -H "x-api-key: <KEY>"
```

| Param | Tipo | Obrigatório | Valores |
|-------|------|-------------|---------|
| `status` | string | Não | `ACTIVE`, `INACTIVE` |
| `type` | string | Não | `ADSET_INSIGHTS` |

**Resposta 200:** Array de `AlertJobEntity`.

---

#### `POST /alert-jobs` — Criar job de alerta

```bash
curl -X POST http://localhost:3002/api/v1/alert-jobs \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ADSET_INSIGHTS",
    "status": "ACTIVE",
    "clientId": "uuid-do-cliente",
    "fields": ["ctr", "cpm", "spend"]
  }'
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `type` | string | Sim | `ADSET_INSIGHTS` |
| `status` | string | Não | `ACTIVE` (padrão) ou `INACTIVE` |
| `clientId` | string | Não | UUID do cliente — `null` para monitorar todos |
| `fields` | string[] | Não | Campos de métricas a monitorar |

**Resposta 201:** `AlertJobEntity`

---

#### `PATCH /alert-jobs/:id` — Atualizar job de alerta

```bash
curl -X PATCH http://localhost:3002/api/v1/alert-jobs/uuid-do-job \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{"status": "INACTIVE"}'
```

| Campo | Tipo | Obrigatório |
|-------|------|-------------|
| `status` | string | Não |
| `fields` | string[] | Não |

---

### 7.14 Webhook Instagram

Endpoint para receber eventos do Instagram enviados pelo Meta. Não requer `x-api-key`.

> **Nota:** As rotas de webhook não têm o prefixo `/api/v1`. São acessadas diretamente em `/webhook/instagram`.

#### `GET /webhook/instagram` — Verificação do webhook (handshake)

```
GET /webhook/instagram?hub.mode=subscribe&hub.verify_token=<META_VERIFY_TOKEN>&hub.challenge=CHALLENGE_CODE
```

A API responde automaticamente com o `hub.challenge` se o token coincidir.

---

#### `POST /webhook/instagram` — Receber eventos do Instagram

**Header obrigatório:**
```
x-hub-signature-256: sha256=<hmac_assinatura>
```

**Tipos de evento suportados:**

| Tipo | Descrição |
|------|-----------|
| `message` | Mensagem de texto recebida |
| `message` (com `attachments`) | Mídia recebida (imagem, vídeo, arquivo) |
| `reaction` | Reação em mensagem |
| `read` | Confirmação de leitura |

A API retorna `200 OK` imediatamente após receber o evento (antes de qualquer processamento), conforme exigido pelo Meta.

---

## 8. Modelos de dados

### ClientEntity

```typescript
{
  id: string;                      // UUID
  name: string;                    // Máx. 200 chars
  email: string;                   // Único
  isActive: boolean;
  phone: string | null;
  whatsappGroupCode: string | null; // JID do grupo WhatsApp legado
  googleDriveFolderUrl: string | null;
  aiStrategyContext: string | null; // Contexto livre para geração de relatórios por IA
  profileType: 'site_sales' | 'message_sales' | 'live_sales' | null;
  billings: ClientBillingEntity[]; // Histórico de contratos de billing
  createdAt: string;               // ISO 8601
  updatedAt: string;
  deletedAt: string | null;
}
```

### ClientBillingEntity

```typescript
{
  id: string;
  clientId: string;
  startDate: string;               // "YYYY-MM-DD"
  durationMonths: number;
  amount: number;
  discountType: 'fixed' | 'percentage' | null;
  discountValue: number | null;
  paymentMethod: 'pix' | 'boleto' | 'debit' | 'credit';
  dueDay: number;                  // 1–31
  contractStatus: 'active' | 'expired' | 'cancelled';
  installments: ClientBillingInstallmentEntity[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

### ClientBillingInstallmentEntity

```typescript
{
  id: string;
  clientBillingId: string;
  installmentNumber: number;
  dueDate: string;                 // "YYYY-MM-DD"
  paidAt: string | null;           // ISO 8601 — null se não pago
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

### IntegrationEntity

```typescript
{
  id: string;
  clientId: string;
  platform: 'instagram' | 'whatsapp';
  pageId: string;
  // accessToken: NUNCA retornado
  tokenExpiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

### AdAccountEntity

```typescript
{
  id: string;
  clientId: string;
  adAccountId: string;             // "act_123456789"
  accountName: string | null;
  // accessToken: NUNCA retornado
  hasToken: boolean;               // true se accessToken está preenchido
  tokenExpiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

### WhatsAppGroupEntity

```typescript
{
  id: string;
  clientId: string;
  groupJid: string;                // Ex: "120363000000000000@g.us"
  label: string | null;            // Nome amigável
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

### ReportDispatchLogEntity

```typescript
{
  id: string;
  clientId: string;
  groupJid: string;
  adAccountId: string;
  weekStartDate: string;           // ISO 8601 — segunda-feira da semana
  status: 'sent' | 'failed';
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

### MetaInsights

```typescript
{
  campaign_id?: string;
  campaign_name?: string;
  impressions: string;
  clicks: string;
  spend: string;
  reach: string;
  cpm: string;
  cpc: string;
  ctr: string;
  date_start: string;
  date_stop: string;
  frequency?: string;
  unique_clicks?: string;
  cost_per_unique_click?: string;
  actions?: { action_type: string; value: string }[];
  cost_per_action_type?: { action_type: string; value: string }[];
  purchase_roas?: { action_type: string; value: string }[];
  video_play_actions?: { action_type: string; value: string }[];
  video_p25_watched_actions?: { action_type: string; value: string }[];
  video_p50_watched_actions?: { action_type: string; value: string }[];
  video_p75_watched_actions?: { action_type: string; value: string }[];
  video_p100_watched_actions?: { action_type: string; value: string }[];
  // Campos de breakdown (presentes quando solicitados)
  age?: string;
  gender?: string;
  country?: string;
  region?: string;
  publisher_platform?: string;
  device_platform?: string;
}
```

> Todos os campos numéricos são retornados como `string` pela Meta API.

---

## 9. Cache e performance

A API usa **Redis** para cachear respostas da Meta Marketing API.

| Recurso | Chave de cache | TTL |
|---------|---------------|-----|
| Lista de campanhas | `meta:campaigns:{adAccountId}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| Lista de campanhas (paginada) | `meta:campaigns:{adAccountId}:cursor:{cursor}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| Insights da conta (base) | `meta:insights:{adAccountId}:{level}:{datePreset}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| + timeIncrement | `meta:insights:{...}:ti:{timeIncrement}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| + breakdowns | `meta:insights:{...}:bd:{breakdowns_sorted}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| + cursor | `meta:insights:{...}:cursor:{cursor}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| Insights de campanha | `meta:insights:campaign:{campaignId}:{datePreset}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| AdAccount por ID | `ad-account:id:{id}` | `CACHE_TTL_SECONDS` |
| AdAccount por act\_ | `ad-account:act:{adAccountId}` | `CACHE_TTL_SECONDS` |
| Client por ID | `client:{id}` | `CACHE_TTL_SECONDS` |

**Regra de composição dos sufixos:** sempre na ordem `:ti:` → `:bd:` → `:cursor:`. Breakdowns são sempre ordenados alfabeticamente — `gender,age` e `age,gender` produzem a mesma chave `:bd:age,gender`.

---

## 10. Monitoramento de tokens

Um **job agendado** verifica diariamente às 08:00 (horário de Brasília) todos os tokens de contas de anúncio ativos. Para cada token que vence em ≤ 7 dias, a API emite um log `WARN`:

```
[WARN] [TOKEN_EXPIRING] adAccountId=act_123456789 clientId=uuid-... expiresIn=5d
```

```bash
# Tokens vencendo nos próximos 7 dias
curl "http://localhost:3002/api/v1/ad-accounts/expiring?clientId=uuid-do-cliente" \
  -H "x-api-key: <KEY>"
```

Contas com `tokenExpiresAt = null` são ignoradas pelo monitoramento.

---

## 11. Erros comuns

| Status | Mensagem | Causa | Solução |
|--------|----------|-------|---------|
| `400 Bad Request` | Detalhes de validação | Body ou query params inválidos | Verifique os campos obrigatórios e formatos |
| `400 Bad Request` | `daysAhead must not be greater than 90` | `daysAhead` acima do limite | Use um valor entre 1 e 90 |
| `400 Bad Request` | `Cannot create billing with partial data` | billing enviado incompleto | Envie todos os campos obrigatórios de billing |
| `401 Unauthorized` | `Invalid or missing API key` | Header `x-api-key` ausente ou errado | Envie o header com o valor de `MASTER_API_KEY` |
| `401 Unauthorized` | `OAuth token expired or invalid for: act_...` | Token da Meta expirado | Rotacione o token via `PATCH /ad-accounts/:id` |
| `403 Forbidden` | `Ad account does not belong to the specified client` | clientId e adAccountId não correspondem | Verifique se a conta pertence ao cliente |
| `404 Not Found` | `Ad account ... not found` | `adAccountId` não cadastrado | Cadastre a conta antes de consultar |
| `404 Not Found` | `Client ... not found` | `clientId` inválido | Verifique o UUID do cliente |
| `404 Not Found` | `No insights found for campaign ...` | Campanha sem dados no período | Tente outro `datePreset` |
| `409 Conflict` | `An ad account with this adAccountId already exists` | `adAccountId` duplicado | Cada conta Meta Ads só pode ser cadastrada uma vez |
| `422 Unprocessable Entity` | `Ad account ... is inactive` | Conta desativada | Reative via `PATCH /ad-accounts/:id` com `{ "isActive": true }` |

---

## 12. Limitações conhecidas

| Limitação | Detalhe |
|-----------|---------|
| **Sessão WhatsApp única** | A plataforma usa um único número WhatsApp para enviar relatórios de todos os clientes. Se a sessão cair, todos os dispatches falham. |
| **Dispatch silencioso** | Clientes sem grupos WhatsApp ou sem contas ativas são ignorados sem gerar log de erro. Verifique `GET /report-dispatches?clientId=...` — array vazio indica skip silencioso. |
| **Breakdowns: combinações inválidas** | A Meta API não permite combinar `age` com `country`, entre outras. Consulte a [documentação de breakdowns](https://developers.facebook.com/docs/marketing-api/insights/breakdowns). |
| **Paginação em `/insights/:campaignId`** | O endpoint de campanha específica não aceita parâmetro `cursor`. Com `timeIncrement=1` em períodos longos, apenas os primeiros 25 dias são retornados. |
| **Breakdowns não validados na borda** | Valores inválidos em `breakdowns` retornam erro da Meta API, não 400 do TrafegoFlow. |
| **Cache não invalidado após desativação** | Dados cacheados continuam sendo retornados por até `INSIGHTS_CACHE_TTL_SECONDS` após desativação de conta. |
| **Rate limit da Meta** | A Marketing API tem limite de ~200 chamadas/hora por token (Tier 1). O cache Redis reduz o consumo. |
| **Upload assíncrono** | O upload para Meta Ads é assíncrono — o arquivo chega ao Google Drive imediatamente, mas o upload para a Meta pode levar minutos. Acompanhe via `GET /media-library/logs`. |

---

## Referências

- [Meta Marketing API — Documentação oficial](https://developers.facebook.com/docs/marketing-api)
- [Meta Webhooks para Instagram](https://developers.facebook.com/docs/instagram-api/webhooks)
- [Meta Ad Library API](https://developers.facebook.com/docs/ad-library-api)
- [Tipos de access tokens Meta](https://developers.facebook.com/docs/facebook-login/access-tokens)
- [Swagger UI local](http://localhost:3002/docs)
- [Guia de setup Instagram Graph API](./meta-instagram-setup.md)
