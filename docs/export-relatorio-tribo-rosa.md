# Exportação de Relatório — Tribo Rosa

Curls para exportar as 5 tabelas do relatório via `POST /campaign-reports/insights/export/csv`.

**Substitua antes de executar:**
- `YOUR_API_KEY` → chave de API (`x-api-key`)
- `act_XXXXXXXXX` → Ad Account ID da conta Tribo Rosa
- `BASE_URL` → URL base da API (ex: `https://api.trafegoflow.com.br`)

---

## 1. Campanha — por dia

> Equivalente a: `Tribo Rosa - Dados - Campanha.csv`
> Colunas: Day · Campaign Name · Reach · Impressions · Amount Spent · Link Clicks · Messaging Conversations Started

```bash
curl -X POST "BASE_URL/campaign-reports/insights/export/csv" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -o "Tribo Rosa - Dados - Campanha.csv" \
  -d '{
    "adAccountId": "act_XXXXXXXXX",
    "level": "campaign",
    "timeIncrement": "1",
    "since": "2026-03-31",
    "until": "2026-06-16",
    "columns": [
      "date_start",
      "campaign_name",
      "reach",
      "impressions",
      "spend",
      "link_clicks",
      "messaging_conversations_started"
    ]
  }'
```

---

## 2. Público (Conjunto de Anúncios) — por dia

> Equivalente a: `Tribo Rosa - Dados - Público.csv`
> Colunas: Day · Ad Set Name · Reach · Impressions · Amount Spent · Link Clicks · Messaging Conversations Started

```bash
curl -X POST "BASE_URL/campaign-reports/insights/export/csv" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -o "Tribo Rosa - Dados - Público.csv" \
  -d '{
    "adAccountId": "act_XXXXXXXXX",
    "level": "adset",
    "timeIncrement": "1",
    "since": "2026-03-31",
    "until": "2026-06-16",
    "columns": [
      "date_start",
      "adset_name",
      "reach",
      "impressions",
      "spend",
      "link_clicks",
      "messaging_conversations_started"
    ]
  }'
```

---

## 3. Criativo (Anúncio) — por dia

> Equivalente a: `Tribo Rosa - Dados - Criativo.csv`
> Colunas: Day · Ad Name · Reach · Impressions · Amount Spent · Link Clicks · Messaging Conversations Started

```bash
curl -X POST "BASE_URL/campaign-reports/insights/export/csv" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -o "Tribo Rosa - Dados - Criativo.csv" \
  -d '{
    "adAccountId": "act_XXXXXXXXX",
    "level": "ad",
    "timeIncrement": "1",
    "since": "2026-03-31",
    "until": "2026-06-16",
    "columns": [
      "date_start",
      "ad_name",
      "reach",
      "impressions",
      "spend",
      "link_clicks",
      "messaging_conversations_started"
    ]
  }'
```

---

## 4. Região — por dia

> Equivalente a: `Tribo Rosa - Dados - Região.csv`
> Colunas: Day · Region · Reach · Impressions · Amount Spent · Link Clicks · Messaging Conversations Started

```bash
curl -X POST "BASE_URL/campaign-reports/insights/export/csv" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -o "Tribo Rosa - Dados - Região.csv" \
  -d '{
    "adAccountId": "act_XXXXXXXXX",
    "level": "campaign",
    "timeIncrement": "1",
    "breakdowns": "region",
    "since": "2026-03-31",
    "until": "2026-06-16",
    "columns": [
      "date_start",
      "region",
      "reach",
      "impressions",
      "spend",
      "link_clicks",
      "messaging_conversations_started"
    ]
  }'
```

---

## 5. Idade — por dia

> Equivalente a: `Tribo Rosa - Dados - Idade.csv`
> Colunas: Day · Reach · Impressions · Amount Spent · Link Clicks · Messaging Conversations Started · Age

```bash
curl -X POST "BASE_URL/campaign-reports/insights/export/csv" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -o "Tribo Rosa - Dados - Idade.csv" \
  -d '{
    "adAccountId": "act_XXXXXXXXX",
    "level": "campaign",
    "timeIncrement": "1",
    "breakdowns": "age",
    "since": "2026-03-31",
    "until": "2026-06-16",
    "columns": [
      "date_start",
      "reach",
      "impressions",
      "spend",
      "link_clicks",
      "messaging_conversations_started",
      "age"
    ]
  }'
```

---

## Notas

| Parâmetro | Detalhe |
|---|---|
| `timeIncrement: "1"` | Granularidade diária (coluna `Day` nos CSVs) |
| `breakdowns: "age"` | Exige que a coluna `age` esteja em `columns` |
| `breakdowns: "region"` | Exige que a coluna `region` esteja em `columns` |
| `since` / `until` | Mutuamente exclusivo com `datePreset` |
| Arquivo de saída | O `-o` do curl salva diretamente como `.csv` |

Para exportar um período diferente, troque `since` e `until` mantendo o formato `YYYY-MM-DD`.
