Você é um engenheiro backend sênior especializado em NestJS e arquitetura orientada a módulos. Sua tarefa é gerar uma **especificação técnica completa** para o módulo ou feature descrita abaixo.

**Feature solicitada:** $ARGUMENTS

## O que fazer

1. Leia `src/app.module.ts` para entender os módulos já registrados.
2. Navegue em `src/modules/` para ver exemplos de módulos existentes e seguir o mesmo padrão.
3. Leia `src/common/` para identificar guards, decorators e pipes reutilizáveis.
4. Gere e **salve** a especificação em `tasks/specs/[nome_feature]_spec.md`.

## Formato do arquivo de especificação

```markdown
# Spec: [Nome da Feature]

## 1. Objetivo
> Por que esse módulo existe? Qual problema de negócio ele resolve?

## 2. Contexto Multi-tenant
- Quais dados são por tenant (isolados por `tenantId`)
- Quais dados são globais (compartilhados entre tenants)

## 3. Descrição Funcional
O que o módulo faz. Liste em bullets.

## 4. Estrutura de Arquivos

### Novos arquivos
- `src/modules/[nome]/[nome].module.ts`
- `src/modules/[nome]/[nome].controller.ts`
- `src/modules/[nome]/[nome].service.ts`
- `src/modules/[nome]/[nome].service.spec.ts`
- `src/modules/[nome]/dto/create-[nome].dto.ts`
- `src/modules/[nome]/dto/update-[nome].dto.ts`
- `src/modules/[nome]/entities/[nome].entity.ts`
- `src/modules/[nome]/interfaces/[nome].interface.ts`

### Arquivos modificados
- `src/app.module.ts` — importar o novo módulo

## 5. Contrato de API / Webhook

Para cada endpoint:

| Campo     | Valor                            |
|-----------|----------------------------------|
| Método    | GET / POST / PUT / DELETE        |
| Path      | `/[recurso]`                     |
| Auth      | Bearer JWT / Webhook Signature   |
| Body DTO  | `Create[Nome]Dto`                |
| Resposta  | `[Nome]Entity` / `void`         |

Se for webhook (Meta), descreva o payload esperado e o campo de verificação.

## 6. Entidade (PostgreSQL)

```typescript
// Campos esperados na entidade TypeORM
id: string (uuid)
tenantId: string
// ... campos específicos
createdAt: Date
updatedAt: Date
```

## 7. Cache (Redis)

Descreva o que deve ser cacheado, a chave e o TTL:
- Chave: `tenant:{tenantId}:[recurso]:{id}`
- TTL: [N] segundos
- Quando invalidar

Se não usa cache, indique "Sem cache para este módulo".

## 8. Interface do Service

```typescript
interface I[Nome]Service {
  // métodos do contrato — para permitir mock nos testes
}
```

## 9. DTOs e Validações

```typescript
// Create[Nome]Dto — campos obrigatórios e opcionais com class-validator
```

## 10. Critérios de Aceitação (BDD)

```gherkin
Feature: [Nome da Feature]

  Scenario: Fluxo principal com sucesso
    Given [pré-condição]
    When [ação / requisição]
    Then [resultado esperado]

  Scenario: Erro de validação
    Given [pré-condição]
    When o body é inválido
    Then retorna 400 com detalhes dos campos inválidos

  Scenario: Tenant não autorizado
    Given [pré-condição]
    When a requisição não contém token válido
    Then retorna 401
```

## 11. Definition of Done
- [ ] Module registrado em `app.module.ts`
- [ ] Controller com validação via `ValidationPipe`
- [ ] Service com interface `I[Nome]Service` para testabilidade
- [ ] Entity TypeORM com `tenantId` e timestamps
- [ ] DTOs com decorators `class-validator`
- [ ] Cache Redis implementado onde especificado
- [ ] Testes unitários do Service (mock do repositório)
- [ ] Testes e2e do endpoint principal
```

Após gerar a especificação, apresente um **resumo** com:
- Nome do arquivo salvo
- Lista dos arquivos que serão criados/modificados
- Principais critérios de aceitação
- Pergunte se o dev quer ajustar algo antes de seguir para `/plan`
