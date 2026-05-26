Você é um engenheiro backend sênior especializado em NestJS. Sua tarefa é **documentar ou fazer engenharia reversa** de um módulo existente no projeto trafegoflow, extraindo regras de negócio e gerando documentação estruturada.

**Módulo ou feature:** $ARGUMENTS

## O que fazer

Há dois modos de uso:

**Modo A — Documentar módulo recém-implementado** (após merge)
Execute engenharia reversa dos arquivos do módulo e gere documentação completa.

**Modo B — Entender código existente**
Mapeie o fluxo de um módulo legado/existente para entender o que ele faz.

## Passos

1. Identifique os arquivos relevantes:
   - Módulos: `src/modules/[nome]/`
   - Se um path foi fornecido, use-o diretamente
2. Leia todos os arquivos do módulo (module, controller, service, DTOs, entity, interfaces)
3. Trace o fluxo completo de dados (Request → Controller → Service → Redis/PostgreSQL → Response)
4. Extraia as regras de negócio implícitas no código
5. Gere e **salve** a documentação em `tasks/drafts/[nome_modulo]_doc.md`

## Formato da documentação gerada

```markdown
# Documentação: [Nome do Módulo]

**Data:** [data atual]
**Tipo:** Módulo Novo / Módulo Existente
**Arquivos analisados:** [lista]

## Visão Geral
[2-3 frases descrevendo o que o módulo faz e por que existe]

## Contexto Multi-tenant
- Dados isolados por tenant: [lista de campos/tabelas]
- Dados globais: [lista ou "nenhum"]

## Fluxo de Dados

```
HTTP Request / Webhook
    ↓ Guard: [nome do guard]
[Nome]Controller.[método]()
    ↓ DTO: [Nome]Dto (validação)
[Nome]Service.[método]()
    ↓ Redis.get(tenant:{tenantId}:[recurso]:{id})  ← cache hit?
    ↓ [Nome]Repository.find({ where: { tenantId } })  ← PostgreSQL
    ← Result<[Nome]Entity>
    ↓ Redis.set(...)  ← atualiza cache
← Response
```

## Regras de Negócio Identificadas

### RN-01: [Nome da Regra]
**Onde no código:** `[nome].service.ts:[linha]`
**Descrição:** [o que a regra faz]
**Condição:** [quando se aplica]

### RN-02: [Nome da Regra]
...

## Endpoints Expostos

| Método | Path | Guard | DTO | Descrição |
|--------|------|-------|-----|-----------|
| POST | `/[recurso]` | JwtAuthGuard | Create[Nome]Dto | [descrição] |
| GET | `/[recurso]/:id` | JwtAuthGuard | — | [descrição] |

## Entidade PostgreSQL

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | Identificador único |
| `tenantId` | string | Isolamento multi-tenant |
| `[campo]` | `[tipo]` | [descrição] |

## Estratégia de Cache Redis

| Chave | TTL | Quando invalida |
|-------|-----|-----------------|
| `tenant:{tenantId}:[recurso]:{id}` | [N]s | update / delete |

Se não usa cache: "Módulo sem cache Redis."

## Critérios de Aceitação (extraídos do código)

```gherkin
Feature: [Nome do Módulo]

  Scenario: [Fluxo principal]
    Given [estado inicial extraído do código]
    When [requisição ao endpoint]
    Then [resposta esperada]

  Scenario: Acesso cross-tenant bloqueado
    Given tenantId do token diferente do recurso
    When requisição ao endpoint
    Then retorna 403 ou 404
```

## Variáveis de Ambiente Necessárias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `[VAR]` | [descrição] | `[valor exemplo]` |

## Dependências Externas
- Módulos NestJS usados
- APIs externas chamadas (Meta, OpenAI, CRM)
- Outros módulos internos importados

## Pontos de Atenção / Dívida Técnica
- [algo que deveria ser melhorado]
- [comportamento não óbvio que merece comentário]
- [integração pendente]
```

Após gerar a documentação:
1. Informe o caminho do arquivo salvo
2. Destaque as **regras de negócio mais importantes** em 3-5 bullets
3. Aponte qualquer **dívida técnica ou inconsistência** encontrada no código
