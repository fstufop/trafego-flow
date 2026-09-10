# Design: Conversation Rules — Auto-reply via Instagram Graph API

**Data:** 2026-09-09  
**Status:** Aprovado para implementação

---

## Visão Geral

Módulo `conversation-rules` que fecha o ciclo do webhook do Instagram: quando alguém comenta em um post ou envia um DM, o sistema responde automaticamente com uma mensagem configurada por client. As regras seguem uma hierarquia de prioridade: regra de post > regra de keyword > mensagem padrão do client.

---

## Triggers suportados

| Tipo | Evento Meta | Trigger | Fallback |
|------|-------------|---------|----------|
| `post_comment` | `entry[].changes[field="comments"]` | Post ID específico | Nenhum (ignora) |
| `keyword_dm` | `entry[].messaging[]` | Keyword contida no texto do DM | Regra `default` do client |
| `default` | `entry[].messaging[]` | Qualquer DM sem match de keyword | — |

---

## Modelo de dados

### Tabela `conversation_rules`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | UUID PK | Identificador único |
| `client_id` | UUID FK → `clients` | Client proprietário |
| `type` | enum | `post_comment` \| `keyword_dm` \| `default` |
| `trigger_value` | varchar \| null | Post ID (post_comment), keyword (keyword_dm), null (default) |
| `reply` | JSONB | Payload de resposta (ver abaixo) |
| `is_active` | boolean | `true` por padrão |
| `created_at` | timestamptz | — |
| `updated_at` | timestamptz | — |
| `deleted_at` | timestamptz \| null | Soft delete |

**Unicidade:** `UNIQUE (client_id, type, trigger_value)` — impede regras duplicadas para o mesmo post ou keyword.

### Estrutura do campo `reply` (JSONB)

```typescript
interface ConversationReply {
  text?: string;           // Texto da mensagem
  quickReplies?: string[]; // Botões de resposta rápida (máx. 13 chars cada, máx. 13 opções)
  waLink?: string;         // URL wa.me — concatenado ao texto como linha extra
}
```

Pelo menos um campo deve estar presente. Exemplos válidos:

```json
{ "text": "Olá! Estamos aqui 👋" }
{ "text": "Quer saber mais?", "quickReplies": ["Sim", "Não"] }
{ "text": "Fale conosco:", "waLink": "https://wa.me/5511999999999" }
{ "text": "Clique abaixo:", "quickReplies": ["Ver preços"], "waLink": "https://wa.me/5511999999999" }
```

---

## Arquitetura de módulos

```
src/modules/
├─ conversation-rules/               ← NOVO
│   ├─ conversation-rules.module.ts
│   ├─ conversation-rules.controller.ts
│   ├─ conversation-rules.service.ts
│   ├─ conversation-rules.service.spec.ts
│   ├─ entities/
│   │   └─ conversation-rule.entity.ts
│   ├─ dto/
│   │   ├─ create-conversation-rule.dto.ts
│   │   └─ update-conversation-rule.dto.ts
│   └─ enums/
│       └─ rule-type.enum.ts
│
└─ webhook/instagram/                ← MODIFICADO
    ├─ instagram-webhook.service.ts  ← adiciona handleComment(), handleDm(), fire-and-forget
    ├─ conversation-bot.service.ts   ← NOVO — orquestra matching + envio
    ├─ conversation-bot.service.spec.ts
    ├─ reply-builder.service.ts      ← NOVO — monta payload para InstagramGraphService
    ├─ reply-builder.service.spec.ts
    └─ interfaces/
        └─ instagram-webhook-event.interface.ts  ← adiciona tipo CommentChangeEvent
```

---

## Fluxo de dados

```
POST /webhook/instagram
  │
  ├─ InstagramWebhookService.validateSignature()   ← síncrono
  ├─ Retorna 200 OK imediatamente
  │
  └─ (fire-and-forget — sem await no loop de eventos)
       │
       ├─ entry.messaging[] (DMs)
       │     └─ ConversationBotService.handleDm(pageId, senderId, text)
       │           ├─ clientId = IntegrationsService.findByPageId(pageId).clientId
       │           ├─ keyword match → ConversationRulesService.findKeywordRule(clientId, text)
       │           ├─ sem match    → ConversationRulesService.findDefaultRule(clientId)
       │           ├─ regra ativa  → ReplyBuilderService.build(rule.reply)
       │           └─ InstagramGraphService.send*(pageId, senderId, ...)
       │
       └─ entry.changes[] (field = "comments")
             └─ ConversationBotService.handleComment(pageId, postId, commenterId)
                   ├─ clientId = IntegrationsService.findByPageId(pageId).clientId
                   ├─ ConversationRulesService.findPostRule(clientId, postId)
                   ├─ regra ativa  → ReplyBuilderService.build(rule.reply)
                   └─ InstagramGraphService.send*(pageId, commenterId, ...)
```

### Matching de keyword

- Match é `case-insensitive` e `contains` (não exact): texto do DM contém a keyword
- Se múltiplas keywords do client dão match, vence a **mais longa** (mais específica)
- Ignora mensagens do próprio pageId como sender (loop prevention)

### Construção da resposta (ReplyBuilderService)

| Combinação de campos `reply` | Chamada gerada |
|------------------------------|----------------|
| só `text` | `sendTextMessage(pageId, recipientId, text)` |
| `text` + `quickReplies` | `sendQuickReplies(pageId, recipientId, text, options)` |
| `text` + `waLink` | `sendTextMessage(pageId, recipientId, text + "\n" + waLink)` |
| `text` + `quickReplies` + `waLink` | `sendQuickReplies(...)` com waLink no texto |

---

## Endpoints da API

**Base:** `/api/v1/conversation-rules`  
**Auth:** `x-api-key` ou JWT Bearer

### `POST /conversation-rules` — Criar regra

```json
{
  "clientId": "uuid",
  "type": "post_comment",
  "triggerValue": "17841400000000000",
  "reply": {
    "text": "Oi! Fala com a gente no WhatsApp 👇",
    "waLink": "https://wa.me/5511999999999"
  }
}
```

| Campo | Tipo | Obrigatório | Validação |
|-------|------|-------------|-----------|
| `clientId` | UUID | Sim | FK válido |
| `type` | enum | Sim | `post_comment`, `keyword_dm`, `default` |
| `triggerValue` | string | Condicional | Obrigatório se type ≠ `default` |
| `reply` | objeto | Sim | Pelo menos um campo presente |
| `reply.text` | string | Não | Máx. 2000 chars |
| `reply.quickReplies` | string[] | Não | Máx. 13 itens, cada um máx. 13 chars |
| `reply.waLink` | string | Não | URL válida iniciando com `https://wa.me/` |

**409 Conflict** se já existe regra ativa com mesmo `(clientId, type, triggerValue)`.

### `GET /conversation-rules?clientId=uuid` — Listar

Retorna todas as regras ativas do client, ordenadas por `type` depois `trigger_value`.

### `PATCH /conversation-rules/:id` — Atualizar

Campos atualizáveis: `reply`, `isActive`, `triggerValue`.

### `DELETE /conversation-rules/:id` — Soft delete

**204 No Content.**

---

## Mudanças no webhook existente

### `instagram-webhook.service.ts`

1. No `handleEvent`, após `validateSignature`, retornar `void` imediatamente e processar em background:
   ```typescript
   // antes (bloqueia)
   for (const event of entry.messaging) await this.processEvent(...)
   
   // depois (fire-and-forget)
   setImmediate(() => this.dispatchEvents(payload));
   ```

2. Adicionar iteração sobre `entry.changes[]` filtrando `field === 'comments'`.

### `interfaces/instagram-webhook-event.interface.ts`

Adicionar tipo `InstagramCommentChangeEvent`:
```typescript
interface InstagramCommentChangeEvent {
  field: 'comments';
  value: {
    from: { id: string; name: string };
    post_id: string;
    comment_id: string;
    message: string;
    item: 'comment';
    verb: 'add' | 'edited' | 'remove';
  };
}
```

Processar apenas quando `verb === 'add'` (ignora edições e remoções).

---

## Tratamento de erros

| Situação | Comportamento |
|----------|---------------|
| Nenhuma regra encontrada para DM | Silêncio — sem log, sem resposta |
| Nenhuma regra para o post (comentário) | Silêncio |
| Token OAuth expirado (`OAuthTokenExpiredException`) | `logger.warn` — não retenta |
| Graph API 5xx / timeout | `logger.error` — não retenta |
| `senderId === pageId` (loop) | Ignora antes de qualquer busca de regra |
| `verb !== 'add'` em comment | Ignora — não processa edições/remoções |

---

## Testes

| Arquivo | Cenários obrigatórios |
|---------|----------------------|
| `conversation-rules.service.spec.ts` | Criação com unicidade (409), findKeywordRule (match mais longo), findDefaultRule, findPostRule |
| `reply-builder.service.spec.ts` | Todas as 4 combinações de campos `reply` → payload correto |
| `conversation-bot.service.spec.ts` | handleDm: match keyword, fallback default, sem regra (silêncio), loop prevention; handleComment: com regra, sem regra |
| `instagram-webhook.service.spec.ts` | handleEvent: changes[] roteados para handleComment, messaging[] para handleDm, fire-and-forget (não bloqueia) |

---

## Endpoint auxiliar — listar posts do Instagram

Para facilitar a criação de regras `post_comment`, o módulo expõe um endpoint que lista as mídias recentes da página via Graph API:

```
GET /conversation-rules/posts?clientId=uuid&pageId=123456789
```

Internamente chama `GET /{ig-user-id}/media?fields=id,caption,timestamp,permalink` usando o token da integração do client. Retorna:

```json
[
  {
    "id": "17841400000000000",
    "caption": "Novo produto disponível! 🔥",
    "timestamp": "2026-09-01T12:00:00Z",
    "permalink": "https://www.instagram.com/p/ABC123/"
  }
]
```

O campo `id` é o valor a usar como `triggerValue` ao criar uma regra `post_comment`.

---

## Configuração de webhook no Meta (passo de deploy)

Esta etapa é feita **uma única vez** no painel de desenvolvedores, não pelo código:

1. Acesse [developers.facebook.com](https://developers.facebook.com) → seu App → **API do Instagram → Webhooks**
2. Em **"URL de callback"**, insira: `https://seu-dominio.com/webhook/instagram`
3. Em **"Verificar token"**, insira o valor de `META_VERIFY_TOKEN` do `.env`
4. Clique em **"Verificar e salvar"** — o Meta chama `GET /webhook/instagram` para confirmar
5. Após salvar, na linha **`comments`**, ative o toggle da coluna **"Assinar"**

> Em desenvolvimento, use ngrok para expor o servidor: `ngrok http 3002`

O campo `messages` (DMs) deve já estar assinado para o webhook existente funcionar. O campo `comments` é o que habilita o recebimento de eventos de comentários em posts.

---

## Variáveis de ambiente

Nenhuma nova — usa as existentes (`META_GRAPH_API_URL`, `META_GRAPH_API_VERSION`, `ENCRYPTION_KEY`).

---

## Limitações conhecidas

- **Sem retry:** falhas de envio são logadas e descartadas. Para produção com SLA, adicionar BullMQ.
- **Keyword match simples:** busca por `contains`, sem NLP. Suficiente para palavras-chave de campanha.
- **quickReplies:** limite da Meta é 13 botões, cada título máx. 13 caracteres — validado no DTO.
- **Comentários em anúncios vs. posts orgânicos:** a subscription `comments` do Meta pode requerer permissões adicionais (`pages_read_engagement`). Verificar no App Review se necessário.
