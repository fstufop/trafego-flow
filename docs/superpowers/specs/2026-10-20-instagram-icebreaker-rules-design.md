# Design: Regras de Icebreaker do Instagram — DM automática com botão para grupo VIP

**Data:** 2026-10-20
**Status:** Proposto

---

## Intenção e contexto

O objetivo é dar ao traffic manager um jeito de levar novos seguidores do Instagram para um grupo VIP do WhatsApp, sem intervenção manual.

A ideia original era reagir a um evento de "novo seguidor". Isso não é viável:

- **Não existe webhook de novo seguidor** na Graph API do Instagram, para nenhum desenvolvedor — nem a própria documentação de webhooks nem a comunidade de integradores (Make, etc.) encontram esse campo. O recurso "Follow to DM" do ManyChat (lançado em out/2025) é um beta fechado controlado conta a conta pela própria Meta, não uma API pública.
- **Polling de seguidores também não é viável**, por dois motivos independentes: (1) a Graph API só expõe `followers_count` (um número), não uma lista de IDs de seguidores; (2) mesmo com o ID, a política de mensageria do Instagram só permite enviar DM para quem **já iniciou conversa** — não existe envio "frio".

O caminho real e documentado pela Meta é o **Icebreaker**: até 4 perguntas pré-definidas que aparecem quando alguém abre a DM com a conta pela primeira vez. Ao tocar numa pergunta, chega um webhook `messaging_postback` com um payload que nós definimos. O gatilho, portanto, não é "seguiu o perfil" e sim "abriu DM pela primeira vez" — a pessoa precisa ser levada a isso (bio, story, resposta de comentário, etc.), o que fica fora do escopo deste desenho.

Ao responder o postback, o sistema envia um **Button Template** — mensagem com um botão clicável de verdade apontando para o link do grupo do WhatsApp (ex: `https://chat.whatsapp.com/...`).

**Não-objetivos:** rastreio de conversão/origem do clique; suporte a múltiplos idiomas (locale fixo `pt_BR`); orquestrar a entrada em DM (bio/story/comentário) — este design cobre apenas a configuração do Icebreaker e a resposta automática.

---

## Decisões tomadas durante o brainstorm

| Decisão | Razão |
|---|---|
| Regras de Icebreaker configuráveis por client, no mesmo padrão de `post_comment`/`keyword_dm` | Consistência com o módulo `conversation-rules` já existente |
| Botão clicável (`buttonText` + `buttonUrl`) substitui `waLink` **para todos os tipos de regra**, não só Icebreaker | Pedido explícito do usuário — recurso genérico, reaproveitável |
| `waLink` é removido sem migração de dados | Confirmado: nenhuma regra em produção usa esse campo hoje |
| `buttonUrl` validado como URL `https` genérica (não travada em `wa.me`) | A validação antiga (`^https://wa.me/`) **nunca aceitaria** um link de grupo (`chat.whatsapp.com`), que é exatamente o caso de uso |
| Sem rastreio de conversão | Fora de escopo por decisão do usuário |
| Locale fixo `pt_BR` | Decisão do usuário — sem necessidade de multi-idioma agora |
| `POST`/`PATCH` em regra `icebreaker` **espera a confirmação da Meta** antes de responder sucesso (sync síncrono, não fire-and-forget) | Decisão do usuário, após revisão do builder-check: se a Meta rejeitar a configuração (ex: payload malformado), o traffic manager precisa ver o erro na hora — não descobrir depois que alguém tentou usar um Icebreaker que nunca foi registrado |

---

## Triggers suportados (atualizado)

| Tipo | Evento Meta | Trigger | Match |
|------|-------------|---------|-------|
| `post_comment` | `entry[].changes[field="comments"]` | Post ID | Keyword contida no comentário |
| `keyword_dm` | `entry[].messaging[].message` | Keyword contida no texto do DM | Substring, mais longa vence |
| `icebreaker` | `entry[].messaging[].postback` | Payload do Icebreaker | Exato (não substring) |
| `default` | `entry[].messaging[].message` | — | Fallback quando nada mais casa |

---

## Modelo de dados

### Tabela `conversation_rules` — alterações

| Campo | Tipo | Observação |
|-------|------|-----------|
| `type` | enum | **novo valor**: `icebreaker` |
| `trigger_value` | varchar \| null | Para `icebreaker`: payload **gerado pelo backend** (ignora qualquer valor enviado pelo client), não editável depois de criado — mesmo padrão já usado para forçar `null` em `default` |
| `icebreaker_question` | varchar \| null | **novo**, nullable — texto da pergunta mostrada ao usuário. Só populado quando `type = icebreaker` (espelha o par `comment_keyword`/`public_reply` do `post_comment`) |
| `reply` (jsonb) | — | `waLink` **removido**; `buttonText` + `buttonUrl` adicionados (ver abaixo) |

Unicidade existente (`client_id, type, trigger_value`) continua valendo — como o payload é gerado automaticamente, nunca colide.

**Regras de negócio novas:**

- No máximo 4 regras `icebreaker` **ativas** por client (limite da própria API da Meta). Verificado tanto em `create()` quanto em `update()` quando o PATCH resulta em `isActive: true` para uma regra `icebreaker` — hoje `update()` não tem nenhuma checagem de regra de negócio (é um merge direto), então uma regra desativada poderia ser reativada via PATCH e ultrapassar o limite sem isso.
- `type` passa a ser **imutável via `PATCH`** para todos os tipos de regra (a UI do dashboard já trava a edição do tipo; isso só garante no backend). `UpdateConversationRuleDto` não deve aceitar `type`.
- Para regras `icebreaker` (e `default`, que já tem esse comportamento implícito em `create()`), `triggerValue` **não pode ser alterado via `PATCH`** — hoje `update()` aceita `triggerValue` livremente para qualquer regra; isso quebraria a premissa de que o payload gerado nunca colide. `update()` precisa ignorar/rejeitar `triggerValue` quando `rule.type` for `icebreaker` ou `default`.

### Interface `ConversationReply` (jsonb) — depois da mudança

```typescript
export interface ConversationReply {
  text?: string;
  quickReplies?: string[];
  buttonText?: string;   // substitui waLink — título do botão (ex: "Entrar no grupo")
  buttonUrl?: string;    // substitui waLink — qualquer URL https (não só WhatsApp)
}
```

Pelo menos um de `text` / `quickReplies` / `buttonText`+`buttonUrl` deve estar presente (mesma regra de "reply não vazio" já existente em `ConversationRulesService.assertReplyNotEmpty`, só trocando a checagem de `waLink` por `buttonUrl`).

`buttonText` e `buttonUrl` são **dependentes um do outro**: se um vier, o outro é obrigatório (novo `@ValidateIf` cruzado no DTO).

**Correção identificada no builder-check:** o Button Template da Meta exige um `text` não vazio no corpo da mensagem (não é só botões soltos) — então `text` passa a ser **obrigatório sempre que `buttonText`/`buttonUrl` estiver presente**, tanto no DTO (`@ValidateIf(o => !!o.buttonUrl) @IsNotEmpty()` em `text`) quanto em `assertReplyNotEmpty`. Sem essa checagem, uma regra só com botão passaria na criação e falharia silenciosamente só na hora de enviar.

### Migration

Nova migration `1785000000000-AddIcebreakerSupportToConversationRules.ts`:

```sql
ALTER TYPE "rule_type_enum" ADD VALUE 'icebreaker';
ALTER TABLE "conversation_rules" ADD COLUMN "icebreaker_question" character varying;
-- reply.waLink é um campo dentro do JSONB — não precisa de ALTER COLUMN,
-- só para de ser escrito/lido pelo código novo. Linhas antigas (nenhuma em produção,
-- confirmado) nunca terão buttonText/buttonUrl, o que é equivalente a "sem botão".
```

> `ALTER TYPE ... ADD VALUE` não pode rodar dentro da mesma transação que outros comandos em certas versões do Postgres — confirmar se o runner de migration do projeto já trata isso (outras migrations do projeto usam `CREATE TYPE` do zero; esta é a primeira a *adicionar* um valor a um enum existente, vale checar o helper de migrations usado).

---

## Arquitetura de módulos

```
src/modules/
├─ conversation-rules/                                    ← MODIFICADO
│   ├─ entities/conversation-rule.entity.ts                ← + icebreakerQuestion
│   ├─ interfaces/conversation-reply.interface.ts          ← waLink → buttonText/buttonUrl
│   ├─ enums/rule-type.enum.ts                              ← + ICEBREAKER
│   ├─ dto/create-conversation-rule.dto.ts                 ← + icebreakerQuestion, buttonText/buttonUrl
│   ├─ dto/update-conversation-rule.dto.ts                 ← + icebreakerQuestion
│   ├─ conversation-rules.service.ts                        ← + findIcebreakerRule, payload autogerado,
│   │                                                          limite de 4 ativas, chamada de sync
│   └─ icebreaker-sync.service.ts                           ← NOVO — empurra config pra Meta
│
└─ webhook/instagram/                                       ← MODIFICADO
    ├─ interfaces/instagram-webhook-event.interface.ts      ← + postback no InstagramMessagingEvent
    ├─ types/instagram-webhook-job.type.ts                   ← + InstagramPostbackJobPayload
    ├─ instagram-webhook.service.ts                          ← + rota para job 'postback'
    ├─ processors/instagram-webhook.processor.ts              ← + case 'postback'
    ├─ conversation-bot.service.ts                            ← + handleIcebreaker()
    ├─ reply-builder.service.ts                               ← + branch para Button Template
    ├─ instagram-graph.service.ts                             ← + sendButtonTemplate(), + setIceBreakers()
    └─ interfaces/instagram-graph.interface.ts                ← + as duas assinaturas acima
```

---

## Fluxo de dados

**Ordem importa:** a chamada para a Meta acontece **antes** da escrita definitiva no banco, não depois. Isso evita ter que desfazer uma gravação já commitada se a Meta rejeitar a configuração, e é o que permite a API responder erro de verdade pro dashboard (decisão do usuário — ver "Decisões tomadas").

```
Config (feita pelo traffic manager no dashboard)
  │
  └─ POST /conversation-rules { type: 'icebreaker', icebreakerQuestion, reply: {buttonText, buttonUrl} }
        │
        ├─ ConversationRulesService.create()
        │     ├─ gera payload (crypto.randomUUID()) como triggerValue (ignora qualquer valor enviado)
        │     ├─ valida: no máx. 4 regras icebreaker ativas para o client (conta as existentes + esta nova)
        │     ├─ monta a lista PROSPECTIVA (regras icebreaker ativas atuais + a nova, ainda não salva)
        │     ├─ IcebreakerSyncService.sync(clientId, prospectiveList)
        │     │     ├─ resolve pageId via integração ATIVA do client com platform = INSTAGRAM
        │     │     │     (IntegrationsService.findAll(clientId).filter(i => i.platform === MetaPlatform.INSTAGRAM)[0] —
        │     │     │      nunca pegar a integração de WhatsApp do mesmo client)
        │     │     └─ InstagramGraphService.setIceBreakers(pageId, prospectiveList)
        │     │           └─ POST /{pageId}/messenger_profile { ice_breakers: [...] }  (substitui o conjunto inteiro)
        │     │     Meta rejeita (4xx/5xx) → propaga o erro, NADA é salvo no banco (409/502 pro dashboard)
        │     │     Meta aceita            → segue
        │     └─ salva a regra no banco (só agora)
        │
        └─ mesma ordem (validar → montar lista prospectiva → sync → persistir) vale para
           update() (quando muda reply/icebreakerQuestion/isActive de uma regra icebreaker)
           e remove() (lista prospectiva = ativas atuais menos a que está sendo removida)

Runtime (seguidor interagindo)
  │
  POST /webhook/instagram
    │
    └─ entry.messaging[] com .postback (em vez de .message)
          └─ enqueue job 'postback' {pageId, senderId, payload}
                └─ ConversationBotService.handleIcebreaker(pageId, senderId, payload)
                      ├─ clientId = IntegrationsService.findByPageId(pageId).clientId
                      ├─ rule = ConversationRulesService.findIcebreakerRule(clientId, payload)  ← match exato
                      ├─ sem match → silêncio (mesmo padrão das outras regras)
                      └─ ReplyBuilderService.send(pageId, senderId, rule.reply)
                            └─ reply.buttonUrl presente → InstagramGraphService.sendButtonTemplate(...)
```

### Matching do Icebreaker

- Diferente de `keyword_dm` (contains, mais longo vence), o Icebreaker usa **match exato** do `payload` — ele não é texto livre do usuário, é o valor que nós mesmos definimos ao cadastrar a pergunta na Meta.
- `findIcebreakerRule(clientId, payload)`: `repo.findOne({ where: { clientId, type: ICEBREAKER, triggerValue: payload, isActive: true } })`.

### Construção da resposta — `ReplyBuilderService` (tabela atualizada)

| Combinação de `reply` | Chamada gerada |
|---|---|
| só `text` | `sendTextMessage(...)` |
| `text` + `quickReplies` | `sendQuickReplies(...)` |
| `text` + `buttonText` + `buttonUrl` | `sendButtonTemplate(pageId, recipientId, text, buttonText, buttonUrl)` |
| `quickReplies` **e** `buttonUrl` ao mesmo tempo | **`buttonUrl` tem prioridade** — a API não permite combinar quick-replies com Button Template na mesma mensagem. Isso é uma decisão de implementação (minha escolha), documentada aqui para o builder não precisar adivinhar. |

### `InstagramGraphService.sendButtonTemplate` (novo método)

```typescript
async sendButtonTemplate(
  pageId: string,
  recipientIgsid: string,
  text: string,
  buttonTitle: string,
  buttonUrl: string,
): Promise<void> {
  const token = await this.getDecryptedToken(pageId);
  await this.post(pageId, token, {
    recipient: { id: recipientIgsid },
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text,
          buttons: [{ type: 'web_url', url: buttonUrl, title: buttonTitle }],
        },
      },
    },
  });
}
```

Reaproveita o `post()` privado existente — mesmo tratamento de erro (rate limit, token expirado, janela de mensageria fechada) que os outros métodos já têm.

### `InstagramGraphService.setIceBreakers` (novo método)

```typescript
async setIceBreakers(
  pageId: string,
  questions: Array<{ question: string; payload: string }>,
): Promise<void> {
  const token = await this.getDecryptedToken(pageId);
  const url = `${this.baseUrl}/${pageId}/messenger_profile`;
  await firstValueFrom(
    this.httpService.post(
      url,
      {
        platform: 'instagram',
        ice_breakers: [
          {
            locale: 'default',
            call_to_actions: questions.map(q => ({ question: q.question, payload: q.payload })),
          },
        ],
      },
      { params: { access_token: token } },
    ),
  ).catch((err: { response?: { data?: unknown } }) =>
    this.handleCommonGraphError(pageId, err as never),
  );
}
```

> A Meta **substitui o conjunto inteiro de ice breakers a cada POST** — não existe update parcial. Por isso quem chama `IcebreakerSyncService.sync()` sempre monta e passa a lista prospectiva completa de regras que ficariam ativas, nunca só a que mudou.

### `IcebreakerSyncService` (novo)

Recebe a lista **prospectiva** já calculada pelo chamador (não busca do banco sozinho) — assim `create`/`update`/`remove` controlam exatamente o que deveria existir depois da operação, antes de qualquer coisa ser persistida.

```typescript
@Injectable()
export class IcebreakerSyncService {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly graph: InstagramGraphService,
  ) {}

  async sync(
    clientId: string,
    activeRules: Array<{ icebreakerQuestion: string; triggerValue: string }>,
  ): Promise<void> {
    const integrations = await this.integrationsService.findAll(clientId);
    const integration = integrations.find(i => i.platform === MetaPlatform.INSTAGRAM);
    if (!integration) {
      throw new BadRequestException('Client has no active Instagram integration to sync icebreakers to');
    }

    await this.graph.setIceBreakers(
      integration.pageId,
      activeRules.map(r => ({ question: r.icebreakerQuestion, payload: r.triggerValue })),
    );
  }
}
```

Chamado por `ConversationRulesService` **antes** de persistir, em `create()`, `update()` e `remove()`, sempre que a operação envolve (ou afeta a lista de) regras `ICEBREAKER` — e **aguardado** (não fire-and-forget): se `sync()` lançar, a exceção propaga pro controller e nada é escrito no banco.

> Sem integração Instagram ativa, a criação/edição de uma regra icebreaker falha com 400 — não dá pra ter uma regra "órfã" que nunca foi (e nunca poderá ser) registrada na Meta.

> **Limitação conhecida:** se um client tiver mais de uma integração Instagram ativa simultaneamente (duas contas), o sync usa a primeira encontrada — mesma ambiguidade que já existe implicitamente no resto do módulo `conversation-rules` (nenhuma regra hoje associa um `pageId` específico, só `clientId`). Não é uma regressão deste desenho, mas fica registrado.

---

## Mudanças no webhook existente

### `interfaces/instagram-webhook-event.interface.ts`

```typescript
export interface InstagramMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: { mid: string; text?: string; attachments?: InstagramAttachment[] };
  postback?: { mid?: string; title?: string; payload: string }; // NOVO
  reaction?: { mid: string; action: string; emoji?: string };
  read?: { mid: string };
}
```

### `instagram-webhook.service.ts` — `enqueueEntry`

```typescript
for (const event of entry.messaging ?? []) {
  if (event.postback) {
    await this.queue.add('postback', {
      pageId: entry.id,
      senderId: event.sender.id,
      payload: event.postback.payload,
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } })
      .catch(err => this.logger.warn(`enqueue postback failed pageId=${entry.id}: ${err.message}`));
    continue;
  }
  // ... job 'dm' como já existe, só quando event.message estiver presente
}
```

### `processors/instagram-webhook.processor.ts`

Adicionar `case 'postback'` chamando `botService.handleIcebreaker(pageId, senderId, payload)`.

### `conversation-bot.service.ts` — novo método

```typescript
async handleIcebreaker(pageId: string, senderId: string, payload: string): Promise<void> {
  let clientId: string;
  try {
    const integration = await this.integrationsService.findByPageId(pageId);
    if (!integration.isActive) return;
    clientId = integration.clientId;
  } catch (err) {
    this.logger.warn(`No integration found for pageId ${pageId} (postback): ${(err as Error).message}`);
    return;
  }

  const rule = await this.rulesService.findIcebreakerRule(clientId, payload);
  if (!rule) return;

  await this.replyBuilder.send(pageId, senderId, rule.reply).catch((err: Error) => {
    if (err instanceof GraphApiRateLimitException) throw err;
    this.logger.error(`Failed to send icebreaker reply for pageId ${pageId}: ${err.message}`);
  });
}
```

---

## Endpoints da API (sem mudança de rota, só de payload)

`POST/PATCH /conversation-rules` aceitam agora:

```json
{
  "clientId": "uuid",
  "type": "icebreaker",
  "icebreakerQuestion": "Quero entrar no grupo VIP 🎉",
  "reply": {
    "text": "Boa! Clique abaixo pra entrar:",
    "buttonText": "Entrar no grupo",
    "buttonUrl": "https://chat.whatsapp.com/XXXXXXXXXXXX"
  }
}
```

- `triggerValue` **não é aceito/é ignorado** para `type: icebreaker` (igual ao que já acontece hoje para `type: default`) — o backend gera o payload.
- `icebreakerQuestion`: obrigatório quando `type = icebreaker` (`@ValidateIf`), string, limite de tamanho a definir em implementação — a Meta não documenta um limite oficial para o texto da pergunta; usar `MaxLength(80)` como default conservador (mesmo limite usado em títulos de Generic Template) e **validar contra a API real em ambiente de sandbox antes de confiar nisso em produção**.
- **409 Conflict** se o client já tiver 4 regras `icebreaker` ativas.

### `ConversationReplyDto` — depois da mudança

```typescript
export class ConversationReplyDto {
  @IsOptional() @IsString() @MaxLength(2000) text?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(13) @IsString({ each: true }) @MaxLength(13, { each: true })
  quickReplies?: string[];

  @ValidateIf(o => !!o.buttonUrl || !!o.buttonText)
  @IsString() @MaxLength(20) // limite observado em títulos de botão do Messenger Platform — confirmar para Instagram
  buttonText?: string;

  @ValidateIf(o => !!o.buttonUrl || !!o.buttonText)
  @IsUrl({ protocols: ['https'] })
  buttonUrl?: string;
}
```

---

## Tratamento de erros (adições à tabela existente)

| Situação | Comportamento |
|---|---|
| Postback sem regra correspondente (payload não encontrado) | Silêncio — mesmo padrão das outras regras |
| Falha ao sincronizar ice breakers com a Meta (4xx/5xx da Graph API) | **Nada é salvo no banco.** Erro propaga pro controller — 502/422 pro dashboard, com a mensagem da Meta quando disponível |
| Client sem integração Instagram ativa tenta criar/editar regra `icebreaker` | 400 Bad Request |
| Client tenta ativar a 5ª regra `icebreaker` (criação **ou** reativação via `PATCH isActive: true`) | 409 Conflict |
| `icebreakerQuestion` ausente com `type: icebreaker` | 400 Bad Request (validação do DTO) |
| `reply.buttonText`/`buttonUrl` presente sem `reply.text` | 400 Bad Request (validação do DTO) |
| `PATCH` tentando mudar `type` de uma regra existente | 400 Bad Request (campo não aceito no update) |
| `PATCH` tentando mudar `triggerValue` de uma regra `icebreaker`/`default` | 400 Bad Request, ou o campo é silenciosamente ignorado — **a implementação decide**, mas o payload gerado nunca pode mudar |

---

## Frontend / Dashboard (`trafegoflow-dashboard`, repositório separado)

A tela de regras **já existe** — não é página nova. Vive embutida em `app/(dashboard)/clientes/[id]/page.tsx`, como `<ConversationRulesSection clientId={id} />`, usando um modal (`ConversationRuleUpsertDialog`) para criar/editar. Mudanças:

### `components/conversation-rules/conversation-rule-upsert-dialog.tsx`

1. 4ª opção no `Select` de tipo: `{ value: 'icebreaker', label: 'Icebreaker' }` (hoje só tem post_comment/keyword_dm/default).
2. Bloco condicional novo (ativado quando `type === 'icebreaker'`, mesmo padrão `useWatch` já usado para `post_comment`): campo de texto **"Pergunta do Icebreaker"** (até 80 caracteres, com contador — mesmo padrão visual de outros campos com limite), mapeando para `icebreakerQuestion`.
3. **Troca o campo único "Link WhatsApp"** por dois campos, para **todos os tipos de regra**:
   - "Texto do botão" (input, ex: placeholder "Entrar no grupo")
   - "Link do botão" (input, placeholder `https://chat.whatsapp.com/...` — não mais travado em `wa.me`)
   - Os dois são opcionais, mas se um for preenchido o outro vira obrigatório (validação cruzada no schema Zod, espelhando o `@ValidateIf` do backend).
4. Zod schema: remover `waLink`, adicionar `buttonText`/`buttonUrl` com a regra de dependência mútua; trocar o regex de `^https://wa\.me/` por validação de URL `https` genérica.

### `components/conversation-rules/conversation-rules-section.tsx`

- `replyPreview()`: trocar o fallback que hoje mostra `waLink` por uma prévia do botão (ex: ícone + `buttonText`).
- Badge de tipo: adicionar label para `icebreaker` (ex: "Icebreaker") ao lado de "Post"/"Keyword DM"/"Padrão".

### `types/conversation-rule.ts`

- `RuleType`: adicionar `'icebreaker'`.
- `ConversationReply`: remover `waLink`, adicionar `buttonText?`, `buttonUrl?`.
- `ConversationRule`: adicionar `icebreakerQuestion: string | null`.

### `hooks/use-conversation-rules.ts`

- Nenhuma mudança de endpoint ou de hook — mesmos 4 calls (`GET`, `POST`, `PATCH`, `DELETE` em `/conversation-rules`), só o shape do payload muda (coberto pelos types acima).

---

## Testes

| Arquivo | Cenários novos |
|---|---|
| `conversation-rules.service.spec.ts` | `findIcebreakerRule` (match exato, não substring); payload autogerado e ignorando `triggerValue` enviado; 409 na 5ª regra icebreaker ativa (criação **e** reativação via update); 400 sem integração Instagram ativa; `assertReplyNotEmpty` exigindo `text` quando há botão; `update()` rejeita mudança de `type`; `update()` não deixa `triggerValue` mudar em regra icebreaker/default; **ordem**: se `IcebreakerSyncService.sync` lançar, `repo.save`/`repo.create` nunca é chamado (nada persiste) |
| `icebreaker-sync.service.spec.ts` (novo) | filtra integração por `platform === INSTAGRAM`, ignorando integração WhatsApp do mesmo client; chama `setIceBreakers` com a lista recebida (não busca do banco); lança `BadRequestException` se não houver integração Instagram ativa |
| `reply-builder.service.spec.ts` | nova combinação `buttonText`+`buttonUrl` → `sendButtonTemplate`; prioridade sobre `quickReplies` quando ambos presentes |
| `conversation-bot.service.spec.ts` | `handleIcebreaker`: match, sem match (silêncio), loop/integração inativa |
| `instagram-webhook.service.spec.ts` | evento com `.postback` roteado para job `'postback'`, não para `'dm'` |
| `instagram-webhook.processor.spec.ts` | `case 'postback'` chama `handleIcebreaker` com os args certos |
| `instagram-graph.service.spec.ts` | `sendButtonTemplate` monta payload correto; `setIceBreakers` monta payload correto com `locale: 'default'` |

---

## Configuração no painel da Meta (passo de deploy, não código)

Além do que já está documentado para `comments`/`messages`:

1. Em **Webhooks**, confirmar assinatura do campo **`messaging_postbacks`** (distinto de `messages`) — é o que a Meta usa para entregar o clique no Icebreaker.
2. Os ice breakers em si **não são configurados manualmente no painel** — são enviados via API (`setIceBreakers`) sempre que o traffic manager salva uma regra no dashboard. Não há passo manual aqui além da assinatura do webhook.

---

## Variáveis de ambiente

Nenhuma nova.

---

## Limitações conhecidas / riscos

- **Limite de pergunta do Icebreaker (80 caracteres) é uma suposição conservadora**, não documentada oficialmente pela Meta — validar contra a API real antes de confiar em produção.
- **Sync substitui o conjunto inteiro a cada mutação, e agora acontece antes do commit no banco** — se duas regras do mesmo client forem salvas quase ao mesmo tempo (race), a segunda chamada pode calcular sua lista prospectiva sem ver a primeira ainda não commitada, e a resposta final na Meta reflete quem chamou por último. Não há fila/lock por client. Aceitável para o volume esperado (configuração manual pelo traffic manager, uma de cada vez, não automação em massa).
- **Um client com múltiplas integrações Instagram ativas** (duas contas): o sync usa a primeira encontrada — mesma ambiguidade que o resto do módulo já tem.
- **Botão vs. quick-replies são mutuamente exclusivos** numa mesma mensagem — decisão de implementação, documentada acima.
- **Criar/editar uma regra `icebreaker` agora tem uma chamada de rede síncrona pra Meta no caminho crítico** da requisição HTTP (decisão do usuário) — a latência do `POST`/`PATCH` passa a incluir o round-trip do Graph API, diferente dos outros tipos de regra que são só banco de dados.
- **O gatilho de entrada em DM (bio/story/comentário) fica fora deste desenho** — a funcionalidade entrega a configuração do Icebreaker e a resposta automática; como o traffic manager leva a pessoa a abrir a DM é responsabilidade dele.
