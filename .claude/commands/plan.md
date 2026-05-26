Você é um engenheiro backend sênior especializado em NestJS. Sua tarefa é gerar um **plano de implementação detalhado** baseado na especificação fornecida.

**Spec ou feature:** $ARGUMENTS

## O que fazer

1. Leia o arquivo de spec indicado em `tasks/specs/`. Se não indicado, procure o mais recente.
2. Analise o codebase para entender o que já existe:
   - `src/modules/` — módulos existentes como referência de padrão
   - `src/common/` — guards, decorators, pipes e interceptors reutilizáveis
   - `src/config/` — configurações de banco, redis e variáveis de ambiente
   - `src/app.module.ts` — módulos já registrados
3. Identifique alternativas técnicas e escolha a melhor com justificativa.
4. Gere e **salve** o plano em `tasks/plans/[nome_feature]_plan.md`.

## Formato do arquivo de plano

```markdown
# Plano de Implementação: [Nome da Feature]

**Spec:** `tasks/specs/[nome]_spec.md`
**Data:** [data atual]

## Análise de Alternativas

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| A (Escolhida) | ... | ... | ... |
| B | ... | ... | ... |

**Decisão:** Alternativa A — [justificativa em 1-2 frases]

## Recursos Reutilizáveis Identificados
Liste guards, pipes, decorators ou services de `src/common/` que podem ser aproveitados.

## Diagrama de Fluxo

```
HTTP/Webhook Request
    ↓ Guard (autenticação / verificação de assinatura)
[Nome]Controller
    ↓ DTO (ValidationPipe)
[Nome]Service
    ↓ Redis (cache hit?) → retorna direto
    ↓ [Nome]Repository → PostgreSQL
    ↓ Evento / Resposta
```

## Tarefas Sequenciais

### Tarefa 1 — [Entity] Definir entidade TypeORM
**Arquivo:** `src/modules/[nome]/entities/[nome].entity.ts`
**O que fazer:** Criar entity com campos definidos na spec, incluindo `tenantId`, `createdAt`, `updatedAt`
**Depende de:** nada
**Testável:** migration gerada sem erro (`npm run migration:generate`)

### Tarefa 2 — [Interface + DTOs] Definir contratos
**Arquivos:**
- `src/modules/[nome]/interfaces/[nome].interface.ts` — interface `I[Nome]Service`
- `src/modules/[nome]/dto/create-[nome].dto.ts`
- `src/modules/[nome]/dto/update-[nome].dto.ts`
**O que fazer:** Definir interface do service e DTOs com validações `class-validator`
**Depende de:** nada (paralelo com Tarefa 1)
**Testável:** compilação sem erro

### Tarefa 3 — [Service] Implementar lógica de negócio
**Arquivo:** `src/modules/[nome]/[nome].service.ts`
**O que fazer:** Implementar `I[Nome]Service` com acesso ao repositório TypeORM e cache Redis onde especificado
**Depende de:** Tarefas 1 e 2
**Testável:** testes unitários com mock do repositório

### Tarefa 4 — [Controller] Implementar endpoints
**Arquivo:** `src/modules/[nome]/[nome].controller.ts`
**O que fazer:** Criar controller com rotas da spec, aplicar guards e `ValidationPipe` nos DTOs
**Depende de:** Tarefa 3
**Testável:** testes e2e com supertest

### Tarefa 5 — [Module] Registrar e conectar
**Arquivo:** `src/modules/[nome]/[nome].module.ts`
**O que fazer:** Criar module importando TypeORM, Redis e demais dependências; exportar service se necessário
**Depende de:** Tarefas 3 e 4
**Testável:** `npm run start:dev` sem erros de injeção

### Tarefa 6 — [App] Registrar módulo na aplicação
**Arquivo:** `src/app.module.ts`
**O que fazer:** Importar `[Nome]Module`
**Depende de:** Tarefa 5
**Testável:** `npm run start:dev` sobe sem erro

### Tarefa 7 — [Testes] Escrever testes unitários do Service
**Arquivo:** `src/modules/[nome]/[nome].service.spec.ts`
**O que fazer:** Testar service com repositório mockado — cenários de sucesso, não encontrado e erro de banco
**Depende de:** Tarefa 3
**Testável:** `npm run test`

### Tarefa 8 — [Testes] Escrever testes e2e do Controller
**Arquivo:** `test/[nome].e2e-spec.ts`
**O que fazer:** Testar endpoint principal com supertest — 200, 400, 401 e 404
**Depende de:** Tarefa 4
**Testável:** `npm run test:e2e`

## Estimativa
| Tarefa | Complexidade | Estimativa |
|---|---|---|
| 1 — Entity | Baixa | 20 min |
| 2 — Interface + DTOs | Baixa | 30 min |
| 3 — Service | Alta | 1-2h |
| 4 — Controller | Média | 45 min |
| 5 — Module | Baixa | 20 min |
| 6 — App | Baixa | 5 min |
| 7 — Testes unitários | Média | 1h |
| 8 — Testes e2e | Média | 45 min |

## Riscos e Dependências
- Liste endpoints do Meta (WhatsApp/Instagram) que precisam ser verificados
- Liste módulos NestJS que ainda precisam ser instalados
- Liste pontos de incerteza técnica (ex: estrutura do payload do webhook)
```

Após gerar o plano, apresente um **resumo** com:
- Número de tarefas e estimativa total
- Principais riscos identificados
- Pergunte se o dev quer ajustar a ordem ou abordagem antes de executar `/code`
