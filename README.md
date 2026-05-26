### Plataforma de respostas

Um dos grandes gargalos dos clientes que começam a fazer tráfego pago é a capacidade de responder o volume de mensagens recebidas devido ao aumento de interações que o tráfego pago gera. Pensando nisso, esta plataforma tem o objetivo de automatizar o contato inicial com estes clientes afim de captar e filtrar os clientes de acordo com sua intenção.

### Desenho técnico inicial

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