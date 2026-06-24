#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Carrega .env (procura na raiz do projeto, relativo ao script)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [[ -f "$ENV_FILE" ]]; then
  set -o allexport
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +o allexport
else
  echo "Aviso: .env não encontrado em $ENV_FILE" >&2
fi

# ---------------------------------------------------------------------------
# Configuração  (variáveis de ambiente sobrescrevem o .env)
# ---------------------------------------------------------------------------
PORT="${PORT:-3000}"
BASE_URL="${BASE_URL:-http://localhost:$PORT/api/v1}"
API_KEY="${API_KEY:-${MASTER_API_KEY:-}}"
AD_ACCOUNT_ID="${AD_ACCOUNT_ID:-}"
SINCE="${SINCE:-}"          # ex: 2026-03-31  (deixe vazio para usar datePreset)
UNTIL="${UNTIL:-}"          # ex: 2026-06-16
DATE_PRESET="${DATE_PRESET:-last_30d}"   # usado só se SINCE/UNTIL estiverem vazios
OUT_DIR="${OUT_DIR:-./exports}"

# ---------------------------------------------------------------------------
# Validação
# ---------------------------------------------------------------------------
if [[ -z "$API_KEY" ]]; then
  echo "Erro: variável API_KEY não definida." >&2
  echo "  Uso: API_KEY=xxx AD_ACCOUNT_ID=act_123 SINCE=2026-03-31 UNTIL=2026-06-16 ./scripts/export-reports.sh" >&2
  exit 1
fi

if [[ -z "$AD_ACCOUNT_ID" ]]; then
  echo "Erro: variável AD_ACCOUNT_ID não definida." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# ---------------------------------------------------------------------------
# Período — monta o bloco JSON correto
# ---------------------------------------------------------------------------
if [[ -n "$SINCE" && -n "$UNTIL" ]]; then
  PERIOD_JSON="\"since\": \"$SINCE\", \"until\": \"$UNTIL\""
  PERIOD_LABEL="${SINCE}_${UNTIL}"
else
  PERIOD_JSON="\"datePreset\": \"$DATE_PRESET\""
  PERIOD_LABEL="$DATE_PRESET"
fi

# ---------------------------------------------------------------------------
# Função auxiliar: faz o POST e salva o CSV
# ---------------------------------------------------------------------------
export_csv() {
  local report_name="$1"
  local extra_json="$2"       # campos adicionais do body (sem vírgula no início)
  local out_file="$OUT_DIR/${report_name}_${PERIOD_LABEL}.csv"

  echo "→ Exportando: $report_name ..."

  local body
  body=$(printf '{"adAccountId": "%s", %s, %s}' \
    "$AD_ACCOUNT_ID" \
    "$PERIOD_JSON" \
    "$extra_json")

  local http_code
  http_code=$(curl -s -o "$out_file" -w "%{http_code}" \
    -X POST "$BASE_URL/campaign-reports/insights/export/csv" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d "$body")

  if [[ "$http_code" != "200" ]]; then
    echo "  ERRO HTTP $http_code — resposta:" >&2
    cat "$out_file" >&2
    rm -f "$out_file"
    return 1
  fi

  echo "  Salvo em: $out_file"
}

# ---------------------------------------------------------------------------
# Relatórios
# ---------------------------------------------------------------------------

# 1. Campanha — level=campaign, diário
export_csv "campanha" '"level": "campaign", "timeIncrement": "1", "columns": [
  "date_start", "campaign_name", "reach", "impressions", "spend",
  "link_clicks", "messaging_conversations_started"
]'

# 2. Idade — level=campaign, diário, breakdown=age
export_csv "idade" '"level": "campaign", "timeIncrement": "1", "breakdowns": "age", "columns": [
  "date_start", "age", "reach", "impressions", "spend",
  "link_clicks", "messaging_conversations_started"
]'

# 3. Região — level=campaign, diário, breakdown=region
export_csv "regiao" '"level": "campaign", "timeIncrement": "1", "breakdowns": "region", "columns": [
  "date_start", "region", "reach", "impressions", "spend",
  "link_clicks", "messaging_conversations_started"
]'

# 4. Criativo — level=ad, diário
export_csv "criativo" '"level": "ad", "timeIncrement": "1", "columns": [
  "date_start", "ad_name", "reach", "impressions", "spend",
  "link_clicks", "messaging_conversations_started"
]'

# 5. Público — level=adset, diário
export_csv "publico" '"level": "adset", "timeIncrement": "1", "columns": [
  "date_start", "adset_name", "reach", "impressions", "spend",
  "link_clicks", "messaging_conversations_started"
]'

echo ""
echo "Exportação concluída. Arquivos em: $OUT_DIR"
