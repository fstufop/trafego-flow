# TrafegoFlow API — Documentação

**Versão:** 1.0  
**Base URL:** `http://localhost:3000` (desenvolvimento)  
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
   - [Clients (Clientes)](#72-clients-clientes)
   - [Integrations (Integrações Meta)](#73-integrations-integrações-meta)
   - [Ad Accounts (Contas de Anúncio)](#74-ad-accounts-contas-de-anúncio)
   - [Campaign Reports (Relatórios de Campanhas)](#75-campaign-reports-relatórios-de-campanhas)
   - [Webhook Instagram](#76-webhook-instagram)
8. [Modelos de dados](#8-modelos-de-dados)
9. [Cache e performance](#9-cache-e-performance)
10. [Monitoramento de tokens](#10-monitoramento-de-tokens)
11. [Erros comuns](#11-erros-comuns)
12. [Limitações conhecidas](#12-limitações-conhecidas)

---

## 1. O que é esta API

O TrafegoFlow é uma plataforma backend para gestores de tráfego que gerenciam campanhas pagas no Meta (Facebook/Instagram). A API oferece:

- **Gestão de clientes** — cadastro de clientes com seus respectivos acessos à Meta
- **Integrações de mensageria** — recebimento de mensagens do Instagram e WhatsApp via webhook
- **Relatórios de campanhas** — consumo da Marketing API da Meta para buscar dados de campanhas, insights e métricas
- **Monitoramento de tokens** — alertas automáticos sobre tokens de acesso prestes a vencer

A arquitetura é **multi-tenant**: cada cliente possui seus próprios tokens, contas de anúncio e integrações, completamente isolados entre si.

---

## 2. Como a API funciona

```
                        ┌─────────────────────────────────────────────┐
                        │             TrafegoFlow API (NestJS)         │
                        │                                              │
Seu frontend/sistema ──►│  POST /api/v1/clients                       │
                        │  POST /api/v1/integrations                   │──► PostgreSQL
                        │  POST /api/v1/ad-accounts                   │
                        │  GET  /api/v1/campaign-reports/...          │──► Redis (cache)
                        │                                              │
Meta (Facebook/Insta) ──►│  POST /webhook/instagram                    │──► Meta Marketing API
                        │  GET  /webhook/instagram (verificação)      │
                        └─────────────────────────────────────────────┘
```

**Fluxo típico:**
1. Cadastre um **cliente** (gestor ou agência)
2. Adicione as **integrações** de Instagram/WhatsApp do cliente
3. Cadastre as **contas de anúncio** do cliente (contas Meta Ads)
4. Consulte **relatórios de campanhas** em tempo real (com cache Redis de 5 minutos por padrão)
5. Os **webhooks** do Instagram recebem mensagens automaticamente quando configurados no painel Meta

**Tokens e segurança:**
- Todos os access tokens são criptografados com AES-256-GCM antes de serem persistidos no banco
- Tokens nunca aparecem em respostas da API (excluídos pelo `ClassSerializerInterceptor`)
- A autenticação da API usa uma única Master API Key no header `x-api-key`

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

---

## 5. Autenticação

Todos os endpoints (exceto `/health` e `/webhook/*`) exigem autenticação via **API Key** no header HTTP.

```
x-api-key: <MASTER_API_KEY>
```

**Exemplo com curl:**
```bash
curl -H "x-api-key: minha-chave" https://api.trafegoflow.com/api/v1/clients
```

**Erro sem autenticação:**
```json
{
  "statusCode": 401,
  "message": "Invalid or missing API key"
}
```

> A Swagger UI em `/docs` possui um campo "Authorize" onde você insere a API Key para testar os endpoints diretamente.

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

O servidor sobe em `http://localhost:3000`.  
A documentação Swagger estará em `http://localhost:3000/docs`.

### Passo 6 — Configurar webhook no Meta (para messaging)

1. No [Facebook Developer Console](https://developers.facebook.com), acesse seu App
2. Em **Webhooks**, configure:
   - **Callback URL:** `https://seu-dominio.com/webhook/instagram`
   - **Verify Token:** o valor de `META_VERIFY_TOKEN` no seu `.env`
3. Assine os campos: `messages`, `messaging_postbacks`, `message_reactions`, `message_reads`
4. A API responde automaticamente ao handshake de verificação

> Em desenvolvimento, use um tunnel (ex: [ngrok](https://ngrok.com)) para expor o servidor local: `ngrok http 3000`

### Passo 7 — Cadastrar seu primeiro cliente e conta de anúncios

```bash
# 1. Criar cliente
curl -X POST http://localhost:3000/api/v1/clients \
  -H "x-api-key: minha-chave" \
  -H "Content-Type: application/json" \
  -d '{"name": "Agência XYZ", "email": "contato@xyz.com"}'

# Resposta: { "id": "uuid-do-cliente", ... }

# 2. Criar conta de anúncio
curl -X POST http://localhost:3000/api/v1/ad-accounts \
  -H "x-api-key: minha-chave" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "uuid-do-cliente",
    "adAccountId": "act_123456789",
    "accessToken": "EAAxxxxx...",
    "accountName": "Conta Principal",
    "tokenExpiresAt": "2026-12-31T00:00:00Z"
  }'

# 3. Buscar relatório de campanhas
curl "http://localhost:3000/api/v1/campaign-reports/campaigns?adAccountId=act_123456789" \
  -H "x-api-key: minha-chave"
```

---

## 7. Módulos e endpoints

> **Base URL para todos os endpoints abaixo:** `/api/v1`  
> **Header obrigatório:** `x-api-key: <MASTER_API_KEY>` (exceto Health e Webhook)

---

### 7.1 Health

Verifica se a API está de pé e se as dependências (banco e Redis) estão acessíveis. Não requer autenticação.

#### `GET /health`

```bash
curl http://localhost:3000/api/v1/health
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

### 7.2 Clients (Clientes)

Gerencia os clientes da plataforma. Cada cliente é uma empresa ou pessoa física que contrata o serviço.

#### `POST /clients` — Criar cliente

```bash
curl -X POST http://localhost:3000/api/v1/clients \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Agência XYZ",
    "email": "contato@agenciaxyz.com.br"
  }'
```

| Campo | Tipo | Obrigatório | Validação |
|-------|------|-------------|-----------|
| `name` | string | Sim | Máx. 200 caracteres |
| `email` | string | Sim | Email válido |

**Resposta 201:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Agência XYZ",
  "email": "contato@agenciaxyz.com.br",
  "isActive": true,
  "createdAt": "2026-01-15T10:00:00.000Z",
  "updatedAt": "2026-01-15T10:00:00.000Z",
  "deletedAt": null
}
```

---

#### `GET /clients` — Listar clientes

```bash
curl http://localhost:3000/api/v1/clients \
  -H "x-api-key: <KEY>"
```

**Resposta 200:** Array de `ClientEntity`

---

#### `GET /clients/:id` — Buscar cliente por ID

```bash
curl http://localhost:3000/api/v1/clients/550e8400-e29b-41d4-a716-446655440000 \
  -H "x-api-key: <KEY>"
```

**Resposta 200:** `ClientEntity`  
**Resposta 404:** `{ "statusCode": 404, "message": "Client ... not found" }`

---

#### `PATCH /clients/:id` — Atualizar cliente

```bash
curl -X PATCH http://localhost:3000/api/v1/clients/550e8400-e29b-41d4-a716-446655440000 \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{"isActive": false}'
```

| Campo | Tipo | Obrigatório | Validação |
|-------|------|-------------|-----------|
| `name` | string | Não | Máx. 200 caracteres |
| `email` | string | Não | Email válido |
| `isActive` | boolean | Não | — |

---

#### `DELETE /clients/:id` — Remover cliente (soft delete)

```bash
curl -X DELETE http://localhost:3000/api/v1/clients/550e8400-e29b-41d4-a716-446655440000 \
  -H "x-api-key: <KEY>"
```

**Resposta 204:** Sem corpo.

---

### 7.3 Integrations (Integrações Meta)

Gerencia as integrações de mensageria do cliente (Instagram e WhatsApp). Cada integração vincula uma página/número do cliente à plataforma.

> Os access tokens são criptografados no banco e **nunca** aparecem nas respostas.

#### `POST /integrations` — Criar integração

```bash
curl -X POST http://localhost:3000/api/v1/integrations \
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
curl "http://localhost:3000/api/v1/integrations?clientId=uuid-do-cliente" \
  -H "x-api-key: <KEY>"
```

| Param | Tipo | Obrigatório |
|-------|------|-------------|
| `clientId` | string (UUID) | Sim |

**Resposta 200:** Array de `IntegrationEntity`

---

#### `GET /integrations/:id` — Buscar integração por ID

```bash
curl http://localhost:3000/api/v1/integrations/uuid-da-integracao \
  -H "x-api-key: <KEY>"
```

---

#### `PATCH /integrations/:id` — Atualizar integração (rotacionar token)

```bash
curl -X PATCH http://localhost:3000/api/v1/integrations/uuid-da-integracao \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "accessToken": "EAAyyyyy...",
    "tokenExpiresAt": "2027-06-30T00:00:00Z"
  }'
```

| Campo | Tipo | Obrigatório |
|-------|------|-------------|
| `accessToken` | string | Não |
| `tokenExpiresAt` | string (ISO 8601) | Não |
| `isActive` | boolean | Não |

---

#### `DELETE /integrations/:id` — Remover integração

```bash
curl -X DELETE http://localhost:3000/api/v1/integrations/uuid-da-integracao \
  -H "x-api-key: <KEY>"
```

**Resposta 204:** Sem corpo.

---

### 7.4 Ad Accounts (Contas de Anúncio)

Gerencia as contas Meta Ads dos clientes. Cada conta de anúncio requer um **User Access Token** com permissão `ads_read` — diferente do token de mensageria.

> O `adAccountId` sempre segue o formato `act_{número}` (ex: `act_123456789`).

#### `POST /ad-accounts` — Cadastrar conta de anúncio

```bash
curl -X POST http://localhost:3000/api/v1/ad-accounts \
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
| `adAccountId` | string | Sim | Formato `act_\d+` (ex: `act_123456789`) |
| `accessToken` | string | Sim | User Access Token com `ads_read` |
| `accountName` | string | Não | Nome legível da conta |
| `tokenExpiresAt` | string | Não | ISO 8601 — omitir se token de sistema permanente |

**Resposta 201:** `AdAccountEntity` (sem `accessToken`)  
**Resposta 409:** Se `adAccountId` já está cadastrado.

---

#### `GET /ad-accounts` — Listar contas de anúncio

```bash
curl "http://localhost:3000/api/v1/ad-accounts?clientId=uuid-do-cliente" \
  -H "x-api-key: <KEY>"
```

| Param | Tipo | Obrigatório |
|-------|------|-------------|
| `clientId` | string (UUID) | Sim |

---

#### `GET /ad-accounts/expiring` — Listar tokens próximos do vencimento

Lista contas cujo token vence dentro do intervalo especificado. Útil para rotação proativa de tokens.

```bash
curl "http://localhost:3000/api/v1/ad-accounts/expiring?clientId=uuid-do-cliente&daysAhead=14" \
  -H "x-api-key: <KEY>"
```

| Param | Tipo | Obrigatório | Padrão | Máximo |
|-------|------|-------------|--------|--------|
| `clientId` | string (UUID) | Sim | — | — |
| `daysAhead` | number | Não | `7` | `90` |

**Resposta 200:** Array de `AdAccountEntity` com tokens vencendo nos próximos `daysAhead` dias.  
> Contas com `tokenExpiresAt = null` (tokens permanentes) nunca aparecem neste endpoint.

---

#### `GET /ad-accounts/:id` — Buscar conta por ID

```bash
curl http://localhost:3000/api/v1/ad-accounts/uuid-da-conta \
  -H "x-api-key: <KEY>"
```

---

#### `PATCH /ad-accounts/:id` — Atualizar conta (rotacionar token)

```bash
curl -X PATCH http://localhost:3000/api/v1/ad-accounts/uuid-da-conta \
  -H "x-api-key: <KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "accessToken": "EAAyyyyy...",
    "tokenExpiresAt": "2027-06-30T00:00:00Z"
  }'
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
curl -X DELETE http://localhost:3000/api/v1/ad-accounts/uuid-da-conta \
  -H "x-api-key: <KEY>"
```

**Resposta 204:** Sem corpo.

---

### 7.5 Campaign Reports (Relatórios de Campanhas)

Consulta dados da **Meta Marketing API** em tempo real, com cache Redis para evitar ultrapassar os limites de rate da Meta (~200 chamadas/hora por token).

Todos os endpoints buscam o token do banco, descriptografam e chamam a Meta API. Em caso de token expirado, retornam `401 Unauthorized`.

#### Respostas paginadas

Os endpoints de listagem retornam um objeto com paginação cursor-based:

```json
{
  "data": [...],
  "paging": {
    "next": "cursor_opaco_da_meta"
  }
}
```

- Se `paging.next` está presente, há mais páginas — repasse o cursor na próxima requisição
- Se `paging` está vazio (`{}`), é a última página

---

#### `GET /campaign-reports/campaigns` — Listar campanhas

```bash
# Primeira página
curl "http://localhost:3000/api/v1/campaign-reports/campaigns?adAccountId=act_123456789" \
  -H "x-api-key: <KEY>"

# Página seguinte (com cursor)
curl "http://localhost:3000/api/v1/campaign-reports/campaigns?adAccountId=act_123456789&cursor=CURSOR_DA_RESPOSTA_ANTERIOR" \
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
  "paging": {
    "next": "cursor_para_proxima_pagina"
  }
}
```

**Possíveis status de campanha:** `ACTIVE`, `PAUSED`, `DELETED`, `ARCHIVED`

---

#### `GET /campaign-reports/insights` — Insights da conta de anúncio

Retorna métricas agregadas para toda a conta ou filtradas por nível, com suporte a breakdowns temporais e demográficos.

```bash
# Básico
curl "http://localhost:3000/api/v1/campaign-reports/insights?adAccountId=act_123456789&datePreset=last_30d&level=campaign" \
  -H "x-api-key: <KEY>"

# Com breakdown diário
curl "http://localhost:3000/api/v1/campaign-reports/insights?adAccountId=act_123456789&datePreset=last_7d&timeIncrement=1" \
  -H "x-api-key: <KEY>"

# Com breakdown demográfico
curl "http://localhost:3000/api/v1/campaign-reports/insights?adAccountId=act_123456789&datePreset=last_30d&breakdowns=age,gender" \
  -H "x-api-key: <KEY>"
```

| Param | Tipo | Obrigatório | Padrão | Opções |
|-------|------|-------------|--------|--------|
| `adAccountId` | string | Sim | — | — |
| `datePreset` | string | Não | `last_30d` | `today`, `yesterday`, `last_7d`, `last_14d`, `last_30d`, `this_month`, `last_month` |
| `level` | string | Não | `campaign` | `account`, `campaign`, `adset`, `ad` |
| `cursor` | string | Não | — | Cursor de paginação retornado em `paging.next` |
| `timeIncrement` | string | Não | — | `1` (diário), `7` (semanal), `monthly`, `all_days` |
| `breakdowns` | string | Não | — | Dimensões separadas por vírgula (ver tabela abaixo) |

**Valores válidos para `breakdowns`:**

| Valor | Descrição | Campos extras na resposta |
|-------|-----------|--------------------------|
| `age` | Faixa etária | `age: "18-24"` |
| `gender` | Gênero | `gender: "male"` |
| `country` | País | `country: "BR"` |
| `region` | Estado/Região | `region: "São Paulo"` |
| `publisher_platform` | Plataforma (Facebook/Instagram) | `publisher_platform: "instagram"` |
| `device_platform` | Dispositivo | `device_platform: "mobile"` |

Múltiplos breakdowns são separados por vírgula: `breakdowns=age,gender`. A ordem não importa — `gender,age` e `age,gender` produzem o mesmo cache.

**Resposta 200 (sem breakdowns nem timeIncrement):**
```json
{
  "data": [
    {
      "campaign_id": "23843210000",
      "campaign_name": "Campanha Verão 2026",
      "impressions": "15234",
      "clicks": "892",
      "spend": "432.50",
      "reach": "12100",
      "cpm": "28.39",
      "cpc": "0.48",
      "ctr": "5.86",
      "frequency": "1.26",
      "unique_clicks": "840",
      "cost_per_unique_click": "0.51",
      "date_start": "2026-05-17",
      "date_stop": "2026-06-16",
      "actions": [
        { "action_type": "purchase", "value": "12" }
      ],
      "cost_per_action_type": [
        { "action_type": "purchase", "value": "36.04" }
      ],
      "purchase_roas": [
        { "action_type": "omni_purchase", "value": "3.45" }
      ]
    }
  ],
  "paging": {}
}
```

**Resposta 200 (com `timeIncrement=1` — um objeto por dia):**
```json
{
  "data": [
    { "campaign_id": "23843210000", "spend": "42.10", "date_start": "2026-06-10", "date_stop": "2026-06-10", ... },
    { "campaign_id": "23843210000", "spend": "38.90", "date_start": "2026-06-11", "date_stop": "2026-06-11", ... }
  ],
  "paging": { "next": "cursor_proxima_pagina" }
}
```

**Resposta 200 (com `breakdowns=age,gender` — um objeto por segmento):**
```json
{
  "data": [
    { "campaign_id": "23843210000", "age": "18-24", "gender": "male", "impressions": "3200", ... },
    { "campaign_id": "23843210000", "age": "18-24", "gender": "female", "impressions": "2800", ... },
    { "campaign_id": "23843210000", "age": "25-34", "gender": "male", "impressions": "4100", ... }
  ],
  "paging": {}
}
```

**Campos de métricas:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `impressions` | string | Total de impressões |
| `clicks` | string | Total de cliques |
| `spend` | string | Gasto (moeda da conta) |
| `reach` | string | Alcance único |
| `cpm` | string | Custo por mil impressões |
| `cpc` | string | Custo por clique |
| `ctr` | string | Taxa de cliques (%) |
| `frequency` | string | Média de impressões por usuário único |
| `unique_clicks` | string | Cliques de usuários únicos |
| `cost_per_unique_click` | string | Custo por clique único |
| `actions` | array | Eventos de conversão por tipo |
| `cost_per_action_type` | array | Custo médio por tipo de ação |
| `purchase_roas` | array | Retorno sobre gasto em anúncio (ROAS) — `[{ action_type, value }]` |
| `video_play_actions` | array | Reproduções de vídeo iniciadas |
| `video_p25_watched_actions` | array | Usuários que assistiram 25% do vídeo |
| `video_p50_watched_actions` | array | Usuários que assistiram 50% do vídeo |
| `video_p75_watched_actions` | array | Usuários que assistiram 75% do vídeo |
| `video_p100_watched_actions` | array | Usuários que assistiram o vídeo completo |

> Todos os campos numéricos são retornados como `string` pela Meta API. Campos `array` seguem o formato `[{ "action_type": string, "value": string }]`.

---

#### `GET /campaign-reports/insights/:campaignId` — Insights de uma campanha específica

Retorna métricas de uma campanha específica. Sem `timeIncrement` ou `breakdowns`, retorna um objeto único; com qualquer um, retorna uma lista paginada.

```bash
# Básico — retorna MetaInsights (objeto único)
curl "http://localhost:3000/api/v1/campaign-reports/insights/23843210000?adAccountId=act_123456789&datePreset=last_7d" \
  -H "x-api-key: <KEY>"

# Com timeIncrement — retorna PaginatedResult (um objeto por dia)
curl "http://localhost:3000/api/v1/campaign-reports/insights/23843210000?adAccountId=act_123456789&datePreset=last_7d&timeIncrement=1" \
  -H "x-api-key: <KEY>"

# Com breakdowns — retorna PaginatedResult (um objeto por segmento)
curl "http://localhost:3000/api/v1/campaign-reports/insights/23843210000?adAccountId=act_123456789&datePreset=last_30d&breakdowns=gender" \
  -H "x-api-key: <KEY>"
```

| Param | Tipo | Obrigatório | Padrão |
|-------|------|-------------|--------|
| `campaignId` | string (path) | Sim | — |
| `adAccountId` | string (query) | Sim | — |
| `datePreset` | string (query) | Não | `last_30d` |
| `timeIncrement` | string (query) | Não | — | `1`, `7`, `monthly`, `all_days` |
| `breakdowns` | string (query) | Não | — | Mesmos valores do endpoint de insights |

**Resposta 200 (sem timeIncrement e sem breakdowns):** `MetaInsights` — objeto simples (não array)  
**Resposta 200 (com timeIncrement ou breakdowns):** `PaginatedResult<MetaInsights>` — `{ data: [...], paging: { next? } }`  
**Resposta 404:** Se a campanha não tiver dados para o período selecionado (apenas sem timeIncrement/breakdowns — com eles, retorna array vazio)

---

### 7.6 Webhook Instagram

Endpoint para receber eventos do Instagram enviados pelo Meta. Não requer `x-api-key`.

> **Nota:** As rotas de webhook não têm o prefixo `/api/v1`. São acessadas diretamente em `/webhook/instagram`.

#### `GET /webhook/instagram` — Verificação do webhook (handshake)

O Meta chama este endpoint para verificar que a URL é válida quando você configura o webhook no painel de desenvolvedor.

```
GET /webhook/instagram?hub.mode=subscribe&hub.verify_token=<META_VERIFY_TOKEN>&hub.challenge=CHALLENGE_CODE
```

A API responde automaticamente com o `hub.challenge` se o `hub.verify_token` coincidir com o `.env`.

---

#### `POST /webhook/instagram` — Receber eventos do Instagram

O Meta envia eventos para este endpoint. A API valida a assinatura HMAC-SHA256 no header `x-hub-signature-256` usando o `META_APP_SECRET`.

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

**Payload de exemplo (mensagem de texto):**
```json
{
  "object": "instagram",
  "entry": [
    {
      "id": "123456789",
      "time": 1716912000,
      "messaging": [
        {
          "sender": { "id": "USER_PSID" },
          "recipient": { "id": "PAGE_ID" },
          "timestamp": 1716912000000,
          "message": {
            "mid": "m_abc123",
            "text": "Olá, quero saber sobre o produto!"
          }
        }
      ]
    }
  ]
}
```

A API retorna `200 OK` imediatamente após receber o evento (antes de qualquer processamento), conforme exigido pelo Meta.

---

## 8. Modelos de dados

### ClientEntity

```typescript
{
  id: string;              // UUID — identificador único
  name: string;            // Nome do cliente (máx 200 chars)
  email: string;           // Email único
  isActive: boolean;       // true = ativo; false = desativado (soft delete lógico)
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
  deletedAt: string | null; // Preenchido no soft delete
}
```

### IntegrationEntity

```typescript
{
  id: string;
  clientId: string;        // UUID do Client proprietário
  platform: "instagram" | "whatsapp";
  pageId: string;          // ID da página Instagram ou número WhatsApp
  // accessToken: NUNCA retornado (criptografado no banco)
  tokenExpiresAt: string | null; // ISO 8601; null = token permanente
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
  clientId: string;        // UUID do Client proprietário
  adAccountId: string;     // "act_123456789"
  accountName: string | null;
  // accessToken: NUNCA retornado (criptografado no banco)
  tokenExpiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

### MetaInsights

```typescript
{
  // Identificadores (presentes conforme nível)
  campaign_id?: string;
  campaign_name?: string;

  // Métricas base (sempre presentes)
  impressions: string;
  clicks: string;
  spend: string;
  reach: string;
  cpm: string;
  cpc: string;
  ctr: string;
  date_start: string;   // "2026-05-01"
  date_stop: string;    // "2026-05-31"

  // Frequência e cliques únicos
  frequency?: string;
  unique_clicks?: string;
  cost_per_unique_click?: string;

  // Ações de conversão
  actions?: { action_type: string; value: string }[];
  cost_per_action_type?: { action_type: string; value: string }[];

  // ROAS (retorno sobre gasto em anúncio)
  purchase_roas?: { action_type: string; value: string }[];

  // Métricas de vídeo
  video_play_actions?: { action_type: string; value: string }[];
  video_p25_watched_actions?: { action_type: string; value: string }[];
  video_p50_watched_actions?: { action_type: string; value: string }[];
  video_p75_watched_actions?: { action_type: string; value: string }[];
  video_p100_watched_actions?: { action_type: string; value: string }[];

  // Campos de breakdown (presentes quando breakdowns foram solicitados)
  age?: string;                 // "18-24", "25-34", "35-44", "45-54", "55-64", "65+"
  gender?: string;              // "male", "female", "unknown"
  country?: string;             // "BR", "US", ...
  region?: string;              // "São Paulo", ...
  publisher_platform?: string;  // "facebook", "instagram", "messenger"
  device_platform?: string;     // "mobile", "desktop"
}
```

> Todos os campos numéricos são retornados como `string` pela Meta API.

---

## 9. Cache e performance

A API usa **Redis** para cachear respostas da Meta Marketing API e evitar atingir os limites de rate.

| Recurso | Chave de cache | TTL |
|---------|---------------|-----|
| Lista de campanhas | `meta:campaigns:{adAccountId}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| Lista de campanhas (paginada) | `meta:campaigns:{adAccountId}:cursor:{cursor}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| Insights da conta (base) | `meta:insights:{adAccountId}:{level}:{datePreset}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| + timeIncrement | `meta:insights:{...}:ti:{timeIncrement}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| + breakdowns | `meta:insights:{...}:bd:{breakdowns_sorted}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| + timeIncrement + breakdowns | `meta:insights:{...}:ti:{timeIncrement}:bd:{breakdowns_sorted}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| + cursor | `meta:insights:{...}:cursor:{cursor}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| Insights de campanha (base) | `meta:insights:campaign:{campaignId}:{datePreset}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| + timeIncrement / breakdowns | `meta:insights:campaign:{...}:ti:{ti}` / `:bd:{bd}` | `INSIGHTS_CACHE_TTL_SECONDS` |
| AdAccount por ID | `ad-account:id:{id}` | `CACHE_TTL_SECONDS` (global) |
| AdAccount por act\_ | `ad-account:act:{adAccountId}` | `CACHE_TTL_SECONDS` (global) |

**Regra de composição dos sufixos:** sempre na ordem `:ti:` → `:bd:` → `:cursor:`. Breakdowns são sempre ordenados alfabeticamente antes de concatenados — `gender,age` e `age,gender` produzem a mesma chave `:bd:age,gender`.

**Para ajustar o TTL dos insights** sem redeploy, altere `INSIGHTS_CACHE_TTL_SECONDS` no `.env` e reinicie o servidor.

---

## 10. Monitoramento de tokens

Um **job agendado** verifica diariamente às 08:00 (horário de Brasília) todos os tokens de contas de anúncio ativos. Para cada token que vence em ≤ 7 dias, a API emite um log `WARN` estruturado:

```
[WARN] [TOKEN_EXPIRING] adAccountId=act_123456789 clientId=uuid-... expiresIn=5d
```

**Para consultar tokens prestes a vencer via API:**

```bash
# Tokens vencendo nos próximos 7 dias (padrão)
curl "http://localhost:3000/api/v1/ad-accounts/expiring?clientId=uuid-do-cliente" \
  -H "x-api-key: <KEY>"

# Tokens vencendo nos próximos 30 dias
curl "http://localhost:3000/api/v1/ad-accounts/expiring?clientId=uuid-do-cliente&daysAhead=30" \
  -H "x-api-key: <KEY>"
```

Contas com `tokenExpiresAt = null` (tokens de sistema permanentes) são ignoradas pelo monitoramento.

---

## 11. Erros comuns

| Status | Mensagem | Causa | Solução |
|--------|----------|-------|---------|
| `400 Bad Request` | Detalhes de validação | Body ou query params inválidos | Verifique os campos obrigatórios e formatos |
| `400 Bad Request` | `daysAhead must not be greater than 90` | `daysAhead` acima do limite | Use um valor entre 1 e 90 |
| `401 Unauthorized` | `Invalid or missing API key` | Header `x-api-key` ausente ou errado | Envie o header com o valor de `MASTER_API_KEY` |
| `401 Unauthorized` | `OAuth token expired or invalid for: act_...` | Token da Meta expirado | Rotacione o token via `PATCH /ad-accounts/:id` |
| `404 Not Found` | `Ad account ... not found` | `adAccountId` não cadastrado | Cadastre a conta antes de consultar relatórios |
| `404 Not Found` | `No insights found for campaign ...` | Campanha sem dados no período | Tente outro `datePreset` ou verifique se a campanha teve impressões |
| `409 Conflict` | `An ad account with this adAccountId already exists` | `adAccountId` duplicado | Cada conta Meta Ads só pode ser cadastrada uma vez |
| `422 Unprocessable Entity` | `Ad account ... is inactive` | Conta desativada (`isActive: false`) | Reative a conta via `PATCH /ad-accounts/:id` com `{ "isActive": true }` |

---

## 12. Limitações conhecidas

| Limitação | Detalhe |
|-----------|---------|
| **Breakdowns: combinações inválidas** | A Meta API não permite combinar `age` com `country` no mesmo request, entre outras restrições. Consulte a [documentação de breakdowns](https://developers.facebook.com/docs/marketing-api/insights/breakdowns) para combinações permitidas. Um erro da Meta será propagado como resposta de erro. |
| **Paginação em `/insights/:campaignId`** | O endpoint de campanha específica não aceita parâmetro `cursor`. Com `timeIncrement=1` em períodos longos (ex: `last_30d`), apenas os primeiros 25 dias são retornados. |
| **Breakdowns não validados na borda** | O parâmetro `breakdowns` aceita qualquer string; valores inválidos (ex: `breakdowns=foo`) retornarão erro da Meta API (não 400 do TrafegoFlow). |
| **Cache não invalidado após desativação de conta** | Se uma conta for desativada enquanto há dados em cache, esses dados continuarão sendo retornados por até `INSIGHTS_CACHE_TTL_SECONDS`. |
| **Rate limit da Meta** | A Marketing API tem limite de ~200 chamadas/hora por token (Tier 1). O cache Redis reduz o consumo, mas múltiplas combinações de breakdowns/timeIncrement podem aumentar o número de chaves únicas e chamadas. |

---

## Referências

- [Meta Marketing API — Documentação oficial](https://developers.facebook.com/docs/marketing-api)
- [Meta Webhooks para Instagram](https://developers.facebook.com/docs/instagram-api/webhooks)
- [Tipos de access tokens Meta](https://developers.facebook.com/docs/facebook-login/access-tokens)
- [Swagger UI local](http://localhost:3000/docs)
- [Guia de setup Instagram Graph API](./meta-instagram-setup.md)
