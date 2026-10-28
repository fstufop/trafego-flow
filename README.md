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


## Autenticação e autorização

Toda rota protegida passa pelo `AuthGuard`, que aceita dois tipos de credencial:

- **Master API key** (`x-api-key`): credencial de máquina para máquina (integrações e jobs). Não tem usuário associado, então não é afetada pelas checagens de papel.
- **JWT** (`Authorization: Bearer <token>`): token emitido no login, usado pelo frontend.

### `scope` no JWT

O claim `scope` define para que um token serve:

- **Tokens de sessão normal** não têm `scope`. Funcionam em qualquer rota protegida pelo `AuthGuard`.
- **Tokens de propósito único** têm um `scope` que restringe o que podem fazer. Hoje o único é `media-upload` (token de curta duração emitido por `POST /auth/upload-token` para upload direto do navegador ao backend). O `AuthGuard` rejeita qualquer token com `scope`, então esses tokens não servem para outras rotas. O `scope: 'client-portal'`, previsto no plano de backend do portal do cliente, segue a mesma ideia: um token restrito às rotas do portal.

### Papel do usuário (`role`)

`UserEntity` tem o campo `role`, com os valores `admin` ou `member`. O papel é obrigatório ao criar uma conta (`POST /auth/users`).

Permissões atuais:

| Ação | `admin` | `member` |
| --- | --- | --- |
| Criar novas contas internas (`POST /auth/users`) | Sim | Não |
| Demais rotas protegidas pelo `AuthGuard` | Sim | Sim |

A checagem de papel é opt-in: só tem efeito em endpoints que usam `@Roles(...)` com o `RolesGuard`. Em endpoints sem esses dois, o papel é ignorado.

Para restringir um endpoint a certos papéis:

```ts
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Post('exemplo')
exemplo() { ... }
```

O `RolesGuard` responde `403` quando o usuário autenticado não tem um dos papéis exigidos. Requisições autenticadas pela master API key não passam por essa checagem.

> ⚠️ O `RolesGuard` só é seguro quando executa **depois** de um guard (como o `AuthGuard`) que marque a requisição com `authMethod`/`user`; sem um usuário e sem esse marcador, ele nega por padrão. Nunca registre o `RolesGuard` como `APP_GUARD` global.
