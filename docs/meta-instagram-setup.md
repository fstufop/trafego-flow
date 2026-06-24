# Configuração do App Meta para Instagram Messaging API

Este guia cobre a criação e configuração completa de um app Meta para integrar a **Instagram Messaging API** com o TrafegoFlow, do zero até o primeiro teste de webhook.

---

## Pré-requisitos

- Conta no [Facebook for Developers](https://developers.facebook.com)
- Conta no **Facebook Business Manager** (necessário para apps Business)
- Uma **Página do Instagram Business** (ou Creator) conectada a uma Página do Facebook
- API do TrafegoFlow rodando localmente ou em produção com HTTPS

> **Importante:** o Instagram Messaging API exige que a conta do Instagram seja do tipo **Business** ou **Creator**. Contas pessoais não funcionam.

---

## Parte 1 — Criar o App no Meta

### 1.1 Acessar o painel de apps

1. Acesse [developers.facebook.com](https://developers.facebook.com)
2. Clique em **"Meus apps"** no topo
3. Clique em **"Criar app"**

### 1.2 Selecionar o tipo correto

Na tela de criação, selecione:

- **Tipo:** `Business`  
  *(não selecione Consumer — ele não dá acesso à Instagram Messaging API)*

Clique em **"Próximo"**.

### 1.3 Preencher os dados básicos

| Campo | Valor sugerido |
|---|---|
| Nome do app | `TrafegoFlow` |
| Email de contato | seu email |
| Conta Business | selecione sua conta do Business Manager |

Clique em **"Criar app"**.

---

## Parte 2 — Adicionar o Produto Instagram

Após criar o app, você estará no painel principal.

1. Role a página até a seção **"Adicionar produtos ao seu app"**
2. Localize o card **Instagram** e clique em **"Configurar"**
3. O menu esquerdo vai ganhar a seção **"Instagram"**

---

## Parte 3 — Conectar a Página do Instagram

### 3.1 Acessar configurações do Instagram

No menu esquerdo, clique em **Instagram → Configurações da API** (ou **Básico**).

### 3.2 Adicionar uma Conta do Instagram de Teste

1. Em **"Tokens de acesso"**, clique em **"Adicionar ou remover páginas do Instagram"**
2. Faça login com a conta do Facebook que administra a Página conectada ao Instagram Business
3. Selecione a Página do Facebook que está vinculada à conta Instagram desejada
4. Autorize as permissões solicitadas

Após autorizar, a conta Instagram aparecerá na lista com um botão **"Gerar token"**.

### 3.3 Gerar o Token de Acesso

1. Clique em **"Gerar token"** ao lado da conta Instagram
2. Confirme as permissões (marque `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`)
3. Copie o token gerado — este é o seu **Page Access Token** (token de curta duração)

> Este token expira em ~1 hora. Na seção [Parte 6](#parte-6--obter-token-de-longa-duração) você aprende a converter para longa duração.

---

## Parte 4 — Configurar o Webhook

O webhook é o endpoint que o Meta vai chamar toda vez que uma mensagem chegar no Instagram.

### 4.1 Acessar a configuração de Webhooks

No menu esquerdo: **Instagram → Webhooks**  
*(se não aparecer, verifique se o produto Instagram foi adicionado corretamente na Parte 2)*

### 4.2 Configurar o endpoint

Clique em **"Configurar"** ou **"Editar assinatura"** e preencha:

| Campo | Valor |
|---|---|
| **URL de retorno de chamada** | `https://sua-api.com/webhook/instagram` |
| **Token de verificação** | o valor que você definiu em `META_VERIFY_TOKEN` no seu `.env` |

Exemplo de URL local com ngrok:
```
https://abc123.ngrok-free.app/webhook/instagram
```

> **A API precisa estar rodando antes de clicar em "Verificar"** — o Meta faz uma requisição `GET` imediatamente para validar.

### 4.3 Verificar e salvar

Clique em **"Verificar e salvar"**. O Meta vai fazer:

```
GET /webhook/instagram?hub.mode=subscribe&hub.verify_token=SEU_TOKEN&hub.challenge=NUMERO_ALEATORIO
```

Se sua API responder com o `hub.challenge`, a verificação passa com sucesso.

### 4.4 Assinar os campos (Subscription Fields)

Após verificar, você precisa assinar os eventos que quer receber. Clique em **"Assinar"** nos campos:

- `messages` — mensagens recebidas (obrigatório)
- `messaging_postbacks` — cliques em botões
- `messaging_seen` — confirmações de leitura

---

## Parte 5 — Obter as Credenciais

Agora colete os valores para o seu `.env`.

### 5.1 App Secret

**Configurações do app → Básico → Segredo do app**

Clique em **"Mostrar"**, confirme sua senha do Facebook e copie o valor.

```bash
META_APP_SECRET=abc123def456...
```

### 5.2 Verify Token

Este valor **você define** — pode ser qualquer string difícil de adivinhar. Use o mesmo valor nos dois lugares:

```bash
# No .env
META_VERIFY_TOKEN=trafegoflow-prod-k9x2m7

# E no painel do Meta (campo "Token de verificação" da Parte 4.2)
```

### 5.3 Page Access Token (para enviar mensagens)

O token gerado na Parte 3.3. Usado ao cadastrar a integração via API:

```bash
POST /api/v1/integrations
{
  "clientId": "uuid-do-client",
  "platform": "instagram",
  "pageId": "SEU_PAGE_ID",
  "accessToken": "EAABsbCS7Zolg..."
}
```

### 5.4 Encontrar o Page ID (Instagram)

No painel: **Instagram → Configurações da API → Tokens de acesso**

O número abaixo do nome da conta Instagram é o **Page ID** — use-o como `pageId` ao cadastrar a integração.

### 5.5 Encryption Key

Gere localmente — não vem do Meta:

```bash
openssl rand -hex 32
```

```bash
ENCRYPTION_KEY=a3f8c2d1e4b7a09f3c6d2e5b8a1f4c7d0e3b6a9f2c5d8e1b4a7f0c3d6e9b2a5
```

---

## Parte 6 — Obter Token de Longa Duração

O token gerado pelo painel dura ~1 hora. Para uso em produção, converta para longa duração (60 dias).

### 6.1 Fazer a troca via Graph API

```bash
curl -X GET "https://graph.facebook.com/v21.0/oauth/access_token" \
  -d "grant_type=fb_exchange_token" \
  -d "client_id=SEU_APP_ID" \
  -d "client_secret=SEU_APP_SECRET" \
  -d "fb_exchange_token=TOKEN_CURTA_DURACAO"
```

A resposta vai conter um novo token com expiração de 60 dias:

```json
{
  "access_token": "EAABsbCS7Zolg_TOKEN_LONGA_DURACAO...",
  "token_type": "bearer",
  "expires_in": 5183944
}
```

### 6.2 Usar o token longo ao cadastrar a integração

```bash
POST /api/v1/integrations
{
  "clientId": "uuid-do-client",
  "platform": "instagram",
  "pageId": "123456789",
  "accessToken": "EAABsbCS7Zolg_TOKEN_LONGA_DURACAO...",
  "tokenExpiresAt": "2024-07-27T00:00:00Z"
}
```

O TrafegoFlow vai criptografar o token com AES-256-GCM antes de salvar.

---

## Parte 7 — Testar Localmente com ngrok

Para expor sua API local ao Meta durante o desenvolvimento:

### 7.1 Instalar e configurar ngrok

```bash
# Instalar (macOS)
brew install ngrok

# Autenticar (necessário uma vez)
ngrok config add-authtoken SEU_TOKEN_NGROK
```

### 7.2 Expor a porta local

```bash
ngrok http 3000
```

A saída vai mostrar algo como:
```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:3000
```

### 7.3 Atualizar a URL no painel do Meta

Use a URL do ngrok como callback:
```
https://abc123.ngrok-free.app/webhook/instagram
```

> A URL do ngrok muda a cada restart (no plano gratuito). Atualize no painel do Meta sempre que reiniciar o ngrok.

### 7.4 Subir a API com as variáveis corretas

```bash
# .env local
META_APP_SECRET=seu_app_secret
META_VERIFY_TOKEN=trafegoflow-dev-local
ENCRYPTION_KEY=<64 hex chars>

npm run start:dev
```

### 7.5 Validar o webhook

Com a API rodando, clique em **"Verificar e salvar"** no painel do Meta. Você deve ver no terminal:

```
[InstagramWebhookController] GET /webhook/instagram — hub.challenge respondido
```

---

## Parte 8 — Teste de Ponta a Ponta

### 8.1 Cadastrar a integração

```bash
curl -X POST http://localhost:3000/api/v1/integrations \
  -H "x-api-key: SEU_MASTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "uuid-do-client-criado",
    "platform": "instagram",
    "pageId": "SEU_PAGE_ID",
    "accessToken": "TOKEN_LONGA_DURACAO"
  }'
```

### 8.2 Enviar uma mensagem de teste

1. Com uma conta Instagram diferente da que tem o app configurado
2. Mande uma DM para a conta Instagram Business conectada
3. Observe os logs no terminal da API:

```
[InstagramWebhookService] [client:uuid-do-client] event from igsid:USER_123 — text="Olá"
```

### 8.3 Verificar assinatura no Postman/curl

Você também pode simular um evento manualmente, gerando a assinatura correta:

```bash
# Gerar assinatura HMAC-SHA256
BODY='{"object":"instagram","entry":[{"id":"PAGE_ID","time":1700000000,"messaging":[]}]}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "SEU_APP_SECRET" | cut -d' ' -f2)

curl -X POST http://localhost:3000/webhook/instagram \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$SIG" \
  -d "$BODY"
```

Resposta esperada: `200 OK`

---

## Resumo das Variáveis de Ambiente

| Variável | Origem | Exemplo |
|---|---|---|
| `ENCRYPTION_KEY` | `openssl rand -hex 32` | `a3f8c2...` (64 chars) |
| `META_APP_SECRET` | Painel Meta → Configurações → Básico → Segredo do app | `abc123def456...` |
| `META_VERIFY_TOKEN` | Você define (qualquer string) | `trafegoflow-prod-k9x2` |
| `META_GRAPH_API_URL` | Fixo | `https://graph.facebook.com` |
| `META_GRAPH_API_VERSION` | Fixo | `v21.0` |

---

## Troubleshooting

**"Verificação falhou" no painel do Meta**
- Confirme que a API está rodando e acessível pela URL pública
- Confirme que `META_VERIFY_TOKEN` no `.env` é idêntico ao campo no painel do Meta
- Verifique nos logs se o `GET /webhook/instagram` está chegando

**403 Forbidden nos eventos POST**
- O `META_APP_SECRET` no `.env` está incorreto
- A assinatura HMAC não bate — verifique se `rawBody: true` está ativo em `main.ts`

**Token expirado ao enviar mensagem**
- Use o token de longa duração (Parte 6)
- O erro `OAuthTokenExpiredException` nos logs indica que o token precisa ser rotacionado via `PATCH /api/v1/integrations/:id`

**Webhook não recebe eventos**
- Confirme que os campos `messages` estão assinados (Parte 4.4)
- Confirme que o app não está em modo de desenvolvimento sem usuários de teste cadastrados
