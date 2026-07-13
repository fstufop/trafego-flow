# WhatsApp — Relatórios Semanais: Guia de Configuração

Este guia cobre o fluxo completo: configurar o número dedicado, emparelhar com o WhatsApp, cadastrar os grupos dos clientes e disparar relatórios.

---

## Pré-requisitos

### 1. Variáveis de ambiente

Adicione ao seu `.env`:

```env
WHATSAPP_DEDICATED_PHONE=+5511999999999   # número dedicado (com DDI)
```

> Use um número separado do seu principal de atendimento. Se o número for suspenso pelo WhatsApp, você não perde o contato com todos os clientes.

### 2. Migrations

```bash
npm run migration:run
```

Isso cria as tabelas `whatsapp_groups`, `whatsapp_sessions` e `report_dispatch_logs`.

### 3. Servidor rodando

```bash
npm run start:dev
```

---

## Etapa 1 — Emparelhar o número dedicado

O emparelhamento é feito **uma única vez**. As credenciais ficam salvas no banco e são restauradas automaticamente a cada reinício do servidor.

### Como emparelhar

**1.** Faça a requisição para gerar o código:

```bash
curl http://localhost:3000/api/v1/whatsapp-session/pairing-code \
  -H "x-api-key: SEU_API_KEY"
```

Resposta:

```json
{ "pairingCode": "ABCD-1234" }
```

O código também aparece no log do servidor:

```
LOG [WhatsAppSessionService] Código de emparelhamento: ABCD-1234
```

**2.** No celular com o número dedicado:

- Abra o WhatsApp
- Vá em **Configurações → Aparelhos conectados → Conectar aparelho**
- Toque em **"Usar número de telefone"** (link no rodapé da tela de QR)
- Digite o código de 8 caracteres

**3.** Quando conectar, o servidor loga:

```
LOG [WhatsAppSessionService] WhatsApp conectado com sucesso
```

### Verificar status da sessão

```bash
curl http://localhost:3000/api/v1/whatsapp-session/status \
  -H "x-api-key: SEU_API_KEY"
```

```json
{ "connected": true }
```

---

## Etapa 2 — Descobrir os JIDs dos grupos

O número dedicado precisa **já ser membro** dos grupos antes de emparelhar. Entre nos grupos normalmente pelo WhatsApp e depois liste-os via API:

```bash
curl http://localhost:3000/api/v1/whatsapp-session/groups \
  -H "x-api-key: SEU_API_KEY"
```

Resposta:

```json
[
  { "jid": "120363000001@g.us", "subject": "Clientes Agência ABC", "participantCount": 6 },
  { "jid": "120363000002@g.us", "subject": "Grupo TráfegoFlow", "participantCount": 3 }
]
```

O `jid` é o identificador único do grupo. Copie o de cada cliente.

---

## Etapa 3 — Cadastrar cliente e grupos

### Criar cliente (se ainda não existir)

```bash
curl -X POST http://localhost:3000/api/v1/clients \
  -H "x-api-key: SEU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Agência XYZ",
    "email": "contato@xyz.com"
  }'
```

Guarde o `id` retornado.

### Registrar grupo do cliente

```bash
curl -X POST http://localhost:3000/api/v1/whatsapp-groups \
  -H "x-api-key: SEU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "UUID_DO_CLIENTE",
    "groupJid": "120363000001@g.us",
    "label": "Grupo principal - Agência XYZ"
  }'
```

Repita para cada grupo. Um cliente pode ter vários grupos — todos receberão o relatório.

### Listar grupos de um cliente

```bash
curl "http://localhost:3000/api/v1/whatsapp-groups?clientId=UUID_DO_CLIENTE" \
  -H "x-api-key: SEU_API_KEY"
```

---

## Etapa 4 — Cadastrar conta de anúncios (opcional para teste)

Sem conta de anúncio, o relatório é enviado com mensagem de aviso. Com conta cadastrada, traz as métricas reais da semana.

```bash
curl -X POST http://localhost:3000/api/v1/ad-accounts \
  -H "x-api-key: SEU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "UUID_DO_CLIENTE",
    "adAccountId": "act_XXXXXXXXX",
    "accessToken": "TOKEN_META_ADS",
    "accountName": "Conta Principal XYZ"
  }'
```

---

## Etapa 5 — Disparar relatório manualmente

Para testar antes da segunda-feira ou para disparos pontuais:

### Para um cliente específico

```bash
curl -X POST http://localhost:3000/api/v1/report-dispatches/trigger \
  -H "x-api-key: SEU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "UUID_DO_CLIENTE"
  }'
```

### Para todos os clientes

```bash
curl -X POST http://localhost:3000/api/v1/report-dispatches/trigger \
  -H "x-api-key: SEU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Para uma semana específica

```bash
curl -X POST http://localhost:3000/api/v1/report-dispatches/trigger \
  -H "x-api-key: SEU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "UUID_DO_CLIENTE",
    "weekStartDate": "2026-06-23"
  }'
```

> `weekStartDate` deve ser uma segunda-feira. Omitir usa a semana anterior automaticamente.

Resposta:

```json
{ "dispatched": 2, "failed": 0 }
```

---

## Etapa 6 — Verificar histórico de envios

```bash
curl "http://localhost:3000/api/v1/report-dispatches?clientId=UUID_DO_CLIENTE" \
  -H "x-api-key: SEU_API_KEY"
```

Cada registro mostra `status: "sent"` ou `"failed"`, com `sentAt` e `errorMessage` quando aplicável.

---

## Disparo automático semanal

O sistema dispara automaticamente **toda segunda-feira às 08h (horário de Brasília)** para todos os clientes que têm grupos e contas de anúncio ativos. Nenhuma ação manual é necessária após a configuração inicial.

---

## Exemplo de mensagem enviada

```
📊 *Relatório Semanal*
📅 Semana: 23/06 a 29/06/2026
💼 Conta: Conta Principal XYZ

💰 Investimento: R$ 1.250,00
👁 Impressões: 45.320
🖱 Cliques: 1.890
📈 CTR: 4,17%
💵 CPM: R$ 27,58

_Enviado automaticamente por TráfegoFlow_
```

---

## Troubleshooting

| Sintoma | Causa | Solução |
|---|---|---|
| `relation "whatsapp_sessions" does not exist` | Migration não foi executada | `npm run migration:run` |
| `there is no unique or exclusion constraint` | Constraint única faltando | `npm run migration:run` (migration `1780000000001`) |
| `Sessão WhatsApp não está conectada` | Número não emparelhado ou sessão expirou | Refaça o emparelhamento via `/pairing-code` |
| `dispatched: 0, failed: N` | Sessão desconectada no momento do envio | Verifique `/whatsapp-session/status` e reconecte |
| Código de emparelhamento não aparece | Socket ainda inicializando | Aguarde 5s e chame `/pairing-code` novamente |
| Relatório sem métricas (mensagem de aviso) | Sem conta de anúncio cadastrada ou token inválido | Cadastre a conta via `POST /ad-accounts` |

---

## Endpoints de referência rápida

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/whatsapp-session/status` | Status da sessão e código QR |
| `GET` | `/whatsapp-session/pairing-code` | Gera código de emparelhamento por número |
| `GET` | `/whatsapp-session/groups` | Lista grupos que o número participa |
| `POST` | `/whatsapp-groups` | Cadastra grupo de um cliente |
| `GET` | `/whatsapp-groups?clientId=` | Lista grupos de um cliente |
| `PATCH` | `/whatsapp-groups/:id` | Atualiza label ou desativa grupo |
| `DELETE` | `/whatsapp-groups/:id` | Remove grupo (soft delete) |
| `POST` | `/report-dispatches/trigger` | Dispara relatório manualmente |
| `GET` | `/report-dispatches?clientId=` | Histórico de envios |
