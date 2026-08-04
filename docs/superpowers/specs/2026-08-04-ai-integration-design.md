# AI Integration — Relatórios Inteligentes via WhatsApp

**Data:** 2026-08-04
**Status:** Aprovado

## Contexto

O `ReportDispatchesService` já busca insights do Meta Ads e envia um texto formatado para grupos de WhatsApp semanalmente. Atualmente o texto é gerado por código hardcoded (template estático com emojis e números).

O objetivo desta feature é inserir uma camada de IA entre os dados brutos e o texto final, gerando análises narrativas personalizadas por cliente — com comparativo à semana anterior, avaliação qualitativa e próximos passos escritos na voz do traffic manager.

### Exemplo de saída esperada

```
Olá!

Feedback Semanal — Semana 31
2026-07-27 a 2026-08-02

Essa semana as campanhas performaram muito bem!

Investimento: R$ 244,74
Alcance: 6.825 pessoas impactadas
Cliques para o site: 361
Visitas à página: 165
Carrinhos: 18
Compras: 0

O alcance cresceu 13,0% em relação à semana anterior — ótimo sinal de que os públicos estão respondendo bem!

Próximos passos:
Essa semana vou realizar otimizações de público para refinar ainda mais a segmentação e melhorar os resultados! Vou ajustar os grupos de interesse com base nos dados de idade e comportamento desta semana.

Qualquer dúvida estou à disposição!
```

---

## Decisões de design

| Decisão | Escolha |
|---|---|
| Tipo de análise | Narrativa + comparativo semana anterior + próximos passos |
| Personalização dos próximos passos | Contexto por cliente (`aiStrategyContext`) injetado no prompt |
| Configuração de provider | Global via `.env` (sem override por cliente) |
| Dados históricos para comparativo | Persistência de snapshots semanais no PostgreSQL |
| Arquitetura do adapter | Strategy Pattern com `AiModule.forRootAsync()` |

---

## Arquitetura

### Novos módulos

```
src/modules/
├── ai/
│   ├── ai.module.ts
│   ├── ai.service.ts
│   ├── interfaces/
│   │   └── ai-provider.interface.ts
│   └── adapters/
│       ├── openai.adapter.ts
│       └── gemini.adapter.ts
│
└── insight-snapshots/
    ├── insight-snapshots.module.ts
    ├── insight-snapshots.service.ts
    └── entities/
        └── insight-snapshot.entity.ts
```

### Módulos atualizados

- `clients/entities/client.entity.ts` — adiciona `aiStrategyContext: string | null`
- `report-dispatches/report-dispatches.module.ts` — importa `AiModule` e `InsightSnapshotsModule`; injeta `AiService` e `InsightSnapshotsService` no `ReportDispatchesService`
- `AppModule` — importa `AiModule.forRootAsync()` (global); `InsightSnapshotsModule` é importado apenas por `ReportDispatchesModule`

---

## Fluxo de dados

```
Scheduler (segunda-feira, 08h00, America/Sao_Paulo)
  └─ ReportDispatchesService.triggerAll()
       └─ Para cada [clientId, groups] do mapa de grupos ativos:
            └─ Para cada adAccount ativa do cliente:
                 1. Busca insights da semana atual (Meta Ads API)
                 2. Salva InsightSnapshot no banco (upsert por adAccountId + weekStartDate)
                 3. Carrega InsightSnapshot da semana anterior (DB)
                 4. Calcula deltas: { reach: +0.13, spend: -0.05, ... }
                 5. Carrega client.aiStrategyContext
                 6. AiService.generateReport(payload) → texto gerado pela IA
                 7. Envia texto para cada grupo do WhatsApp
                 8. Registra ReportDispatchLog
```

---

## Contratos de interface

### `IAiProvider`

```typescript
export interface IAiProvider {
  generateReport(payload: AiReportPayload): Promise<string>;
}
```

### `AiReportPayload`

```typescript
export interface AiReportPayload {
  period: {
    since: string;       // 'YYYY-MM-DD'
    until: string;       // 'YYYY-MM-DD'
    weekNumber: number;  // semana ISO 8601 (1–53)
  };
  current: InsightsSummary;
  previous: InsightsSummary | null;
  deltas: Record<string, number | null>; // ex: { reach: 0.13, spend: -0.05 }
  clientContext: string | null;
}

export interface InsightsSummary {
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  purchases: number;
  addToCart: number;
  pageViews: number;
}
```

---

## Entidades

### `InsightSnapshotEntity` (nova tabela `insight_snapshots`)

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `ad_account_id` | varchar | ID da conta de anúncio |
| `client_id` | varchar | ID do cliente |
| `week_start_date` | date | Sempre segunda-feira |
| `snapshot_json` | jsonb | `MetaInsights` bruto da semana |
| `created_at` | timestamptz | |

**Índice único:** `(ad_account_id, week_start_date)` — um snapshot por conta por semana (upsert em re-execuções manuais da mesma semana).

### `ClientEntity` — campo novo

```typescript
@Column({ type: 'text', nullable: true, name: 'ai_strategy_context' })
aiStrategyContext: string | null;
```

Exemplo de valor: `"foco em e-commerce, objetivo de reduzir CPL abaixo de R$ 15, público principal 25-40 anos"`

---

## Configuração

### Variáveis de ambiente

```env
# Obrigatório
AI_PROVIDER=openai          # 'openai' | 'gemini'
AI_MODEL=gpt-4o-mini        # modelo a usar

# Chaves — apenas a do provider ativo é necessária
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
```

### Seleção de adapter

```typescript
// ai.module.ts — forRootAsync seleciona o adapter via env
const ADAPTER_MAP = {
  openai: OpenAiAdapter,
  gemini: GeminiAdapter,
};

useFactory: (config: ConfigService) => {
  const provider = config.get<string>('AI_PROVIDER', 'openai');
  return { adapterClass: ADAPTER_MAP[provider] ?? OpenAiAdapter };
}
```

Adicionar novo provider = criar `adapters/novo.adapter.ts` implementando `IAiProvider` e registrar no `ADAPTER_MAP`.

---

## Estrutura do prompt

Ambos os adapters seguem a mesma estrutura:

**System prompt:**
```
Você é um assistente de marketing digital que escreve relatórios semanais
para clientes de tráfego pago. Escreva na primeira pessoa do singular,
com tom amigável e profissional. Use emojis moderadamente.
[Se clientContext presente]: Contexto da estratégia do cliente: {clientContext}
```

**User message:**
```
Gere o relatório semanal com base nos dados abaixo.
Inclua: saudação, identificação do período (semana {n}), avaliação geral,
métricas principais, comparativo com semana anterior (se disponível),
próximos passos e fechamento.

Dados: {JSON.stringify(payload)}
```

O texto retornado pela IA vai direto para o `WhatsAppSessionService.sendMessage()`.

---

## Tratamento de erros

- Se a chamada à IA falhar → fallback para o template estático atual (sem regressão)
- Se o snapshot da semana anterior não existir → `previous: null`, IA gera relatório sem comparativo
- Erros são logados e registrados no `ReportDispatchLog` com status `FAILED`

---

## Escopo fora desta feature

- Interface de edição do `aiStrategyContext` por cliente (frontend)
- Override de provider/modelo por cliente
- Histórico de relatórios gerados pela IA
- Avaliação de qualidade dos relatórios
