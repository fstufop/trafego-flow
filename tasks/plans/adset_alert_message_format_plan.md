# Plano de Implementação: Melhoria no Formato da Mensagem de Alerta de Adsets

**Spec:** `docs/superpowers/specs/2026-08-11-adset-alert-message-format-design.md`
**Data:** 2026-08-11

---

## Análise de Alternativas

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| A (Escolhida) | Ordenar e formatar dentro do próprio `formatMessage()` | Sem mudança de contrato, sem nova camada, fácil de testar | Nenhum |
| B | Ordenar no `runForJob()` antes de montar o bucket | Separação de responsabilidades mais explícita | Mudança maior, afeta dados no snapshot, sem benefício real |

**Decisão:** Alternativa A — a ordenação é uma decisão de apresentação, logo pertence ao método de formatação. Zero impacto no fluxo de coleta de dados.

---

## Recursos Reutilizáveis Identificados

Nenhum recurso de `src/common/` aplicável — a mudança é cirúrgica dentro do service.

---

## Diagrama de Fluxo (sem alteração)

```
AdsetAlertScheduler (cron 7:30 AM SP)
    ↓
AdsetAlertsService.triggerAll()
    ↓ para cada AlertJob ativo
AdsetAlertsService.runForJob()
    ↓ coleta adsets e ROAS por cliente
formatMessage(clientBuckets, errors)   ← MUDANÇA AQUI
    ↓
WhatsAppSessionService.sendMessage(groupJid, message)
```

---

## Tarefas

### Tarefa 1 — Atualizar `formatMessage()` no service

**Arquivo:** `src/modules/adset-alerts/adset-alerts.service.ts`

**O que fazer:**

1. Ordenar o array `adsets` antes de iterar:
   ```ts
   const sorted = [...adsets].sort((a, b) => {
     if (a.roas === null && b.roas === null) return 0;
     if (a.roas === null) return 1;   // null vai ao final
     if (b.roas === null) return -1;
     return a.roas - b.roas;          // crescente
   });
   ```

2. Emitir cabeçalho uma vez por bloco de cliente:
   ```ts
   lines.push('📋 *Conjunto de anúncios* | 📈 *ROAS* | 🗓 *Última atualização*');
   ```

3. Alterar linha de adset para somente valores:
   ```ts
   lines.push(`${adset.adsetName} | ${roas} | ${date}`);
   ```

**Depende de:** nada
**Testável:** `npm run test -- --testPathPattern=adset-alerts.service`

---

### Tarefa 2 — Atualizar testes unitários do `formatMessage()`

**Arquivo:** `src/modules/adset-alerts/adset-alerts.service.spec.ts`

**O que fazer:**

| Teste | Ação |
|---|---|
| `'formats clients and adsets with bold WhatsApp syntax'` | Verificar cabeçalho com emojis; verificar linhas de valor sem rótulos; verificar ordenação (Prospecting 1.87 antes de Retargeting 3.42) |
| `'displays – when ROAS is null'` | Trocar `toContain('*ROAS*: –')` por `toContain('– |')` ou verificar linha de valor contendo `–` |
| `'formats date as DD/MM/YYYY'` | `toContain('09/01/2026')` continua válido — sem mudança necessária |
| `'appends error footer when there are errors'` | Sem alteração |
| `'omits error footer when there are no errors'` | Sem alteração |
| `'skips clients with no adsets'` | Sem alteração |
| **NOVO** `'sorts adsets by ROAS ascending, nulls last'` | Montar bucket com adsets fora de ordem (null, 5.0, 1.5) e verificar que a saída os exibe na ordem: 1.5, 5.0, null |

**Depende de:** Tarefa 1
**Testável:** `npm run test -- --testPathPattern=adset-alerts.service`

---

## Estimativa

| Tarefa | Complexidade | Estimativa |
|---|---|---|
| 1 — Atualizar `formatMessage()` | Baixa | 15 min |
| 2 — Atualizar testes | Baixa | 20 min |
| **Total** | | **~35 min** |

---

## Riscos e Dependências

- Nenhum risco técnico identificado — mudança 100% contida em `formatMessage()`.
- Sem novas dependências de pacotes.
- Os testes e2e não cobrem `formatMessage()` diretamente — apenas os testes unitários precisam de atualização.
