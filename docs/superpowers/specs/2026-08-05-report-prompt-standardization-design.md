# Report Prompt Standardization — Tom e Estrutura dos Relatórios via WhatsApp

**Data:** 2026-08-05
**Status:** Aprovado

## Contexto

O sistema já gera relatórios semanais via IA (`AiService`) e os envia pelo WhatsApp. O problema atual é duplo: a **estrutura** do relatório (seções, ordem, funil) e a **voz/linguagem** (tom, pessoa gramatical, foco em resultados positivos) não são garantidas pelo prompt — a IA pode improvisar e gerar saídas inconsistentes entre semanas ou entre clientes.

Esta feature padroniza o prompt base e adapta a estrutura do relatório ao perfil de negócio de cada cliente.

---

## Decisões de design

| Decisão | Escolha |
|---|---|
| Separação captação/venda | No código, por nome da campanha (contém CAP ou CAPT) |
| Perfil do cliente | Enum `ClientProfileType` no `ClientEntity` |
| Snapshot histórico | Salva apenas o total agregado (sem split captação/venda) |
| Responsabilidade da IA | Somente partes narrativas (abertura, comparativo, próximos passos) |
| Estrutura do relatório | Determinada pelo código via templates por perfil |
| Tom nos resultados negativos | Enquadrar como oportunidade/ajuste, nunca como fracasso |

---

## Modelo de dados

### Novo enum `ClientProfileType`

```typescript
enum ClientProfileType {
  SITE_SALES    = 'site_sales',
  MESSAGE_SALES = 'message_sales',
  LIVE_SALES    = 'live_sales',
}
```

### `ClientEntity` — campo novo

```typescript
@Column({
  type: 'enum',
  enum: ClientProfileType,
  nullable: true,
  name: 'profile_type',
})
profileType: ClientProfileType | null;
```

Quando `null`, o sistema usa `SITE_SALES` como fallback.

### `InsightsSummary` — campos novos

```typescript
messagesStarted: number;    // action_type: messaging_conversation_started_7d
contentViews: number;       // action_type: view_content
checkoutInitiated: number;  // action_type: initiate_checkout
liveViews: number;          // action_type: video_play (lives promovidas via anúncio)
```

Todos os campos ficam `0` quando não se aplicam ao perfil.

### `AiReportPayload` — campos novos

```typescript
export interface AiReportPayload {
  period: {
    since: string;
    until: string;
    weekNumber: number;
  };
  current: InsightsSummary;        // total agregado (captação + venda)
  previous: InsightsSummary | null; // total da semana anterior (do snapshot)
  deltas: Record<string, number | null>;
  acquisition: InsightsSummary | null; // campanhas com CAP/CAPT no nome
  sales: InsightsSummary | null;       // demais campanhas
  clientProfile: ClientProfileType;
  clientContext: string | null;
}
```

---

## Lógica de split de campanhas

Nova função `splitAndAggregateCampaigns(rows: MetaInsights[])`:

1. Classifica cada row: se `campaign_name` contém `CAP` ou `CAPT` (case-insensitive) → **acquisition**; se `campaign_name` for undefined ou não contiver esses termos → **sales**
2. Agrega cada bucket com a lógica existente de `aggregateInsights`
3. Agrega o total com a mesma lógica
4. Retorna `{ acquisition, sales, total }`

O `InsightSnapshotEntity` continua salvando apenas o `total` — o split não é persistido, pois serve apenas para o relatório daquela semana.

---

## Estrutura do prompt

### System prompt (por perfil)

Regras invariantes, independente do `clientContext`:

- **Persona:** assistente de tráfego pago que escreve o relatório na voz do gestor (como se o gestor estivesse falando diretamente com o cliente)
- **Voz:** primeira pessoa do singular nos próximos passos ("vou realizar", "vou ajustar", "vou otimizar")
- **Tom:** amigável, direto, profissional — sem exageros
- **Emojis:** proibidos
- **Markdown:** proibido (sem `#`, `**`, `_`, `-` de lista) — texto puro compatível com WhatsApp
- **Números:** formato brasileiro (R$ 1.234,56; 10.611 pessoas)
- **Foco em resultados positivos:** quando métricas estão em alta, celebrar; quando em queda, enquadrar como oportunidade ou ajuste de estratégia — nunca como fracasso. Se tudo cair, a abertura deve ser algo como "Essa semana ajustamos a estratégia para melhores resultados nas próximas semanas"
- **Próximos passos:** sempre personalizados com base nos dados ou no `clientContext` — nunca genéricos
- **Perfil injetado aqui:** define qual funil e quais métricas são relevantes

### User message (template por perfil)

A mensagem não é JSON cru — é um template pré-estruturado com os dados nos lugares certos. A IA preenche apenas:
- Frase de abertura (avaliação qualitativa da semana)
- Frase de comparativo com semana anterior (se houver deltas)
- Seção de próximos passos

Três funções de template: `buildSiteSalesMessage`, `buildMessageSalesMessage`, `buildLiveSalesMessage`.

---

## Formato de saída por perfil

### SITE_SALES

```
Olá!

Feedback Semanal — Semana {n}
{since} a {until}

{[IA] avaliação qualitativa da semana}

Campanha de Captação ({nome da campanha}):
Investimento: R$ {valor}
Cliques: {valor}

Campanhas de Venda:
Investimento: R$ {valor}

Funil de Vendas:
Cliques no anúncio: {valor}
↓ {%}
Visitas à página: {valor}
↓ {%}
Visualizações de conteúdo: {valor}
↓ {%}
Carrinho: {valor}
↓ {%}
Finalização de compra: {valor}
↓ {%}
Compras: {valor}

Conversão geral (clique → compra): {%}

{[IA] comparativo com semana anterior — se houver deltas}

Próximos passos:
{[IA] próximos passos personalizados}

Qualquer dúvida estou à disposição!
```

As porcentagens do funil (↓ X%) são calculadas no código (cada etapa / etapa anterior).

### MESSAGE_SALES

```
Olá!

Feedback Semanal — Semana {n}
{since} a {until}

{[IA] avaliação qualitativa da semana}

Investimento: R$ {valor}
Alcance: {valor} pessoas impactadas
Conversas iniciadas: {valor} novos contatos no direct
Cliques nos anúncios: {valor}

{[IA] comparativo com semana anterior — se houver deltas}

Próximos passos:
{[IA] próximos passos personalizados}

Qualquer dúvida estou à disposição!
```

### LIVE_SALES

```
Olá!

Feedback Semanal — Semana {n}
{since} a {until}

{[IA] avaliação qualitativa da semana}

Investimento: R$ {valor}
Alcance: {valor} pessoas impactadas
Visualizações da live: {valor}
Cliques nos anúncios: {valor}
Compras: {valor}

{[IA] comparativo com semana anterior — se houver deltas}

Próximos passos:
{[IA] próximos passos personalizados}

Qualquer dúvida estou à disposição!
```

---

## Arquitetura — o que muda

### Novos arquivos

```
src/modules/clients/enums/
└── client-profile-type.enum.ts

src/modules/ai/utils/
├── prompt-builder.ts          (refatorado — dividido em funções por perfil)
└── campaign-splitter.ts       (nova função splitAndAggregateCampaigns)
```

### Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `clients/entities/client.entity.ts` | Campo `profileType: ClientProfileType \| null` |
| `ai/interfaces/ai-provider.interface.ts` | Campos `acquisition`, `sales`, `clientProfile` em `AiReportPayload`; `messagesStarted` em `InsightsSummary` |
| `ai/utils/prompt-builder.ts` | Reescrever `buildSystemPrompt` e `buildUserMessage` para usar perfil e templates estruturados |
| `report-dispatches/report-dispatches.service.ts` | Usar `splitAndAggregateCampaigns`; carregar `clientProfile`; calcular percentuais do funil antes de chamar a IA |
| Migration | Nova coluna `profile_type` em `clients` |

---

## Tratamento de erros e fallbacks

- `clientProfile` null → fallback para `SITE_SALES`
- `acquisition` null (nenhuma campanha com CAP/CAPT) → omitir seção de captação do relatório
- `sales` null → omitir seção de vendas/funil
- Se todos os dados do funil forem zero → não calcular percentuais; omitir seção de funil
- Fallback estático existente mantido para quando a IA falha

---

## Escopo fora desta feature

- Interface de edição do `profileType` por cliente (frontend)
- Override de prompt/tom por cliente
- Suporte a múltiplos perfis por cliente (ex: cliente com site e live)
- Cálculo de deltas separados por captação/venda (histórico mantém só o total)
