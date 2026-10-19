# Relatório: Disparo de Mensagens no Instagram a partir de Comentário em Post ou DM

**Spec de referência:** `tasks/specs/instagram_graph_api_spec.md`
**Data:** 2026-10-16
**Tipo:** Relatório de estado atual + lacunas (não é uma implementação greenfield — a maior parte já existe)

---

## 1. Conclusão Principal

A funcionalidade pedida **já está, em grande parte, implementada** no código atual. O fluxo completo
"seguidor comenta um post ou manda DM → bot identifica o cliente (tenant) → responde automaticamente via
Instagram Graph API" existe e tem testes unitários. O que falta não é "construir do zero", e sim:

1. Fechar 3 lacunas técnicas no código existente (risco real de falha em produção).
2. Resolver pré-requisitos **fora do código**, do lado do Meta/Instagram (App Review, verificação de negócio,
   permissões) — isso normalmente é o gargalo real, não o desenvolvimento.
3. Decidir sobre robustez operacional (fila, retries, janela de mensagens) antes de escalar para múltiplos clientes.

---

## 2. O Que Já Existe (Inventário)

| Camada (do README) | Componente no código | Caminho |
|---|---|---|
| Webhook Receiver | `InstagramWebhookController` — `GET` (verificação hub.challenge) e `POST` (recepção de eventos) | `src/modules/webhook/instagram/instagram-webhook.controller.ts` |
| Webhook Receiver | Validação de assinatura HMAC-SHA256 (`X-Hub-Signature-256`) com `timingSafeEqual` | `src/modules/webhook/instagram/instagram-webhook.service.ts` |
| Message Parser & Tenant Router | `dispatchEntry` separa eventos de DM (`messaging`) e de comentário (`changes.field=comments`, `verb=add`) e roteia por `pageId` | mesmo arquivo acima |
| Message Parser & Tenant Router | `IntegrationsService.findByPageId` resolve `pageId → clientId` | `src/modules/integrations/integrations.service.ts` |
| Token Manager & Encryptor | `IntegrationEntity` (token criptografado, por cliente/plataforma) + CRUD com `x-api-key` | `src/modules/integrations/*` |
| Token Manager & Encryptor | `AesCryptoService` (AES-256-GCM) para criptografar/descriptografar o `accessToken` | `src/common/crypto/aes.service.ts` |
| Token Manager & Encryptor | Cache Redis `integration:page:{pageId}` e `integration:id:{id}` (TTL configurável) — evita 1 query por mensagem | `integrations.service.ts` |
| Bot Logic / NLP Engine | `ConversationBotService.handleDm` / `handleComment` — decide qual regra aplicar | `src/modules/webhook/instagram/conversation-bot.service.ts` |
| Bot Logic / NLP Engine | `ConversationRulesService` — regras por tipo: `KEYWORD_DM` (palavra-chave em DM), `POST_COMMENT` (comentário em post específico), `DEFAULT` (fallback) | `src/modules/conversation-rules/*` |
| Bot Logic / NLP Engine | CRUD de regras via API (`POST/GET/PATCH/DELETE /conversation-rules`) + endpoint para listar posts recentes do cliente (`GET /conversation-rules/posts`) | `conversation-rules.controller.ts` |
| Automated Reply | `InstagramGraphService` — `sendTextMessage`, `sendQuickReplies`, `markSeen` via `POST /v21.0/me/messages` | `src/modules/webhook/instagram/instagram-graph.service.ts` |
| Automated Reply | `ReplyBuilderService` — monta texto + link de WhatsApp + quick replies a partir da regra | `reply-builder.service.ts` |
| Automated Reply | Tratamento de token expirado (`error.code === 190` → `OAuthTokenExpiredException`) | `instagram-graph.service.ts` |

**Testes existentes:** `instagram-webhook.service.spec.ts`, `instagram-graph.service.spec.ts`, `conversation-bot.service.spec.ts`,
`reply-builder.service.spec.ts`, `conversation-rules.service.spec.ts`, `integrations.service.spec.ts` — cobrem os
cenários felizes e os principais erros (assinatura inválida, pageId desconhecido, token expirado).

**Variáveis de ambiente já previstas** em `.env.example`: `ENCRYPTION_KEY`, `META_APP_SECRET`, `META_VERIFY_TOKEN`,
`META_GRAPH_API_URL`, `META_GRAPH_API_VERSION`. `main.ts` já habilita `rawBody: true` (necessário para validar assinatura).

---

## 3. Lacunas Técnicas Identificadas no Código Atual

| # | Lacuna | Onde | Risco | Severidade |
|---|---|---|---|---|
| 1 | Resposta a comentário usa `recipient: { id: commenterId }` (IGSID) em vez de `recipient: { comment_id }` | `instagram-webhook.service.ts:51` chama `handleComment(entry.id, post_id, from.id)` — **não propaga `comment_id`**; `instagram-graph.service.ts` só tem `sendTextMessage`/`sendQuickReplies` por IGSID | A API de "private reply" do Meta é desenhada para `recipient.comment_id` na primeira interação. Enviar direto por IGSID pode falhar com erro de "fora da janela de mensagens" para comentaristas que nunca mandaram DM à página | **Alta** — pode fazer o recurso de comentário simplesmente não funcionar em produção |
| 2 | Processamento do webhook é "fire-and-forget" via `setImmediate`, sem fila | `instagram-webhook.service.ts:32` | Em pico de campanha (muitos comentários/DMs simultâneos), falhas não são reprocessadas e não há backoff/retry. O projeto já usa BullMQ para outras features — não está sendo reaproveitado aqui | Média |
| 3 | Sem controle da janela de mensagens (24h padrão / 7 dias para comentário) | não existe lógica de janela em nenhum service | Enviar fora da janela permitida gera erro da Graph API (código 10 / 551, etc.) sem tratamento específico, só loga `warn` | Média |
| 4 | Rate limit da Graph API (200 msg/hora por usuário, mencionado na própria spec) não é tratado explicitmente | `instagram-graph.service.ts` só trata erro 190 | Erros 429 não têm retry/backoff | Baixa-Média |
| 5 | Não existe fluxo de OAuth para o cliente conectar a própria conta — o token é inserido manualmente via `POST /integrations` | `integrations.controller.ts` | Operacionalmente, cada novo cliente exige que alguém do time pegue o token manualmente no Graph API Explorer / Meta Business Suite e cole na API | Baixa (aceitável no estágio atual, mas não escala) |
| 6 | Sem persistência de histórico de conversa/mensagens recebidas (mencionado como "fora do escopo" na spec original, seção 17) | — | Sem isso não dá para auditar o que foi respondido, nem alimentar um NLP mais sofisticado depois | Baixa (decisão consciente, não bug) |

---

## 4. Pré-requisitos Fora do Código (Meta / Instagram) — normalmente o maior gargalo

Para o disparo funcionar de verdade na conta de um cliente, é necessário, por cliente:

1. **Conta Instagram Profissional (Business ou Creator)** vinculada a uma **Página do Facebook**.
2. **Meta App** no Meta for Developers com o produto **Webhooks** e **Instagram** configurados.
3. **Permissões (scopes)** aprovadas via App Review para uso em produção (fora do modo de desenvolvimento/testers):
   - `instagram_business_basic`
   - `instagram_business_manage_messages` (enviar/receber DM)
   - `instagram_business_manage_comments` (ler/responder comentários)
4. **Verificação de negócio (Business Verification)** no Meta Business Manager — exigida para apps que pedem
   permissões avançadas de mensagens em produção.
5. **App Review** do Meta aprovando o caso de uso real (vídeo de demonstração do fluxo, justificativa de uso de cada permissão).
6. **Webhook público em HTTPS** (domínio real em produção; em dev, `ngrok`/`cloudflared`) registrado no painel do
   app com o `META_VERIFY_TOKEN` configurado.
7. **Token de acesso de longa duração** por página/conta Instagram do cliente (long-lived token ou System User Token),
   gerado e inserido via `POST /integrations`.
8. Cada cliente precisa dar permissão ("conectar conta") para o app acessar a própria conta Instagram Business —
   hoje isso é feito manualmente (ver lacuna #5 acima).

**Sem os itens 1–5, o Meta bloqueia o uso em contas de clientes reais** mesmo com o código 100% pronto — isso só
funciona sem App Review para contas de "testers" cadastradas manualmente no app (bom para validar o fluxo, não para
rodar com clientes de verdade).

---

## 5. Plano de Ação Recomendado (fechar as lacunas, não reconstruir)

### Tarefa 1 — Corrigir resposta a comentário para usar `comment_id` ✅ CONCLUÍDA (2026-10-18)
**Arquivos alterados:**
- `interfaces/instagram-graph.interface.ts` — novo método `sendCommentPrivateReply(pageId, commentId, text)`
- `instagram-graph.service.ts` — implementa `sendCommentPrivateReply` fazendo `POST /me/messages` com `recipient: { comment_id }` em vez de `recipient: { id: igsid }`
- `reply-builder.service.ts` — novo método `sendCommentReply(pageId, commentId, reply)`; quick replies são ignoradas nesse caminho (a API de private reply a comentário não suporta `quick_replies`); lógica de montagem de texto (`buildText`) extraída e reaproveitada por `send` e `sendCommentReply`
- `conversation-bot.service.ts` — `handleComment` agora recebe `commentId` (em vez de `commenterId`, que não era mais necessário) e chama `replyBuilder.sendCommentReply`
- `instagram-webhook.service.ts` — `dispatchEntry` propaga `change.value.comment_id` em vez de `change.value.from.id`
- Specs correspondentes atualizados: `instagram-webhook.service.spec.ts`, `conversation-bot.service.spec.ts`, `reply-builder.service.spec.ts`, `instagram-graph.service.spec.ts` (+5 testes novos, 30/30 passando no módulo)

**Resultado:** `npm run build` ok; testes do módulo `webhook/instagram` (4 suítes, 30 testes) passando; nenhum arquivo fora do escopo foi alterado.
**Observação:** 4 erros de lint pré-existentes (`no-unsafe-assignment`/`no-unsafe-member-access` em `instagram-graph.service.spec.ts`, no padrão `mock.calls[0][1]`) continuam lá — não foram introduzidos por esta mudança e não bloqueiam o build.

### Tarefa 2 — Mover processamento do webhook para fila (BullMQ) ✅ CONCLUÍDA (2026-10-18)
**Arquivos criados:**
- `types/instagram-webhook-job.type.ts` — `InstagramDmJobPayload` e `InstagramCommentJobPayload`
- `processors/instagram-webhook.processor.ts` — `InstagramWebhookProcessor` (`@Processor('instagram-webhook')`, extends `WorkerHost`), despacha por `job.name` (`dm` | `comment`) para `ConversationBotService`
- `processors/instagram-webhook.processor.spec.ts` — 3 testes novos

**Arquivos alterados:**
- `instagram-webhook.service.ts` — `handleEvent` agora é `async` e **enfileira** (`queue.add('dm'|'comment', payload, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } })`) em vez de chamar `ConversationBotService` direto via `setImmediate`. A dependência de `ConversationBotService` foi removida daqui (passou a viver só no processor).
- `instagram-webhook.controller.ts` — `handleEvent` agora é `async` e aguarda o enqueue antes de responder 200 (operação rápida contra o Redis — garante que o job não se perde se o processo cair logo após o ACK ao Meta, ao custo de poucos ms de latência)
- `webhook.module.ts` — `BullModule.registerQueue({ name: 'instagram-webhook' })` + `InstagramWebhookProcessor` nos providers
- `instagram-webhook.service.spec.ts` — reescrito para validar o enqueue (payload e opções de retry) em vez da chamada direta ao bot

**Resultado:** `npm run build` ok; módulo `webhook/instagram` com 5 suítes / 33 testes passando (eram 4/30); nenhum arquivo fora do escopo alterado.
**Depende de:** nada — foi feito em paralelo/depois da Tarefa 1
**Nota de design:** retry de 3 tentativas com backoff exponencial (2s, 4s, 8s) é o padrão adotado; falha de enqueue (ex: Redis fora do ar) é logada como warning e não derruba o 200 ao Meta, evitando que o Meta fique reenviando o mesmo evento indefinidamente — trade-off aceitável pois a própria fila já é a camada de confiabilidade.

### Tarefa 3 — Tratar rate limit (429) e janela de mensagens expirada
**Arquivo:** `instagram-graph.service.ts`
**O que fazer:** mapear erros conhecidos da Graph API (429, código de janela expirada) para exceptions específicas, sem retry automático indiscriminado
**Depende de:** Tarefa 2 (para decidir reenvio via fila)
**Testável:** testes unitários com mocks de erro 429 / janela expirada

### Tarefa 4 — Checklist de setup Meta por cliente (processo, não código)
**O que fazer:** documentar (README interno) o passo a passo para conectar um novo cliente: criar app/página de teste, obter token, registrar em `/integrations`, registrar regras em `/conversation-rules`
**Depende de:** nada
**Testável:** um cliente piloto completando o fluxo ponta a ponta

### Tarefa 5 (opcional, não bloqueante) — Fluxo de conexão OAuth self-service
**O que fazer:** endpoint que inicia OAuth do Meta e troca `code` por long-lived token automaticamente, eliminando o passo manual
**Depende de:** Tarefa 4 validada manualmente primeiro
**Testável:** e2e do fluxo de autorização

---

## 6. Estimativa

| Tarefa | Complexidade | Estimativa |
|---|---|---|
| 1 — Corrigir reply de comentário (`comment_id`) | Média | 1-2h |
| 2 — Fila BullMQ para processamento do webhook | Média | 2-3h |
| 3 — Tratamento de rate limit / janela expirada | Baixa-Média | 1h |
| 4 — Checklist de setup Meta por cliente | Baixa (processo) | 1h |
| 5 — OAuth self-service (opcional) | Alta | 4-6h |

**Total (sem o item opcional 5):** ~5-7h de desenvolvimento, mais o tempo de **App Review do Meta**, que é o item
que realmente determina o prazo (histórico de mercado: dias a poucas semanas, fora do nosso controle).

---

## 7. Riscos e Dependências

- **Maior risco é externo:** aprovação do Meta (App Review + Business Verification) para as permissões
  `instagram_business_manage_messages` e `instagram_business_manage_comments` — sem isso, só funciona com testers.
- **Risco técnico real:** item #1 da seção 3 (resposta a comentário via IGSID em vez de `comment_id`) pode já estar
  quebrado em produção para comentaristas sem conversa prévia — vale validar com uma conta de teste antes de divulgar o recurso.
- **Dependência de infraestrutura:** domínio público HTTPS estável para o webhook em produção (hoje a URL de
  produção precisa estar registrada no painel do Meta).
- **Escala:** o limite de 200 mensagens/hora por usuário destinatário (da própria Graph API) não afeta o volume
  agregado da plataforma, mas deve ser considerado se um único lead trocar muitas mensagens em pouco tempo.
