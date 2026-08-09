# Contexto — Tela de Alert Jobs (trafegoflow-dashboard)

Este documento descreve o contrato de API e o comportamento esperado da tela de gerenciamento de jobs de alerta no painel administrativo.

---

## O que são Alert Jobs?

Jobs de alerta são configurações que controlam quais alertas automáticos o sistema dispara toda manhã via WhatsApp para o grupo de managers. Cada job tem um tipo, um status (ativo/inativo) e uma lista de campos/métricas a exibir na mensagem.

---

## Endpoints da API

**Base URL:** `{API_BASE_URL}/alert-jobs`  
**Autenticação:** Bearer token JWT (header `Authorization: Bearer <token>`) ou API key (header `x-api-key`)

### Listar jobs

```
GET /alert-jobs
GET /alert-jobs?status=active
GET /alert-jobs?status=inactive
GET /alert-jobs?type=ADSET_INSIGHTS
```

**Resposta 200:**
```json
[
  {
    "id": "uuid",
    "type": "ADSET_INSIGHTS",
    "status": "ACTIVE",
    "clientId": null,
    "fields": ["roas", "last_updated"],
    "createdAt": "2026-08-09T10:00:00.000Z",
    "updatedAt": "2026-08-09T10:00:00.000Z"
  }
]
```

### Criar job

```
POST /alert-jobs
Content-Type: application/json

{
  "type": "ADSET_INSIGHTS",
  "status": "ACTIVE",
  "clientId": null,
  "fields": ["roas", "last_updated"]
}
```

**Resposta 201:** o job criado (mesmo formato acima)

### Atualizar job

```
PATCH /alert-jobs/:id
Content-Type: application/json

{
  "status": "INACTIVE"
}
```

Ou para atualizar fields:
```json
{
  "fields": ["roas", "last_updated", "ctr"]
}
```

**Resposta 200:** o job atualizado

### Disparar alerta manualmente

```
POST /adset-alerts/trigger
```

Sem body. Executa o mesmo fluxo do cron imediatamente (sem delay aleatório).

**Resposta 200:**
```json
{ "triggered": true }
```

---

## Enums

```typescript
enum AlertJobType {
  ADSET_INSIGHTS = 'ADSET_INSIGHTS'
}

enum AlertJobStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE'
}
```

**Campos disponíveis em `fields`:**

| Valor | Métrica exibida na mensagem |
|---|---|
| `roas` | ROAS do adset desde a última edição |
| `last_updated` | Data da última edição do adset |
| `ctr` | CTR (planejado — não disponível ainda) |
| `cpm` | CPM (planejado — não disponível ainda) |

---

## Tela esperada

### Lista de jobs (`/alert-jobs`)

Tabela com colunas:

| Coluna | Descrição |
|---|---|
| Tipo | Badge com o tipo do job (ex: "Insights de Adsets") |
| Cliente | "Todos os clientes" quando `clientId` é nulo; nome do cliente quando preenchido |
| Status | Switch toggle (ativo/inativo). Ao alternar, chama `PATCH /alert-jobs/:id` com o novo status |
| Campos | Lista das métricas configuradas (chips/tags). Clicável para editar |
| Criado em | Data de criação formatada |
| Ações | Botão "Disparar agora" (chama `POST /adset-alerts/trigger`) |

### Criar job (modal ou página separada)

Formulário com:
- **Tipo:** select com opção "Insights de Adsets" (`ADSET_INSIGHTS`)
- **Cliente:** select com lista de clientes + opção "Todos os clientes" (envia `clientId: null`)
- **Campos:** checklist de métricas (ROAS e Última atualização sempre marcados; CTR e CPM desabilitados com label "em breve")
- **Status inicial:** toggle (padrão: ativo)

### Editar campos (inline ou modal)

Checklist de métricas. Ao salvar, chama `PATCH /alert-jobs/:id` com o array `fields` atualizado.

---

## Comportamento de estado

- Toggle de status: otimista (atualiza UI imediatamente, reverte em erro)
- "Disparar agora": mostra loading no botão + toast de sucesso/erro após resposta
- Criar job: fecha modal e recarrega lista após `201`

---

## Notas para o agente

- A API já está implementada no backend NestJS — não é necessário criar mock
- O campo `clientId` aceita `null` (JSON null, não string `"null"`)
- O array `fields` pode ser enviado parcialmente no PATCH — o backend faz merge (substitui o array inteiro, não faz append)
- A tela de dashboard está em `trafegoflow-dashboard` — verifique o padrão de autenticação e chamadas de API já existente no projeto antes de implementar
