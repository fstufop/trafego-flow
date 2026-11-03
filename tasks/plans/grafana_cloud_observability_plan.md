# Plano de Implementação: Observabilidade com Grafana Cloud

**Spec:** não existe spec formal em `tasks/specs/` para esta feature — plano derivado diretamente da conversa com o dev (decisão já tomada: Grafana Cloud free tier, cobrindo métricas por tenant, logs e alertas).
**Data:** 2026-10-23

## Contexto levantado no codebase

- Stack atual: NestJS 11 rodando em **Cloud Run** (stateless, múltiplas instâncias, scale-to-zero).
- Logging hoje é feito só com o `Logger` padrão do Nest + `HttpLoggerMiddleware` (`src/common/middleware/http-logger.middleware.ts`), texto puro pro stdout. `pino` já está nas dependências, mas só é usado de forma isolada e silenciada dentro do Baileys (`whatsapp-session.service.ts`) — não é o logger da aplicação.
- Não existe nenhuma exportação de métricas (`prom-client`, OpenTelemetry etc.) nem endpoint `/metrics`.
- Existe `@nestjs/terminus` (`HealthModule`) só para liveness de DB/Redis — não serve como fonte de métricas de negócio.
- Não há um mecanismo central de "tenant context" (nenhum `AsyncLocalStorage`, decorator `@CurrentTenant` ou interceptor equivalente). Cada módulo resolve o tenant/cliente do seu próprio jeito (ex.: `pageId` no Instagram, `phoneNumber`/grupo no WhatsApp). Isso afeta como rotulamos métricas por tenant (ver Riscos).
- `main.ts` não chama `app.enableShutdownHooks()` — relevante porque métricas exportadas por push (OTLP) dependem de um flush no `SIGTERM` que o Cloud Run envia ao desligar uma instância.

## Análise de Alternativas

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| **A (Escolhida)** — OpenTelemetry SDK com push direto pro OTLP Gateway do Grafana Cloud | App usa `@opentelemetry/sdk-metrics` + `OTLPMetricExporter` pra empurrar métricas periodicamente; logs via `pino` com transport `pino-opentelemetry-transport` apontando pro mesmo gateway | Modelo *push*, ideal pra Cloud Run (não depende de um scraper alcançar uma instância específica); um único fluxo cobre métricas e logs; sem necessidade de manter Agent/Alloy; tier free do Grafana Cloud aceita OTLP nativamente | Setup inicial um pouco mais verboso (resource attributes, readers, flush no shutdown) |
| B — `prom-client` + endpoint `/metrics` + Grafana Agent/Alloy fazendo scrape | Modelo *pull* clássico do Prometheus | Mais simples de instrumentar no código (só o endpoint) | Cloud Run escala horizontalmente e não garante scrape na mesma instância a cada ciclo → contadores inconsistentes entre scrapes; precisa manter um Agent rodando em algum lugar pra alcançar o serviço; expõe um endpoint público que precisaria de proteção extra |
| C — Self-hosted Prometheus + Grafana (Docker) | Stack completa própria | Controle total, sem limites de free tier | É *stateful* (precisa disco pra séries temporais) — não cabe bem no Cloud Run; foi descartado nas mensagens anteriores da conversa por exigir infra própria |

**Decisão:** Alternativa A — push direto via OTLP é o único modelo que funciona de forma confiável com instâncias efêmeras do Cloud Run e evita manter qualquer peça de infra adicional, se encaixando no requisito de "sem custo" (free tier do Grafana Cloud).

## Recursos Reutilizáveis Identificados

- `src/config/configuration.ts` e o padrão de `*.config.ts` (ex.: `redis.config.ts`) — usar o mesmo padrão para `observability.config.ts`.
- `src/common/filters/http-exception.filter.ts` — ponto natural para incrementar um contador de erros HTTP 5xx sem precisar de um interceptor novo.
- `src/common/middleware/http-logger.middleware.ts` — será **substituído** (não reaproveitado) pelo `pino-http` via `nestjs-pino`, que já cobre o mesmo log de requisição em formato estruturado.
- Padrão de módulos existentes (`HealthModule`, `AlertJobsModule`) como referência de estrutura para o novo `ObservabilityModule` (module + service + provider, sem controller).

## Diagrama de Fluxo

```
NestJS App (Cloud Run)
    ↓ bootstrap
ObservabilityModule (global)
    ├─ OTel MeterProvider (PeriodicExportingMetricReader a cada N s)
    │     ↓ push HTTPS (Basic Auth: instance_id:api_key)
    │   Grafana Cloud — OTLP Gateway (free tier)
    │     ├─ Mimir (métricas)
    │     └─ Loki (logs)
    │
    └─ pino logger (nestjs-pino)
          ├─ target stdout  → Cloud Run → Google Cloud Logging (mantém como está hoje)
          └─ target pino-opentelemetry-transport → mesmo OTLP Gateway acima

Pontos de instrumentação de negócio:
  InstagramWebhookProcessor.process()      → webhook_messages_received_total{channel="instagram", type}
  WhatsAppSessionService (handler messages.upsert) → webhook_messages_received_total{channel="whatsapp"}
  ConversationBotService / AiModule        → ai_replies_sent_total{channel}
  ReportDispatchesService                  → report_dispatch_total{status="success|failure"}
  AlertJobsService                         → alert_jobs_executed_total{status}
  HttpExceptionFilter                      → http_errors_total{status_code, route}

SIGTERM (Cloud Run scale-down)
    ↓ app.enableShutdownHooks()
  onApplicationShutdown → meterProvider.forceFlush() + shutdown()
```

## Tarefas Sequenciais

### Tarefa 1 — Dependências
**Arquivo:** `package.json`
**O que fazer:** Adicionar `@opentelemetry/api`, `@opentelemetry/sdk-metrics`, `@opentelemetry/exporter-metrics-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`, `nestjs-pino`, `pino-http`, `pino-opentelemetry-transport`.
**Depende de:** nada
**Testável:** `npm install` sem conflito de peer deps

### Tarefa 2 — Configuração e variáveis de ambiente
**Arquivos:**
- `src/config/observability.config.ts` (novo, seguindo o padrão de `redis.config.ts`)
- `src/config/configuration.ts` — registrar o novo config e adicionar ao `validationSchema` (`OBSERVABILITY_ENABLED`, `GRAFANA_OTLP_ENDPOINT`, `GRAFANA_OTLP_INSTANCE_ID`, `GRAFANA_OTLP_API_KEY`, todos `allow('').optional()` exceto quando `OBSERVABILITY_ENABLED=true`)
- `.env.example` — documentar as novas variáveis com um comentário de onde pegar cada uma no painel do Grafana Cloud
**O que fazer:** Expor as credenciais do OTLP Gateway via `ConfigService`, com a feature desligada por padrão em dev/test (`OBSERVABILITY_ENABLED=false`)
**Depende de:** nada (paralelo com Tarefa 1)
**Testável:** `npm run start:dev` sobe normalmente com `OBSERVABILITY_ENABLED=false`

### Tarefa 3 — ObservabilityModule + bootstrap do MeterProvider
**Arquivos:**
- `src/observability/observability.module.ts`
- `src/observability/otel-metrics.provider.ts` — cria `MeterProvider` com `PeriodicExportingMetricReader` + `OTLPMetricExporter` (Basic Auth montado a partir do config), registra como global via `metrics.setGlobalMeterProvider`; no-op quando `OBSERVABILITY_ENABLED=false`
- `src/observability/metrics.service.ts` — wrapper tipado sobre o `Meter`, expõe métodos de domínio (não contadores genéricos soltos pelo código): `recordWebhookMessageReceived(channel, type)`, `recordAiReplySent(channel)`, `recordReportDispatch(status)`, `recordAlertJobExecuted(status)`, `recordHttpError(statusCode, route)`
**O que fazer:** Implementar o provider e o service; registrar `ObservabilityModule` como `@Global()` em `app.module.ts`
**Depende de:** Tarefas 1 e 2
**Testável:** testes unitários do `MetricsService` com o `Meter` mockado

### Tarefa 4 — Flush de métricas no shutdown (Cloud Run SIGTERM)
**Arquivos:** `src/main.ts`, `src/observability/otel-metrics.provider.ts`
**O que fazer:** Chamar `app.enableShutdownHooks()` em `main.ts` (hoje ausente); implementar `onApplicationShutdown` no provider chamando `meterProvider.forceFlush()` e `meterProvider.shutdown()`
**Depende de:** Tarefa 3
**Testável:** teste unitário garantindo que `forceFlush`/`shutdown` são chamados no hook; manualmente, `kill -TERM` no processo local e conferir no log que o flush ocorreu

### Tarefa 5 — Instrumentar pontos de negócio (métricas por tenant/canal)
**Arquivos:**
- `src/modules/webhook/instagram/processors/instagram-webhook.processor.ts`
- `src/modules/whatsapp-session/whatsapp-session.service.ts` (handler de `messages.upsert`)
- `src/modules/webhook/instagram/conversation-bot.service.ts` (ou onde a resposta da IA é efetivamente enviada)
- `src/modules/report-dispatches/report-dispatches.service.ts`
- `src/modules/alert-jobs/alert-jobs.service.ts`
**O que fazer:** Injetar `MetricsService` e chamar os métodos de domínio nos pontos já identificados no diagrama de fluxo. Rotular por `channel`/`pageId`/`phoneNumber` (identificador externo do tenant, já disponível no payload) em vez de resolver o UUID interno do cliente só para a métrica — evita round-trip a banco e mantém a cardinalidade controlada
**Depende de:** Tarefa 3
**Testável:** testes unitários existentes desses services atualizados com o `MetricsService` mockado, verificando a chamada com os argumentos esperados

### Tarefa 6 — Contador de erros HTTP
**Arquivo:** `src/common/filters/http-exception.filter.ts`
**O que fazer:** Injetar `MetricsService` no filtro e chamar `recordHttpError(status, req.route?.path ?? req.originalUrl)` no branch de `status >= 500` (manter o `logger.error` existente)
**Depende de:** Tarefa 3
**Testável:** teste unitário do filtro (criar `http-exception.filter.spec.ts` se não existir) cobrindo 500 vs. 4xx

### Tarefa 7 — Migrar logging para `nestjs-pino` com saída dupla (stdout + OTLP)
**Arquivos:**
- `src/app.module.ts` — importar `LoggerModule.forRootAsync` do `nestjs-pino`, configurado com `pino.transport({ targets: [...] })`: um target `pino/file` (stdout, mantém compatibilidade com Cloud Run/Cloud Logging) e um target `pino-opentelemetry-transport` (ativo só quando `OBSERVABILITY_ENABLED=true`)
- `src/main.ts` — `app.useLogger(app.get(Logger))` + `bufferLogs: true` no `NestFactory.create`
- Remover `src/common/middleware/http-logger.middleware.ts` do `app.module.ts` (o `pino-http` embutido no `nestjs-pino` já loga cada requisição)
**O que fazer:** Trocar o logger padrão do Nest pelo pino estruturado, preservando o log de requisição que a middleware antiga fazia
**Depende de:** Tarefa 2
**Testável:** `npm run start:dev` e conferir que as linhas de log saem em JSON e que uma requisição aparece logada uma única vez (sem duplicar com a middleware antiga)

### Tarefa 8 — Testes
**Arquivos:** `*.spec.ts` dos services tocados nas Tarefas 5 e 6, mais `src/observability/metrics.service.spec.ts`
**O que fazer:** Cobrir: `MetricsService` chama o `Meter` certo por método; services de negócio chamam `MetricsService` com os labels corretos; `HttpExceptionFilter` só conta 5xx
**Depende de:** Tarefas 3, 5 e 6
**Testável:** `npm run test`

### Tarefa 9 — Infra: criar o stack no Grafana Cloud (manual, fora do código)
**O que fazer:** Criar conta/organização no Grafana Cloud free tier; criar um stack; na página "OpenTelemetry" do stack, gerar o Access Policy Token e copiar `endpoint` + `instance ID`; configurar essas três variáveis como secrets no Cloud Run (ex.: via `gcloud run services update --set-secrets`)
**Depende de:** Tarefa 2 (nomes das env vars já definidos)
**Testável:** com `OBSERVABILITY_ENABLED=true` em staging, a métrica `webhook_messages_received_total` aparece no Explore do Grafana Cloud poucos minutos após uma mensagem de teste

### Tarefa 10 — Dashboards e alertas no Grafana Cloud (manual + JSON versionado)
**Arquivos:** `observability/dashboards/*.json` (novo diretório, versiona os dashboards exportados do Grafana Cloud)
**O que fazer:** Montar 2-3 dashboards iniciais (visão HTTP/erros, volume de mensagens por canal e por tenant, funil IA→CRM) e configurar 2-3 alertas básicos (taxa de erro 5xx acima de X%, zero mensagens processadas em Y minutos durante horário comercial, falha de `report_dispatch`) com notificação por e-mail ou webhook pro Slack
**Depende de:** Tarefa 9 e dados reais fluindo (Tarefas 3-7 em produção)
**Testável:** disparar manualmente uma condição (ex.: forçar um 500) e confirmar que o alerta dispara e a notificação chega

## Estimativa

| Tarefa | Complexidade | Estimativa |
|---|---|---|
| 1 — Dependências | Baixa | 10 min |
| 2 — Config e env vars | Baixa | 30 min |
| 3 — ObservabilityModule + MeterProvider | Alta | 2h |
| 4 — Flush no shutdown | Média | 45 min |
| 5 — Instrumentar pontos de negócio | Alta | 2-3h |
| 6 — Contador de erros HTTP | Baixa | 30 min |
| 7 — Migrar pra nestjs-pino | Média | 1-1.5h |
| 8 — Testes | Média | 1.5h |
| 9 — Infra Grafana Cloud (manual) | Baixa | 30 min |
| 10 — Dashboards e alertas (manual) | Média | 1.5-2h |

**Total estimado:** ~11-12h (código + infra manual)

## Riscos e Dependências

- **Resolução de tenant inconsistente:** não existe hoje um mecanismo central (`AsyncLocalStorage`/interceptor) que exponha o tenant atual; a Tarefa 5 assume rotular métricas pelo identificador externo (`pageId`, `phoneNumber`) em vez do UUID interno do cliente. Se o time quiser análises cruzadas por `clientId` no Grafana, vai precisar de um join manual (tabela de mapeamento) ou de uma etapa futura pra introduzir esse contexto central — fora do escopo deste plano.
- **Cardinalidade de séries:** rotular métricas por tenant é seguro enquanto o número de tenants for de dezenas/poucas centenas (típico de B2B); se crescer muito, pode estourar o limite de séries ativas do free tier do Grafana Cloud — vale monitorar o uso na própria página de billing do Grafana Cloud.
- **Confirmar handler exato do WhatsApp:** o ponto de instrumentação em `whatsapp-session.service.ts` (evento `messages.upsert` do Baileys) precisa ser confirmado durante a implementação — o trecho do arquivo lido no plano cobre só a conexão/autenticação, não o recebimento de mensagens.
- **Shutdown hooks:** `app.enableShutdownHooks()` ainda não existe no `main.ts` — sem isso, métricas dos últimos segundos de vida de uma instância Cloud Run (scale-down) podem se perder. Tarefa 4 cobre isso, mas é importante validar em staging com um deploy real (não só `kill -TERM` local).
- **Limite do free tier do Grafana Cloud:** confirmar no momento da Tarefa 9 os limites vigentes (séries de métricas, GB de logs/mês) — esses números mudam com o tempo e não devem ser hardcoded no plano.
