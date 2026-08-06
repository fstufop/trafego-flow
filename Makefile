# Makefile de Deploy — trafegoflow
# Referência: docs/deploy.md
#
# Uso rápido:
#   make help          — lista todos os targets disponíveis
#   make update        — build + push + deploy (sem migrations)
#   make full-deploy   — build + push + deploy + migrate (primeiro deploy)

PROJECT_ID   = trafegoflow
REGION       = southamerica-east1
REGISTRY     = $(REGION)-docker.pkg.dev/$(PROJECT_ID)/$(PROJECT_ID)
IMAGE        = $(REGISTRY)/app
SERVICE_NAME = $(PROJECT_ID)
JOB_NAME     = $(PROJECT_ID)-migrate

.PHONY: help \
        gcp-setup docker-auth iam-setup \
        secret-create secret-update \
        build push \
        deploy migrate-create migrate \
        update full-deploy \
        logs open

# ── App build and config ──────────────────────────────────────────────────────
docker-down: ## Para docker em execução
	@docker compose down

docker-up: ## Inicia docker em background
	@docker compose up -d

run: ## Inicia servidor local
	npm run start:dev

# ── Default target ────────────────────────────────────────────────────────────

help: ## Exibe esta ajuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Setup GCP (executar uma vez) ──────────────────────────────────────────────

gcp-setup: ## Configura projeto GCP, ativa APIs e cria repositório no Artifact Registry
	gcloud auth login
	gcloud config set project $(PROJECT_ID)
	gcloud services enable \
	  run.googleapis.com \
	  artifactregistry.googleapis.com \
	  secretmanager.googleapis.com
	gcloud artifacts repositories create $(PROJECT_ID) \
	  --repository-format=docker \
	  --location=$(REGION) \
	  || true

docker-auth: ## Autentica Docker no Artifact Registry
	gcloud auth configure-docker $(REGION)-docker.pkg.dev

iam-setup: ## Concede permissão de leitura de secrets ao service account do Cloud Run
	gcloud projects add-iam-policy-binding $(PROJECT_ID) \
	  --member="serviceAccount:$$(gcloud projects describe $(PROJECT_ID) --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
	  --role="roles/secretmanager.secretAccessor"

# ── Gestão de Secrets ─────────────────────────────────────────────────────────

secret-create: ## Cria todos os secrets no Secret Manager — ex: make secret-create DATABASE_URL="..." REDIS_URL="..."
	@test -n "$(DATABASE_URL)"      || (echo "Erro: DATABASE_URL não informado";      exit 1)
	@test -n "$(REDIS_URL)"         || (echo "Erro: REDIS_URL não informado";         exit 1)
	@test -n "$(MASTER_API_KEY)"    || (echo "Erro: MASTER_API_KEY não informado";    exit 1)
	@test -n "$(ENCRYPTION_KEY)"    || (echo "Erro: ENCRYPTION_KEY não informado";    exit 1)
	@test -n "$(META_APP_SECRET)"   || (echo "Erro: META_APP_SECRET não informado";   exit 1)
	@test -n "$(META_VERIFY_TOKEN)" || (echo "Erro: META_VERIFY_TOKEN não informado"; exit 1)
	@echo "Criando secrets no Secret Manager..."
	@echo -n "$(DATABASE_URL)"      | gcloud secrets create DATABASE_URL      --data-file=- --replication-policy=automatic
	@echo -n "$(REDIS_URL)"         | gcloud secrets create REDIS_URL         --data-file=- --replication-policy=automatic
	@echo -n "$(MASTER_API_KEY)"    | gcloud secrets create MASTER_API_KEY    --data-file=- --replication-policy=automatic
	@echo -n "$(ENCRYPTION_KEY)"    | gcloud secrets create ENCRYPTION_KEY    --data-file=- --replication-policy=automatic
	@echo -n "$(META_APP_SECRET)"   | gcloud secrets create META_APP_SECRET   --data-file=- --replication-policy=automatic
	@echo -n "$(META_VERIFY_TOKEN)" | gcloud secrets create META_VERIFY_TOKEN --data-file=- --replication-policy=automatic
	@echo "Secrets criados com sucesso."

secret-update: ## Atualiza um secret existente — ex: make secret-update NAME=DATABASE_URL VALUE="novo-valor"
	@test -n "$(NAME)"  || (echo "Erro: NAME não informado";  exit 1)
	@test -n "$(VALUE)" || (echo "Erro: VALUE não informado"; exit 1)
	@echo -n "$(VALUE)" | gcloud secrets versions add $(NAME) --data-file=-

# ── Build e Push Docker ───────────────────────────────────────────────────────

build: ## Build da imagem Docker para linux/amd64
	docker build --platform linux/amd64 -t $(IMAGE):latest .

push: ## Push da imagem para o Artifact Registry
	docker push $(IMAGE):latest

# ── Deploy Cloud Run ──────────────────────────────────────────────────────────

deploy: ## Deploy do serviço no Cloud Run com todas as env vars e secrets
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

# ── Migrations ────────────────────────────────────────────────────────────────

migrate-create: ## Cria o Cloud Run Job para migrations (idempotente)
	gcloud run jobs create $(JOB_NAME) \
	  --image $(IMAGE):latest \
	  --region $(REGION) \
	  --command "npm" \
	  --args "run,migration:run" \
	  --set-secrets DATABASE_URL=DATABASE_URL:latest \
	  || true

migrate: ## Executa as migrations no Cloud Run (aguarda conclusão)
	gcloud run jobs execute $(JOB_NAME) --region $(REGION) --wait

# ── Targets Compostos ─────────────────────────────────────────────────────────

update: build push deploy ## Rebuild e redeploy sem migrations

full-deploy: build push deploy migrate-create migrate ## Deploy completo com migrations

# ── Observabilidade ───────────────────────────────────────────────────────────

logs: ## Exibe os últimos 50 logs do serviço no Cloud Run
	gcloud run services logs read $(SERVICE_NAME) --region $(REGION) --limit 50

open: ## Abre a URL pública do serviço no navegador
	@URL=$$(gcloud run services describe $(SERVICE_NAME) --region $(REGION) --format="value(status.url)"); \
	echo "Abrindo $$URL"; \
	open "$$URL" 2>/dev/null || xdg-open "$$URL"
