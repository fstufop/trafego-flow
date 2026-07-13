# Atualização do relatório "Tribo Rosa" + thumbnails de anúncios

Data: 2026-07-11/12

## Objetivo

Atualizar o dashboard do Looker Studio ("Tribo Rosa - Relatório") com os dados mais recentes e adicionar, na tabela "Top 4 Criativos", uma forma de visualizar o anúncio (foto/vídeo) a partir do link do Instagram e/ou de uma thumbnail.

## O que foi feito

### 1. Fonte das thumbnails

O projeto `trafegoflow` não expõe thumbnail/link do criativo no endpoint de export de CSV (`campaign-reports/insights/export/csv`) — esse endpoint só traz métricas de Insights (`date_start, ad_name, reach, impressions, spend, link_clicks, messaging_conversations_started`), sem dados de criativo.

Para obter `thumbnail_url` e `instagram_permalink_url`, foi feita uma consulta direta à Meta Graph API (`/act_.../ads` com `fields=creative{thumbnail_url,instagram_permalink_url,...}`), usando o token do sistema já configurado no `.env` do projeto. Essa consulta trouxe as 29 combinações únicas de nome de anúncio → thumbnail + link do Instagram.

### 2. Planilha "Tribo Rosa - Dados"

- Foi criada uma nova aba **"Thumbnails"** com 3 colunas: `Ad Name | Thumbnail URL | Instagram Link` (29 linhas, uma por anúncio único).
- Na aba **"Criativo"**, foram adicionadas duas colunas com fórmulas `PROCV` (VLOOKUP) que buscam o nome do anúncio na aba Thumbnails:
  - Coluna **H – Link Instagram**: `=SEERRO(PROCV($B<linha>;Thumbnails!$A:$C;3;FALSO);"")`
  - Coluna **I – Thumbnail**: `=SEERRO(PROCV($B<linha>;Thumbnails!$A:$C;2;FALSO);"")`
- As fórmulas foram preenchidas até a linha 3000, bem além dos dados atuais (~970 linhas), para que novas linhas adicionadas automaticamente pelo processo de exportação continuem populadas sem precisar de intervenção manual.

**Atenção:** existe um processo automatizado (o pipeline de exportação do trafegoFlow, rodando pela conta do Laércio) que reescreve periodicamente as colunas **A a G** da aba Criativo (e adiciona novas linhas diárias). Por isso, os links e a thumbnail foram colocados nas colunas **H e I**, fora dessa faixa, para não serem apagados no próximo sync. Colunas A–G não devem ser editadas manualmente.

Durante o processo, uma primeira tentativa colocou a fórmula da thumbnail na própria coluna G, que na verdade já continha a métrica "Messaging Conversations Started" (Mensagens) — isso sobrescreveu dados de produção. O erro foi identificado (o card "Mensagens" no Looker Studio parou de funcionar) e corrigido recuperando os dados originais do histórico de versões da planilha (Google Sheets → Histórico de versões → cópia da versão anterior ao erro), sem reverter o arquivo inteiro. Depois disso as fórmulas foram movidas definitivamente para H e I.

### 3. Looker Studio

- Fonte de dados "Tribo Rosa - Dados - Criativo": schema atualizado ("Atualizar campos") para reconhecer as novas colunas.
- Campo "Link Instagram": tipo URL, clicável.
- Campo "Thumbnail": testado como tipo **Imagem**, mas o Looker Studio não conseguiu carregar as URLs do CDN do Meta (`scontent...fbcdn.net`) dentro do iframe do relatório — confirmado via inspeção de rede que nenhuma requisição de imagem chegou a ser feita. Por isso, o campo foi mantido como **URL clicável** (mesmo tratamento do Link Instagram), que funciona de forma confiável.
- A tabela "Top 4 Criativos" apresentou um erro de "configuração do conjunto de dados / ordem da coluna alterada" depois da primeira tentativa (ligado ao campo Thumbnail antigo, que ficou com uma referência de coluna desatualizada). Resolvido removendo e recriando o campo "Thumbnail" na fonte de dados e reatualizando o schema.

### Resultado atual

Na tabela "Top 4 Criativos", cada linha tem uma coluna "Thumbnail" e uma "Link Instagram" clicáveis — ao clicar, o usuário abre a foto/vídeo do anúncio (via CDN do Meta ou via o post do Instagram). A visualização inline da imagem (miniatura dentro da célula) não foi possível devido à restrição do Looker Studio em carregar as URLs assinadas do Meta.

## Pendências / recomendações

- **Cópia temporária da planilha** ("Cópia de Tribo Rosa - Dados - 11 de julho, 00:05") criada no Drive durante a recuperação de dados — pode ser apagada quando não for mais necessária (fica a critério do usuário).
- O ideal a médio prazo é o próprio pipeline de exportação do trafegoFlow já trazer `thumbnail_url` e `instagram_permalink_url` como colunas do CSV de "criativo" (hoje ele só busca dados de Insights, não de Creative). Isso eliminaria a necessidade do PROCV manual e da aba auxiliar "Thumbnails".
- As colunas H e I têm fórmulas pré-preenchidas até a linha 3000 — se o histórico ultrapassar esse limite, será necessário estender novamente.
