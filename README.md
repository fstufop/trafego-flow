# Plataforma de respostas

Um dos grandes gargalos dos clientes que começam a fazer tráfego pago é a capacidade de responder o volume de mensagens recebidas devido ao aumento de interações que o tráfego pago gera. Pensando nisso, esta plataforma tem o objetivo de automatizar o contato inicial com estes clientes afim de captar e filtrar os clientes de acordo com sua intenção.

## Desenho técnico inicial

### Fluxo de API

```mermaid
graph TD
    subgraph Meta_Platforms [Plataformas Meta]
        WA[WhatsApp Cloud API]
        IG[Instagram Graph API]
    end

    subgraph Your_Backend [Nossa Plataforma - Node]
        WH[Webhook Receiver]
        Parser[Message Parser & Tenant Router]
        Logic[Bot Logic / NLP Engine]
        TokenMgmt[Token Manager & Encryptor]
    end

    subgraph Database [Persistência]
        DB[(PostgreSQL / Redis)]
    end

    subgraph External_Services [Serviços Externos]
        AI[OpenAI / Dialogflow]
        CRM[CRM API - Pipedrive/HubSpot]
    end

    WA -->|Webhook Event| WH
    IG -->|Webhook Event| WH
    WH --> Parser
    Parser -->|Identify Tenant| TokenMgmt
    TokenMgmt <--> DB
    Parser --> Logic
    Logic <--> AI
    Logic -->|Qualified Lead| CRM
    Logic -->|Automated Reply| WA
    Logic -->|Automated Reply| IG
```

### Fluxo de recebimento de mensagens

```mermaid
sequenceDiagram
    participant U as Usuário Final
    participant M as Meta (WA/IG)
    participant B as Nossa plataforma
    participant D as Banco de Dados
    participant AI as IA (Triagem)
    participant C as CRM do Cliente

    U->>M: Envia Mensagem
    M->>B: POST Webhook (JSON)
    B->>D: Busca Cliente por recipient_id / phone_id
    D-->>B: Retorna Configurações e Token (Criptografado)
    B->>AI: Processa intenção da mensagem
    AI-->>B: Retorna Status (Qualificado/Não Qualificado)
    
    alt É Lead Qualificado
        B->>C: Create Lead / Deal via API
        B->>M: Envia Confirmação: "Um consultor irá te chamar"
    else Não Qualificado / Triagem em andamento
        B->>M: Envia Pergunta de Filtro (Bot)
    end
```

### Estrutura de dados:

```mermaid
erDiagram
    CLIENT ||--o{ INTEGRATION : "possui"
    CLIENT ||--o{ LEAD : "gera"
    INTEGRATION ||--o{ CONVERSATION : "registra"
    
    CLIENT {
        uuid id PK
        string name
        string email
        timestamp created_at
    }

    INTEGRATION {
        uuid id PK
        uuid client_id FK
        string platform "whatsapp | instagram"
        string external_id "Page ID ou Phone ID"
        text access_token "Encrypted"
        timestamp expires_at
    }

    CONVERSATION {
        uuid id PK
        uuid integration_id FK
        string remote_user_id "ID do usuário no IG/WA"
        string last_state "Aguardando Triagem | Finalizado"
        timestamp updated_at
    }

    LEAD {
        uuid id PK
        uuid client_id FK
        string name
        string phone_email
        jsonb metadata "Dados da triagem"
    }
```

