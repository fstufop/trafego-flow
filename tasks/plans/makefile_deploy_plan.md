# Plano de Implementação: Makefile de Deploy

**Spec:** `tasks/specs/makefile_deploy_spec.md`
**Data:** 2026-06-19

---

## Análise de Alternativas

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| A — Makefile (Escolhida) | Arquivo `make` nativo, sem dependências extras | Universal, disponível em qualquer Mac/Linux, sintaxe madura, suporte a dependências entre targets | Sintaxe sensível a tabs; Windows precisa de make instalado |
| B — Shell script (`scripts/deploy.sh`) | Script bash com funções | Mais flexível para lógica condicional complexa | Sem orquestração nativa de dependências; já existe pasta `scripts/` mas sem padrão estabelecido |
| C — npm scripts | Adicionar scripts em `package.json` | Sem dependência extra de ferramenta | Comandos longos em JSON ficam ilegíveis; sem dependências entre targets; não adequado para infra |

**Decisão:** Alternativa A (Makefile) — é a ferramenta padrão da indústria para automação de build/deploy, integra nativamente com o fluxo `make target` e suporta dependências declarativas entre targets sem lógica adicional.

---

## Recursos Reutilizáveis Identificados

- **`Dockerfile`** — já configurado com `--platform=linux/amd64` e multi-stage build; o `make build` pode aproveitar diretamente sem flags extras além da tag
- **`package.json` scripts** — `migration:run` já existe e será invocado pelo Cloud Run Job via `npm run migration:run`
- **`docs/deploy.md`** — todos os comandos GCP já validados; o Makefile é essencialmente uma orquestração desses comandos

---

## Diagrama de Fluxo

```
Desenvolvedor
    │
    ├── make gcp-setup      →  gcloud (login, APIs, Artifact Registry)
    ├── make docker-auth    →  gcloud auth configure-docker
    ├── make iam-setup      →  gcloud iam-policy-binding
    ├── make secret-create  →  gcloud secrets create (6 secrets)
    │
    ├── make build          →  docker build (linux/amd64)
    ├── make push           →  docker push → Artifact Registry
    │
    ├── make deploy         →  gcloud run deploy (env vars + secrets)
    ├── make migrate-create →  gcloud run jobs create (idempotente)
    ├── make migrate        →  gcloud run jobs execute
    │
    ├── make update         →  build → push → deploy
    ├── make full-deploy    →  build → push → deploy → migrate-create → migrate
    │
    ├── make logs           →  gcloud run services logs read
    └── make open           →  gcloud run services describe → abre URL no browser
```

---

## Tarefas Sequenciais

### Tarefa 1 — Variáveis e estrutura base
**Arquivo:** `Makefile`
**O que fazer:**
- Criar o arquivo na raiz do projeto
- Declarar todas as variáveis no topo:
  ```makefile
  PROJECT_ID   = trafegoflow
  REGION       = southamerica-east1
  REGISTRY     = $(REGION)-docker.pkg.dev/$(PROJECT_ID)/$(PROJECT_ID)
  IMAGE        = $(REGISTRY)/app
  SERVICE_NAME = $(PROJECT_ID)
  JOB_NAME     = $(PROJECT_ID)-migrate
  ```
- Declarar `.PHONY` com todos os targets
- Implementar `make help` com `grep + awk` sobre comentários `##`
- Definir `help` como target default (primeira regra do arquivo)

**Depende de:** nada
**Testável:** `make help` exibe lista de targets sem erro

---

### Tarefa 2 — Targets de setup GCP (executados uma vez)
**Arquivo:** `Makefile`
**O que fazer:**
- `gcp-setup`: login, `config set project`, `services enable` (run, artifactregistry, secretmanager), `artifacts repositories create`
- `docker-auth`: `gcloud auth configure-docker $(REGION)-docker.pkg.dev`
- `iam-setup`: captura `PROJECT_NUMBER` via `gcloud projects describe` e aplica `roles/secretmanager.secretAccessor`

**Nota:** `gcp-setup` e `iam-setup` podem ser re-executados sem efeito colateral (GCP retorna aviso, não erro). Adicionar `|| true` apenas onde necessário (criação do repositório já existente).

**Depende de:** Tarefa 1
**Testável:** execução em ambiente com gcloud autenticado

---

### Tarefa 3 — Targets de gestão de secrets
**Arquivo:** `Makefile`
**O que fazer:**
- `secret-create`: cria os 6 secrets via pipe de `echo -n`:
  - `DATABASE_URL`, `REDIS_URL`, `MASTER_API_KEY`, `ENCRYPTION_KEY`, `META_APP_SECRET`, `META_VERIFY_TOKEN`
  - Usar variáveis passadas via CLI: `make secret-create DATABASE_URL="..."` 
  - Validar que a variável não está vazia antes de executar (`ifndef` do make)
- `secret-update`: genérico — `make secret-update NAME=DATABASE_URL VALUE="novo-valor"`

**Depende de:** Tarefa 1
**Testável:** `make -n secret-create DATABASE_URL="test"` (dry-run) imprime o comando correto sem executar

---

### Tarefa 4 — Targets de build e push Docker
**Arquivo:** `Makefile`
**O que fazer:**
- `build`: `docker build --platform linux/amd64 -t $(IMAGE):latest .`
- `push`: `docker push $(IMAGE):latest`
- Suporte a override: `make build IMAGE=outra-imagem:v2`

**Nota:** O Dockerfile já usa `--platform=linux/amd64` internamente, mas a flag no `docker build` é necessária para garantir cross-platform quando o host é ARM (Apple Silicon).

**Depende de:** Tarefa 1
**Testável:** `make -n build` e `make -n push` imprimem comandos corretos

---

### Tarefa 5 — Target de deploy no Cloud Run
**Arquivo:** `Makefile`
**O que fazer:**
- `deploy`: `gcloud run deploy` com todos os parâmetros da spec:
  - `--image`, `--region`, `--platform managed`, `--allow-unauthenticated`
  - `--port 3000`, `--memory 512Mi`, `--min-instances 0`, `--max-instances 2`
  - `--set-env-vars` com as 5 variáveis não-sensíveis
  - `--set-secrets` com os 6 secrets (um `--set-secrets` por secret, conforme sintaxe do gcloud)

**Depende de:** Tarefa 1
**Testável:** `make -n deploy` imprime o comando completo com todas as flags

---

### Tarefa 6 — Targets de migrations
**Arquivo:** `Makefile`
**O que fazer:**
- `migrate-create`: `gcloud run jobs create $(JOB_NAME)` com `--command "npm" --args "run,migration:run"` + `|| true` para idempotência
- `migrate`: `gcloud run jobs execute $(JOB_NAME) --region $(REGION) --wait`
  - Flag `--wait` bloqueia até o job terminar e exibe o status final no terminal

**Nota:** `--wait` é importante para que o pipeline saiba se as migrations foram bem-sucedidas antes de continuar.

**Depende de:** Tarefa 1
**Testável:** `make -n migrate` imprime o comando correto

---

### Tarefa 7 — Targets compostos (update e full-deploy)
**Arquivo:** `Makefile`
**O que fazer:**
- `update`: declara dependências `build push deploy` (make executa em sequência)
  ```makefile
  update: build push deploy ## Rebuild e redeploy sem migrations
  ```
- `full-deploy`: declara dependências `build push deploy migrate-create migrate`
  ```makefile
  full-deploy: build push deploy migrate-create migrate ## Deploy completo com migrations
  ```

**Nota:** Usar dependências de targets (`update: build push deploy`) ao invés de chamar `$(MAKE)` recursivamente — mais simples e compatível com `make -n`.

**Depende de:** Tarefas 4, 5, 6
**Testável:** `make -n update` e `make -n full-deploy` mostram todos os sub-comandos na ordem correta

---

### Tarefa 8 — Targets de observabilidade
**Arquivo:** `Makefile`
**O que fazer:**
- `logs`: `gcloud run services logs read $(SERVICE_NAME) --region $(REGION) --limit 50`
- `open`: extrai a URL com `gcloud run services describe` + `--format` e abre com `open` (macOS) ou `xdg-open` (Linux):
  ```makefile
  open:
    @URL=$$(gcloud run services describe $(SERVICE_NAME) --region $(REGION) --format="value(status.url)"); \
    echo "Abrindo $$URL"; \
    open "$$URL" 2>/dev/null || xdg-open "$$URL"
  ```

**Depende de:** Tarefa 1
**Testável:** `make -n logs` e `make -n open` imprimem os comandos corretos

---

## Ordem de execução recomendada

```
Tarefa 1 (base)
    ├── Tarefa 2 (gcp-setup)     ─┐
    ├── Tarefa 3 (secrets)        ├─ paralelas
    ├── Tarefa 4 (build/push)     │
    ├── Tarefa 5 (deploy)         │
    ├── Tarefa 6 (migrations)    ─┘
    └── Tarefa 7 (compostos) ← depende de 4, 5, 6
    └── Tarefa 8 (observabilidade) ← paralela com 7
```

Na prática, como é um único arquivo, as tarefas serão implementadas em sequência no mesmo arquivo.

---

## Estimativa

| Tarefa | Descrição | Complexidade | Estimativa |
|---|---|---|---|
| 1 | Estrutura base + help | Baixa | 15 min |
| 2 | Setup GCP | Baixa | 15 min |
| 3 | Gestão de secrets | Média | 20 min |
| 4 | Build e push | Baixa | 10 min |
| 5 | Deploy Cloud Run | Baixa | 15 min |
| 6 | Migrations | Baixa | 15 min |
| 7 | Targets compostos | Baixa | 10 min |
| 8 | Observabilidade | Baixa | 10 min |

**Total estimado: ~1h30**

---

## Riscos e Dependências

### Riscos

| Risco | Probabilidade | Mitigação |
|---|---|---|
| `gcloud` não instalado na máquina do dev | Baixa | Documentado em `docs/deploy.md` como pré-requisito |
| `make` não disponível (Windows) | Média | Escopo atual é Mac/Linux; Windows não é mencionado no deploy.md |
| Secret já existente ao rodar `secret-create` | Alta | Usar `secret-update` separado; não usar `|| true` no create para não mascarar erros reais |
| Job de migration falha silenciosamente | Média | Flag `--wait` em `make migrate` garante que o exit code do job propague para o make |
| `open` no Linux usa `xdg-open` (não `open`) | Média | Target `open` implementa fallback com `|| xdg-open` |

### Pontos de atenção

- **`--set-secrets` no gcloud run deploy** — a sintaxe atual do `deploy.md` usa um `--set-secrets` por secret. Isso é correto e deve ser replicado exatamente no Makefile (não concatenar numa única flag).
- **Tabs no Makefile** — receitas de targets precisam de TAB, não espaços. Garantir que o editor não converta para espaços ao salvar.
- **Variáveis com `=` vs `:=`** — usar `=` (lazy) para variáveis que referenciam outras variáveis (`REGISTRY`, `IMAGE`); usar `:=` (eager) apenas quando necessário para evaliação imediata.
