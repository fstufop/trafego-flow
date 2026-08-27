# Deploy no Google Cloud Run

Stack: NestJS no Cloud Run (GCP) + PostgreSQL no Supabase + Redis no Upstash.

Secrets sensíveis são armazenados no **Secret Manager** e injetados no Cloud Run em tempo de execução — nunca ficam expostos em comandos ou logs.

## Pré-requisitos

- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) instalado
- [Docker](https://www.docker.com) instalado
- Conta no [Supabase](https://supabase.com) (free tier)
- Conta no [Upstash](https://upstash.com) (free tier)

---

## 1. Configurar banco de dados e cache

### Supabase (PostgreSQL)

1. Crie um projeto em [supabase.com](https://supabase.com)
2. Vá em **Settings > Database > Connection string > URI**
3. Copie a URI — ela será o valor de `DATABASE_URL`

### Upstash (Redis)

1. Crie um banco Redis em [upstash.com](https://upstash.com)
2. Vá em **Data > Details > REDIS_URL**
3. Copie a URL (começa com `rediss://`) — ela será o valor de `REDIS_URL`

---

## 2. Configurar o GCP (fazer apenas uma vez)

```bash
# Login e seleção do projeto
gcloud auth login
gcloud config set project trafegoflow

# Ativar APIs necessárias
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com

# Criar repositório de imagens Docker
gcloud artifacts repositories create trafegoflow \
  --repository-format=docker \
  --location=southamerica-east1

# Autenticar Docker no GCP
gcloud auth configure-docker southamerica-east1-docker.pkg.dev
```

---

## 3. Criar os secrets no Secret Manager

Cada secret é criado uma única vez. Para atualizar um valor, adicione uma nova versão (o histórico fica preservado).

```bash
# Gerar valores para as chaves
openssl rand -hex 32  # use o resultado como MASTER_API_KEY
openssl rand -hex 32  # use o resultado como ENCRYPTION_KEY

# Criar os secrets (substitua os valores entre aspas)
echo -n "postgresql://..." | gcloud secrets create DATABASE_URL --data-file=-
echo -n "rediss://..."     | gcloud secrets create REDIS_URL --data-file=-
echo -n "seu-valor"        | gcloud secrets create MASTER_API_KEY --data-file=-
echo -n "64-chars-hex"     | gcloud secrets create ENCRYPTION_KEY --data-file=-
echo -n "seu-valor"        | gcloud secrets create META_APP_SECRET --data-file=-
echo -n "seu-valor"        | gcloud secrets create META_VERIFY_TOKEN --data-file=-
echo -n "GOCSPX-..."       | gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=-
echo -n "1//04..."         | gcloud secrets create GOOGLE_REFRESH_TOKEN --data-file=-
echo -n "64-chars-hex"     | gcloud secrets create JWT_SECRET --data-file=-
echo -n "EAAOPT3..."       | gcloud secrets create META_SYSTEM_USER_TOKEN --data-file=-
echo -n "AQ.Ab8..."        | gcloud secrets create GEMINI_API_KEY --data-file=-
```

> Valores não sensíveis (`GOOGLE_CLIENT_ID`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `AI_PROVIDER`, `AI_MODEL`, `META_APP_ID`, `WHATSAPP_DEDICATED_PHONE`, `MANAGERS_GROUP_JID`, `MAX_FILE_SIZE_MB`) vão em `--set-env-vars` no deploy — sem custo de Secret Manager.

### Atualizar um secret existente

```bash
echo -n "novo-valor" | gcloud secrets versions add NOME_DO_SECRET --data-file=-
```

---

## 4. Autorizar o Cloud Run a ler os secrets

O Cloud Run usa uma service account para acessar os secrets. Execute uma vez:

```bash
# Obter o número do projeto
PROJECT_NUMBER=$(gcloud projects describe trafegoflow --format="value(projectNumber)")

# Conceder acesso de leitura aos secrets
gcloud projects add-iam-policy-binding trafegoflow \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

## 5. Primeiro deploy

### Build e push da imagem

```bash
docker build --platform linux/amd64 -t southamerica-east1-docker.pkg.dev/trafegoflow/trafegoflow/app:latest .
docker push southamerica-east1-docker.pkg.dev/trafegoflow/trafegoflow/app:latest
```

### Deploy no Cloud Run

Variáveis não-sensíveis vão em `--set-env-vars`. Secrets vão em `--set-secrets`.

```bash
gcloud run deploy trafegoflow \
  --image southamerica-east1-docker.pkg.dev/trafegoflow/trafegoflow/app:latest \
  --region southamerica-east1 \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi \
  --min-instances 0 \
  --max-instances 2 \
  --set-env-vars "^|^NODE_ENV=production|META_GRAPH_API_URL=https://graph.facebook.com|META_GRAPH_API_VERSION=v21.0|META_ADS_API_VERSION=v21.0|META_APP_ID=1001996369089789|INSIGHTS_CACHE_TTL_SECONDS=300|CACHE_TTL_SECONDS=3600|AI_PROVIDER=gemini|AI_MODEL=gemini-3.6-flash|MANAGERS_GROUP_JID=120363428387791834@g.us|MAX_FILE_SIZE_MB=500|GOOGLE_CLIENT_ID=347462891215-57odjsuomss675lprumaolf7npbqrie5.apps.googleusercontent.com|GOOGLE_DRIVE_ROOT_FOLDER_ID=1OL-Y2uLn6jGdedsYRp7mMqu8N1dcAcY6" \
  --set-secrets DATABASE_URL=DATABASE_URL:latest \
  --set-secrets REDIS_URL=REDIS_URL:latest \
  --set-secrets MASTER_API_KEY=MASTER_API_KEY:latest \
  --set-secrets ENCRYPTION_KEY=ENCRYPTION_KEY:latest \
  --set-secrets JWT_SECRET=JWT_SECRET:latest \
  --set-secrets META_APP_SECRET=META_APP_SECRET:latest \
  --set-secrets META_VERIFY_TOKEN=META_VERIFY_TOKEN:latest \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest \
  --set-secrets GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest \
  --set-secrets GOOGLE_REFRESH_TOKEN=GOOGLE_REFRESH_TOKEN:latest
```

Ao final, o GCP exibirá a URL pública da aplicação, ex: `https://trafegoflow-xxx-rj.a.run.app`

### Rodar migrations

```bash
gcloud run jobs create trafegoflow-migrate \
  --image southamerica-east1-docker.pkg.dev/trafegoflow/trafegoflow/app:latest \
  --region southamerica-east1 \
  --command "npm" \
  --args "run,migration:run" \
  --set-secrets DATABASE_URL=DATABASE_URL:latest

gcloud run jobs execute trafegoflow-migrate --region southamerica-east1
```

---

## 6. Atualizar após mudanças no código

```bash
docker build --platform linux/amd64 -t southamerica-east1-docker.pkg.dev/trafegoflow/trafegoflow/app:latest .
docker push southamerica-east1-docker.pkg.dev/trafegoflow/trafegoflow/app:latest
gcloud run deploy trafegoflow \
  --image southamerica-east1-docker.pkg.dev/trafegoflow/trafegoflow/app:latest \
  --region southamerica-east1
```

Se houver novas migrations, execute novamente o job:

```bash
gcloud run jobs execute trafegoflow-migrate --region southamerica-east1
```

---

## 7. Configurar webhook da Meta

Após o deploy, use a URL pública gerada pelo Cloud Run para configurar o webhook no painel da Meta:

- **URL do webhook:** `https://<sua-url>.a.run.app/webhook`
- **Verify token:** valor definido no secret `META_VERIFY_TOKEN`

---

## Variáveis de ambiente

Consulte `.env.example` para a lista completa de variáveis e onde encontrar cada valor.
