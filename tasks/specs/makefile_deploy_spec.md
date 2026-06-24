# Spec: Makefile de Deploy

## 1. Objetivo

Automatizar todos os comandos de build, push e deploy no Google Cloud Run via um `Makefile` na raiz do projeto. Elimina a necessidade de memorizar comandos longos e reduz erros manuais durante o processo de entrega.

---

## 2. Contexto

Este não é um módulo NestJS — é um arquivo de automação de infraestrutura. Todos os targets são globais (não há isolamento por tenant). O `Makefile` serve como interface única para as operações descritas em `docs/deploy.md`.

---

## 3. Descrição Funcional

- Definir variáveis de configuração em um único lugar (projeto GCP, região, imagem Docker)
- Expor targets para cada etapa do fluxo de deploy:
  - Setup inicial do GCP (uma única vez)
  - Build e push da imagem Docker
  - Deploy no Cloud Run
  - Execução de migrations (criação do job + execução)
  - Atualização após mudanças no código (build + push + deploy)
  - Gestão de secrets (criar e atualizar)
- Exibir ajuda (`make help`) listando todos os targets disponíveis

---

## 4. Estrutura de Arquivos

### Novos arquivos

- `Makefile` — raiz do projeto

### Arquivos modificados

Nenhum. O `Makefile` é independente.

---

## 5. Variáveis do Makefile

```makefile
PROJECT_ID    = trafegoflow
REGION        = southamerica-east1
REGISTRY      = $(REGION)-docker.pkg.dev/$(PROJECT_ID)/$(PROJECT_ID)
IMAGE         = $(REGISTRY)/app
SERVICE_NAME  = $(PROJECT_ID)
JOB_NAME      = $(PROJECT_ID)-migrate
```

---

## 6. Targets e Mapeamento com deploy.md

| Target                  | Seção deploy.md | Descrição                                                              |
|-------------------------|-----------------|------------------------------------------------------------------------|
| `make help`             | —               | Lista todos os targets com descrição                                   |
| `make gcp-setup`        | §2              | Login, seleção de projeto, ativação de APIs, criação do repositório    |
| `make docker-auth`      | §2              | `gcloud auth configure-docker` para o registry                        |
| `make build`            | §5              | `docker build --platform linux/amd64`                                 |
| `make push`             | §5              | `docker push` para o Artifact Registry                                |
| `make deploy`           | §5              | `gcloud run deploy` com todas as env vars e secrets                   |
| `make migrate-create`   | §5              | Cria o Cloud Run Job `trafegoflow-migrate` (idempotente)              |
| `make migrate`          | §5 e §6         | Executa o job de migrations no Cloud Run                              |
| `make update`           | §6              | `build` + `push` + `deploy` em sequência (fluxo de atualização)       |
| `make full-deploy`      | §5              | `build` + `push` + `deploy` + `migrate` (primeiro deploy completo)    |
| `make secret-create`    | §3              | Cria todos os secrets necessários no Secret Manager                   |
| `make iam-setup`        | §4              | Concede permissão de leitura de secrets ao Cloud Run                  |
| `make logs`             | —               | `gcloud run services logs read` para o serviço                        |
| `make open`             | —               | Abre a URL pública do serviço no navegador                            |

---

## 7. Detalhamento dos Targets Principais

### `make deploy`

```makefile
deploy:
	gcloud run deploy $(SERVICE_NAME) \
	  --image $(IMAGE):latest \
	  --region $(REGION) \
	  --platform managed \
	  --allow-unauthenticated \
	  --port 3000 \
	  --memory 512Mi \
	  --min-instances 0 \
	  --max-instances 2 \
	  --set-env-vars NODE_ENV=production,META_GRAPH_API_VERSION=v21.0,META_ADS_API_VERSION=v21.0,INSIGHTS_CACHE_TTL_SECONDS=300,CACHE_TTL_SECONDS=3600 \
	  --set-secrets DATABASE_URL=DATABASE_URL:latest \
	  --set-secrets REDIS_URL=REDIS_URL:latest \
	  --set-secrets MASTER_API_KEY=MASTER_API_KEY:latest \
	  --set-secrets ENCRYPTION_KEY=ENCRYPTION_KEY:latest \
	  --set-secrets META_APP_SECRET=META_APP_SECRET:latest \
	  --set-secrets META_VERIFY_TOKEN=META_VERIFY_TOKEN:latest
```

### `make migrate-create`

Usa `|| true` para tornar o target idempotente — se o job já existir, não falha:

```makefile
migrate-create:
	gcloud run jobs create $(JOB_NAME) \
	  --image $(IMAGE):latest \
	  --region $(REGION) \
	  --command "npm" \
	  --args "run,migration:run" \
	  --set-secrets DATABASE_URL=DATABASE_URL:latest \
	  || true
```

### `make secret-create`

Instrui o usuário com `@echo` antes de cada comando, pois os valores devem ser informados interativamente. Alternativa: suportar variáveis passadas via CLI:

```bash
make secret-create DATABASE_URL="postgresql://..." REDIS_URL="rediss://..."
```

### `make update` vs `make full-deploy`

- `update` = build + push + deploy (sem migrations — para entregas sem schema changes)
- `full-deploy` = build + push + deploy + migrate (primeiro deploy ou quando há migrations)

---

## 8. Targets de Suporte

### `make help`

Gerado automaticamente a partir dos comentários `##` ao lado de cada target:

```makefile
help: ## Exibe esta ajuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
```

### `.PHONY`

Todos os targets são declarados como `.PHONY` para evitar conflito com arquivos de mesmo nome.

---

## 9. Critérios de Aceitação (BDD)

```gherkin
Feature: Makefile de Deploy

  Scenario: Desenvolvedor executa help
    Given o Makefile está na raiz do projeto
    When o dev roda `make help`
    Then todos os targets são exibidos com suas descrições em formato colorido

  Scenario: Atualização de código sem migrations
    Given a imagem está buildada e autenticação no GCP está ativa
    When o dev roda `make update`
    Then a imagem é buildada, enviada ao registry e o Cloud Run é atualizado

  Scenario: Primeiro deploy completo
    Given secrets estão criados no Secret Manager e IAM está configurado
    When o dev roda `make full-deploy`
    Then build + push + deploy + migrations são executados em sequência

  Scenario: Execução de migrations em produção
    Given o job `trafegoflow-migrate` já existe no Cloud Run
    When o dev roda `make migrate`
    Then o job é executado e as migrations são aplicadas no banco de produção

  Scenario: Setup inicial do GCP
    Given o dev tem gcloud instalado e autenticado
    When o dev roda `make gcp-setup`
    Then APIs são ativadas e o repositório Docker é criado no Artifact Registry

  Scenario: Target inexistente
    Given o Makefile está na raiz do projeto
    When o dev roda `make comando-invalido`
    Then o make retorna erro padrão "No rule to make target"
```

---

## 10. Boas Práticas Aplicadas

- **Variáveis centralizadas** — mudar projeto ou região em um único lugar
- **Targets idempotentes** — `migrate-create` usa `|| true`; `gcp-setup` tolera re-execução
- **`.PHONY` explícito** — evita conflito com arquivos/dirs de mesmo nome
- **`@` em comandos de echo** — suprime a linha de comando duplicada no output
- **Suporte a override via CLI** — `make build IMAGE=minha-imagem:v2`
- **Sem secrets hardcoded** — secrets só passam pelo Secret Manager, nunca pelo Makefile

---

## 11. Definition of Done

- [ ] `Makefile` criado na raiz do projeto
- [ ] Todas as variáveis (PROJECT_ID, REGION, REGISTRY, IMAGE, SERVICE_NAME, JOB_NAME) centralizadas no topo
- [ ] Targets implementados: `help`, `gcp-setup`, `docker-auth`, `build`, `push`, `deploy`, `migrate-create`, `migrate`, `update`, `full-deploy`, `iam-setup`, `logs`, `open`
- [ ] `make help` funciona e lista todos os targets com descrição
- [ ] `make update` executa build → push → deploy em sequência
- [ ] `make full-deploy` executa build → push → deploy → migrate em sequência
- [ ] `make migrate-create` é idempotente (não falha se o job já existir)
- [ ] Todos os targets declarados em `.PHONY`
- [ ] Comandos sensíveis (secret-create) documentados com instruções claras
- [ ] `docs/deploy.md` referenciado nos comentários do Makefile para rastreabilidade
