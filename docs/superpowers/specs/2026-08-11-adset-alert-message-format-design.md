# Design: Melhoria no Formato da Mensagem de Alerta de Adsets

**Data:** 2026-08-11
**Módulo:** `src/modules/adset-alerts/`
**Arquivo alvo:** `adset-alerts.service.ts` — método `formatMessage()`

---

## Problema

O formato atual repete os rótulos das colunas em cada linha de adset:

```
*Nome do cliente*: Marca ABC

*Conjunto de anúncios*: CJ - Retargeting | *ROAS*: 3.42 | *Última atualização*: 05/08/2026
*Conjunto de anúncios*: CJ - Prospecting | *ROAS*: 1.87 | *Última atualização*: 01/08/2026
```

Isso gera ruído visual e dificulta a leitura rápida quando há vários adsets.

---

## Solução

Substituir os rótulos inline por uma linha de cabeçalho com emojis, exibida uma vez por bloco de cliente. As linhas de dados passam a conter apenas os valores. Os adsets são ordenados por ROAS crescente dentro de cada bloco.

### Formato resultante

```
*Nome do cliente*: Marca ABC

📋 *Conjunto de anúncios* | 📈 *ROAS* | 🗓 *Última atualização*
CJ - Prospecting | 1.87 | 01/08/2026
CJ - Retargeting | 3.42 | 05/08/2026

⚠️ *Erros:*
- Marca ZZZ / act_456: token expirado
```

---

## Regras de negócio

- **Cabeçalho:** uma linha por bloco de cliente, imediatamente antes dos adsets.
- **Ordenação:** adsets ordenados por `roas` crescente dentro do bloco do cliente. Adsets com `roas = null` ficam ao final do bloco.
- **Linhas de dados:** `${adsetName} | ${roas} | ${date}` — sem rótulos.
- **ROAS nulo:** continua exibido como `–`.
- **Seção de erros:** comportamento inalterado.

---

## Mudanças no código

### `formatMessage()` em `adset-alerts.service.ts`

1. Antes de iterar os adsets de um cliente, ordenar o array por `roas` crescente (nulls ao final).
2. Emitir a linha de cabeçalho `📋 *Conjunto de anúncios* | 📈 *ROAS* | 🗓 *Última atualização*` uma vez por bloco.
3. Cada linha de adset passa a ser `${adset.adsetName} | ${roas} | ${date}`.

Nenhuma outra parte do módulo é alterada.

---

## Testes

Os testes unitários existentes em `adset-alerts.service.spec.ts` que cobrem `formatMessage()` precisam ser atualizados para refletir o novo formato de saída.
