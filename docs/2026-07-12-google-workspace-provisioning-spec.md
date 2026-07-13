# Spec: Provisionamento automático de planilhas + sync diário (Google Workspace)

Data: 2026-07-12
Status: proposta de arquitetura, ainda não implementada

## Objetivo

Ao cadastrar um novo cliente (tenant/ad account) no trafegoFlow, criar automaticamente a planilha de dados dele no Google Drive (a partir de um template) e manter essa planilha atualizada diariamente com os dados de Insights do Meta Ads — eliminando o processo manual/externo que hoje faz esse papel.

A cópia do relatório no Looker Studio e a troca da fonte de dados continuam sendo feitas manualmente pelo time (o Looker Studio não tem API pública para isso).

## Escopo

1. Provisionamento: copiar o template de planilha para uma pasta do cliente no Drive, no momento do cadastro.
2. Sync diário: job agendado que busca os dados do dia anterior e insere as linhas novas nas planilhas de todos os clientes ativos.
3. Fora de escopo (por enquanto): automação do Looker Studio, backfill histórico automatizado, UI de administração.

## Pré-requisitos / infraestrutura

### Service Account do Google

- Criar uma Service Account no Google Cloud (projeto separado ou o mesmo do Meta App, tanto faz).
- Habilitar **Drive API** e **Sheets API** no projeto.
- Duas opções de acesso aos arquivos do cliente:
  - **Shared Drive (recomendado)**: a Service Account é adicionada como membro de um Shared Drive da organização; todos os arquivos criados por ela ficam nesse Shared Drive, sem depender de cota pessoal e sem risco de "arquivo órfão" se alguém sair da empresa.
  - **Domain-wide delegation**: só necessário se os arquivos precisarem aparecer como pertencentes a um usuário real do Workspace. Mais complexo de configurar (exige acesso de admin do Workspace); evitar se o Shared Drive resolver.
- Guardar a chave JSON da Service Account como uma variável de ambiente (`GOOGLE_SERVICE_ACCOUNT_KEY`, em base64 ou JSON stringificado), nunca commitada no repo. Seguir o mesmo padrão do `AesCryptoService` já usado para os tokens do Meta: criptografar em repouso se for persistida no banco (não deveria — fica só em env/secret manager).

### Template de planilha

- Um Google Sheet "modelo", com as abas: `Campanha`, `Idade`, `Região`, `Criativo`, `Público`.
- Na aba `Criativo`, já deixar preparado:
  - Colunas A–G: layout de export (`date_start, ad_name, reach, impressions, spend, link_clicks, messaging_conversations_started`).
  - Coluna H: fórmula de Link Instagram (ou vazio, se o campo já vier pronto do endpoint — ver seção "Nota sobre instagram_permalink_url").
  - Coluna I: fórmula de Thumbnail (mesma observação).
- Guardar o `fileId` desse template numa variável de ambiente (`SHEET_TEMPLATE_ID`).

### Nota sobre `instagram_permalink_url`

Se o endpoint de export (`campaign-reports/insights/export/csv`, nível `ad`) passar a retornar `instagram_permalink_url` diretamente, a coluna de Link Instagram deixa de precisar de PROCV/VLOOKUP — o valor já vem pronto no CSV e pode ser escrito direto na coluna correspondente do append diário. Ainda assim, a coluna de Thumbnail (imagem/URL do criativo) deve continuar em uma coluna separada e ser tratada como "melhor esforço" — ver limitação abaixo.

**Limitação conhecida**: URLs de `thumbnail_url` do Meta são assinadas e expiram (parâmetro `oe=` no final da URL). Uma thumbnail salva na planilha hoje pode retornar "URL signature mismatch" dias depois. Não depender dela para nada crítico; o Link Instagram (permalink do post) é estável e não expira.

## Modelo de dados (Postgres)

Adicionar à tabela de tenants/ad accounts (ou tabela nova `google_workspace_assets`, se preferir separar):

```sql
ALTER TABLE ad_accounts ADD COLUMN drive_folder_id VARCHAR(255);
ALTER TABLE ad_accounts ADD COLUMN spreadsheet_id VARCHAR(255);
ALTER TABLE ad_accounts ADD COLUMN last_synced_date DATE;
ALTER TABLE ad_accounts ADD COLUMN sync_status VARCHAR(50) DEFAULT 'pending'; -- pending | ok | error
ALTER TABLE ad_accounts ADD COLUMN last_sync_error TEXT;
```

`last_synced_date` é a trava de idempotência: o job diário só processa um tenant se `last_synced_date < ontem`.

## Novo módulo: `google-workspace`

Estrutura sugerida, seguindo o padrão dos módulos existentes (`campaign-reports`, `ad-accounts`):

```
src/modules/google-workspace/
  google-workspace.module.ts
  google-drive.service.ts        # wrapper fino sobre googleapis (Drive)
  google-sheets.service.ts       # wrapper fino sobre googleapis (Sheets)
  provisioning.service.ts        # cria pasta + copia template no cadastro do tenant
  daily-sync.service.ts          # job agendado, escreve as linhas do dia
  interfaces/
    sheet-tab.enum.ts            # Campanha | Idade | Regiao | Criativo | Publico
```

Dependência nova: `googleapis` (npm).

### `google-drive.service.ts`

- `createClientFolder(clientName: string): Promise<string>` — cria uma subpasta no Shared Drive, retorna `folderId`.
- `copySpreadsheetTemplate(folderId: string, clientName: string): Promise<string>` — `drive.files.copy` do `SHEET_TEMPLATE_ID` para dentro da pasta, renomeando para `"{clientName} - Dados"`. Retorna `spreadsheetId`.
- `shareWithEmail(fileId: string, email: string, role: 'writer' | 'reader')` — opcional, para dar acesso ao gestor de tráfego.

### `google-sheets.service.ts`

- `appendRows(spreadsheetId: string, tabName: SheetTab, rows: string[][]): Promise<void>` — usa `spreadsheets.values.append` com `valueInputOption: 'USER_ENTERED'` (para fórmulas funcionarem se forem escritas como string de fórmula).
- `getLastRow(spreadsheetId: string, tabName: SheetTab): Promise<number>` — usa `spreadsheets.values.get` no range da coluna A para saber a próxima linha livre (evita depender de estado local desincronizado).

### `provisioning.service.ts`

```ts
async provisionTenant(adAccountId: string, clientName: string) {
  const folderId = await this.driveService.createClientFolder(clientName);
  const spreadsheetId = await this.driveService.copySpreadsheetTemplate(folderId, clientName);
  await this.adAccountsService.update(adAccountId, {
    driveFolderId: folderId,
    spreadsheetId,
    syncStatus: 'pending',
  });
}
```

Disparado a partir do endpoint existente de criação de ad account (`AdAccountsService.create`, ou via evento `AdAccountCreatedEvent` se o projeto já usa um event bus interno — preferível a acoplar diretamente, para não travar a resposta HTTP do cadastro esperando a criação da planilha).

### `daily-sync.service.ts`

```ts
@Cron('0 6 * * *') // todo dia às 6h, horário do servidor
async syncAllTenants() {
  const tenants = await this.adAccountsService.findActiveWithSpreadsheet();
  const yesterday = subDays(new Date(), 1);

  for (const tenant of tenants) {
    if (tenant.lastSyncedDate >= yesterday) continue; // já sincronizado

    try {
      await this.syncTenantDay(tenant, yesterday);
      await this.adAccountsService.update(tenant.id, {
        lastSyncedDate: yesterday,
        syncStatus: 'ok',
        lastSyncError: null,
      });
    } catch (err) {
      await this.adAccountsService.update(tenant.id, {
        syncStatus: 'error',
        lastSyncError: err.message,
      });
      this.logger.error(`Sync falhou para tenant ${tenant.id}: ${err.message}`);
      // seguir para o próximo tenant, não interromper o loop inteiro
    }
  }
}

private async syncTenantDay(tenant: AdAccount, date: Date) {
  for (const tab of ALL_TABS) {
    const insights = await this.campaignReportsService.getInsightsForDate(tenant.adAccountId, tab, date);
    const rows = insights.map(row => this.toSheetRow(tab, row)); // inclui fórmula de H/I quando for a aba Criativo
    await this.sheetsService.appendRows(tenant.spreadsheetId, tab, rows);
  }
}
```

Pontos de atenção nessa implementação:

- **Rate limits da Sheets API**: 300 requisições/minuto por projeto e 60/minuto por usuário (a Service Account conta como "um usuário"). Com muitos tenants, processar em lote com um pequeno delay entre chamadas, ou usar fila (BullMQ) com concorrência limitada em vez de loop sequencial simples.
- **Falha parcial**: se uma aba falhar no meio do processo (ex.: Criativo deu erro depois de Campanha e Idade terem sido gravadas), decidir se o tenant fica marcado como erro mesmo assim (recomendado) para reprocessar no dia seguinte, evitando duplicar linhas já gravadas — por isso just usar `getLastRow` antes de cada append, nunca assumir a posição.
- **Fórmulas H/I na linha nova**: ao montar `rows` para a aba Criativo, incluir nas posições H e I a string da fórmula (`=SEERRO(PROCV($B{linha};Thumbnails!$A:$C;3;FALSO);"")` etc.) já com o número de linha correto, calculado a partir do `getLastRow` + 1. Isso substitui a necessidade de pré-preencher fórmulas até a linha 3000 no template.
- **Fuso horário**: os dados do Meta Insights fecham com atraso; buscar sempre o dia anterior (D-1), nunca o dia corrente, para evitar dados parciais.

## Endpoint administrativo (opcional, recomendado)

Para operação manual quando necessário:

- `POST /google-workspace/tenants/:id/provision` — dispara o provisionamento manualmente (reprocessamento, ou clientes cadastrados antes dessa feature existir).
- `POST /google-workspace/tenants/:id/sync?date=YYYY-MM-DD` — dispara o sync de um dia específico manualmente (backfill pontual, sem esperar o cron).

## Checklist de implementação

1. [ ] Criar Service Account, habilitar Drive API + Sheets API, criar Shared Drive, adicionar Service Account como membro.
2. [ ] Criar planilha template com as 5 abas e o layout de colunas combinado.
3. [ ] Adicionar `googleapis` como dependência.
4. [ ] Migração de banco: novas colunas em `ad_accounts` (ou tabela nova).
5. [ ] Implementar `google-drive.service.ts` e `google-sheets.service.ts`.
6. [ ] Implementar `provisioning.service.ts` e ligar ao fluxo de cadastro de tenant.
7. [ ] Implementar `daily-sync.service.ts` com `@nestjs/schedule`.
8. [ ] Endpoints administrativos de provisionamento/sync manual.
9. [ ] Testes unitários dos services (mockando `googleapis`).
10. [ ] Rodar em um cliente de teste ponta a ponta antes de habilitar para a base toda.
11. [ ] Documentar para o time o passo manual que continua existindo: duplicar o relatório no Looker Studio e repontar a fonte de dados para a nova planilha.

## Riscos e decisões em aberto

- Confirmar se o projeto já tem algum event bus interno para desacoplar "tenant criado" → "provisionar planilha", ou se a chamada deve ser síncrona dentro do próprio endpoint de criação (mais simples, porém mais lento para responder).
- Definir política de retry para tenants com `sync_status = 'error'` (reprocessar automaticamente no próximo cron, ou exigir ação manual via endpoint administrativo).
- Validar cota de Shared Drive da organização (limite de arquivos por Shared Drive é alto, mas vale checar se já existe um Shared Drive definido para isso).
