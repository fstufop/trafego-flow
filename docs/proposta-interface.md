# Proposta de interface

# Proposta de interface para gerenciamento de clientes e geração de relatórios

## 🚀 Visão Geral

O objetivo principal deste projeto é criar uma interface web completa que permita o gerenciamento eficiente de clientes e a automação da geração e distribuição de relatórios de performance de mídia paga. A plataforma será dividida em três pilares principais:

1.  **Gerenciamento de Clientes** - CRUD completo, segmentação e acompanhamento de performance
2.  **Geração e Distribuição de Relatórios** - Automação de geração, personalização e envio por WhatsApp
3.  **Análise de Performance** - Dashboards interativos e métricas em tempo real

## 📊 Estrutura da Aplicação

### 1. Gerenciamento de Clientes

#### 1.1. Tela de Clientes
-   **Listagem:** Tabela com todos os clientes cadastrados
    -   Campos: Nome, E-mail, Telefone, Status, Data de Cadastro, Valor da mensalidade, pagamento
    -   Filtros: Status (Ativo, Inativo), Ticket Médio, Data de Cadastro
    -   Busca: Pesquisa por nome, e-mail ou telefone
    -   Ações: Ver detalhes, Editar, Desativar/Ativar, Visualizar relatórios

#### 1.2. Cadastro/Edição de Cliente
-   **Formulário:**
    -   Nome completo
    -   Email
    -   Telefone (com DDD)
    -   Endereço (opcional)
    -   Responsável (nome e cargo)
    -   Data de cadastro (padrão hoje)
    -   Status (Ativo/Inativo)
    -   Tipo de cliente (B2B/B2C)
    -   Valor da mensalidade
    -   Pagamento (Pix, Boleto, Débito)
    -   Data de pagamento
    -   Status do pagamento (Pago, Pendente, Atrasado)
    -   Código grupo whatsapp
    -   Pasta Google Drive - Ver /Users/filipesteodoro/Github/upload-midias/

-   **Configurações da Conta:**
    -   Conta do Meta Ads vinculada
    -   Contas de Google Ads vinculadas
    -   Pixel configurado
    -   Modelo de relatório (Resumo, Detalhado, Personalizado)
    -   Horário de envio de relatórios
    -   Template de mensagem do WhatsApp

#### 1.3. Perfil do Cliente
-   **Visão Geral:**
    -   Resumo da performance nos últimos 30 dias
    -   Ticket médio mensal
    -   Valor total investido
    -   Taxa de conversão
-   **Histórico de Relatórios:**
    -   Lista de todos os relatórios gerados
    -   Status (Enviado, Erro, Pendente)
    -   Data de envio
    -   Preview do relatório
    -   Opção de reenviar
-   **Contas Vinculadas:**
    -   Lista de contas Meta e Google Ads
    -   Status de conexão
    -   Data de última sincronização
    -   Botão para reconectar

### 2. Geração e Distribuição de Relatórios

#### 2.1. Agendamento de Relatórios
-   **Tela Principal:**
    -   Lista de agendamentos ativos
    -   Frequência (Diário, Semanal, Quinzenal, Mensal)
    -   Dia da semana/dia do mês
    -   Horário de envio
    -   Clientes incluídos
    -   Template utilizado
    -   Ações: Editar, Pausar, Cancelar, Ver logs

#### 2.2. Novo Agendamento
-   **Passo 1 - Seleção de Clientes:**
    -   Selecionar clientes individualmente
    -   Selecionar grupo de clientes
    -   Opção "Selecionar todos os clientes"

-   **Passo 2 - Configuração:**
    -   **Frequência:**
        -   Diário (selecionar horário)
        -   Semanal (selecionar dia da semana)
        -   Quinzenal (selecionar dia do mês)
        -   Mensal (selecionar dia do mês)
    -   **Horário de Envio:**
        -   Dropdown com horários disponíveis
        -   Fuso horário
    -   **Template:**
        -   Selecionar template pré-definido
        -   Visualizar preview do template
        -   Opção "Criar template"
    -   **Período de Referência:**
        -   Último dia completo
        -   Últimos 7 dias
        -   Últimos 30 dias
        -   Período personalizado

-   **Passo 3 - Revisão:**
    -   Resumo do agendamento
    -   Lista de clientes com configuração
    -   Preview do primeiro relatório
    -   Botão "Salvar"

#### 2.3. Gerenciamento de Templates
-   **Listagem:** Tabela com todos os templates
    -   Nome, Descrição, Status, Data de criação
-   **Editor de Template:**
    -   **Modelo:**
        -   Resumo (métricas principais)
        -   Detalhado (todas as métricas)
        -   Personalizado (seleção manual)
    -   **Seções:**
        -   Header (logo, data, nome do cliente)
        -   Visão Geral (investimento total, CPA, ROAS)
        -   Meta Ads (campanhas, públicos, performance)
        -   Google Ads (campanhas, palavras-chave, performance)
        -   Resultados (conversões, leads, vendas)
        -   Recomendações
    -   **Personalização:**
        -   Inserir variáveis ({{client_name}}, {{period}}, {{total_invested}}, etc.)
        -   Formatação de valores (R$, %, número)
        -   Emojis personalizáveis
        -   Opções de layout (vertical, horizontal, tabular)

#### 2.4. Logs de Relatórios
-   **Histórico:** Tabela com todos os relatórios enviados
    -   Data/Hora, Cliente, Status, Tipo, Período
-   **Detalhes do Log:**
    -   Preview completo do relatório
    -   Dados brutos utilizados
    -   ID da mensagem no WhatsApp
    -   Status de entrega
-   **Ações:**
    -   Reenviar relatório
    -   Corrigir erro (se possível)
    -   Exportar dados

### 3. Análise de Performance

#### 3.1. Dashboard Geral
-   **KPIs Principais:**
    -   Total de Clientes: {{count}}
    -   Total Investido (mês): R$ {{total_invested}}
    -   CPA Médio: R$ {{avg_cpa}}
    -   ROAS Médio: {{avg_roas}}
    -   Conversões Totais: {{total_conversions}}
-   **Gráficos:**
    -   Investimento por canal (Meta vs Google)
    -   Evolução de conversões
    -   CPA ao longo do tempo
    -   ROAS por campanha
-   **Alertas:**
    -   Contas com conexão perdida
    -   Baixo ROAS em campanhas
    -   Aumentos súbitos no CPA

#### 3.2. Análise de Conta
-   **Seleção de Conta:**
    -   Dropdown com todas as contas vinculadas
    -   Filtro por canal (Meta)

-   **Análise Meta Ads:**
    -   Desempenho por campanha
    -   Top públicos
    -   Performance de criativos
    -   Análise de orçamento
    -   Custo por resultado

### 4. Automação e Notificações

#### 4.1. Sistema de Notificações
-   **Notificações:**
    -   Novos clientes cadastrados
    -   Contas desconectadas
    -   Falhas na geração de relatórios
    -   Sucessos na geração de relatórios
    -   Erros de autenticação