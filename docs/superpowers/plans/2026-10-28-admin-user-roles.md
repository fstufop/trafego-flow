# Roles para Usuários Internos (UserEntity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a cada `UserEntity` (conta interna da equipe, usada no `trafegoflow-dashboard`) um papel (`admin` ou `member`), e usar isso para restringir ações sensíveis — hoje qualquer conta logada pode criar outra conta (`POST /auth/users`) sem distinção nenhuma.

**Architecture:** Um enum `UserRole`, uma coluna `role` em `UserEntity`, um decorator `@Roles(...)` + `RolesGuard` reutilizável (padrão NestJS `Reflector` + metadata), compostos com o `AuthGuard`/`JwtAuthGuard` já existentes via `@UseGuards(AuthGuard, RolesGuard)`. Sem restrição por padrão: um endpoint sem `@Roles(...)` continua acessível a qualquer `role`, igual a hoje.

**Tech Stack:** NestJS 11, TypeORM, `@nestjs/jwt` — mesmo stack já usado em `src/modules/auth/`.

## Decisões já tomadas (minha responsabilidade, confirme ao revisar)

- Dois papéis por ora: `admin` (acesso total, inclusive gerenciar outras contas internas e o acesso de clients ao portal — ver `docs/superpowers/plans/2026-10-27-client-portal-backend.md`) e `member` (opera o dia a dia: clients, conversation-rules, posts, integrações, WhatsApp — tudo que não for gestão de contas).
- Contas existentes e novas contas criadas sem `role` explícito viram `admin` por padrão na migração (preserva o acesso total que todas as contas já têm hoje); a partir daí, quem cria uma conta nova escolhe o `role` explicitamente via `CreateUserDto.role` (campo obrigatório na criação, sem default silencioso — evita criar sem querer um `member` com a intenção de dar acesso total, ou vice-versa).
- Master API key (`x-api-key`) sempre passa, independente de `role` — é uma credencial de máquina, não tem `role` associado.

## Global Constraints

- Nenhum endpoint que hoje não tem checagem de `role` deve passar a exigir uma — `RolesGuard` só restringe onde `@Roles(...)` for aplicado explicitamente.
- `passwordHash` nunca é exposto (mantém `@Exclude()` já existente); `role` é exposto normalmente (não é sensível).

## Review Focus

- Token de upload (`scope: 'media-upload'`) não carrega `role` — `RolesGuard` não pode quebrar com um payload sem `role` nesse caso (na prática não acontece, porque o `AuthGuard`/`JwtAuthGuard` já rejeitam qualquer token com `scope` definido antes do `RolesGuard` rodar, mas o teste deve confirmar isso explicitamente).
- Master API key sem JWT (`request.user` indefinido) não pode cair no `ForbiddenException` do `RolesGuard` — deve passar direto.
- Conta `member` tentando `POST /auth/users` deve receber `403`, não `401` (ela está autenticada, só não autorizada).
- Migração aplicada num banco com usuários existentes não pode deixar nenhuma linha com `role` nulo (coluna `NOT NULL` com `DEFAULT 'admin'` resolve isso no próprio `ALTER TABLE`).

---

### Task 1: `UserRole`, migração, coluna na entidade, guard e decorator

**Files:**
- Create: `src/modules/auth/constants/user-role.constant.ts`
- Modify: `src/modules/auth/entities/user.entity.ts`
- Create: `src/database/migrations/1787000000000-AddRoleToUsers.ts`
- Create: `src/common/decorators/roles.decorator.ts`
- Create: `src/common/guards/roles.guard.ts`
- Test: `src/common/guards/roles.guard.spec.ts`

**Interfaces:**
- Produces:
  ```typescript
  export enum UserRole {
    ADMIN = 'admin',
    MEMBER = 'member',
  }
  export const ROLES_KEY = 'roles';
  export const Roles: (...roles: UserRole[]) => MethodDecorator & ClassDecorator;
  ```
  `RolesGuard implements CanActivate` (depende de `Reflector`, injetável via DI padrão do Nest).

- [ ] **Step 1: Criar `src/modules/auth/constants/user-role.constant.ts`** com o enum `UserRole` acima (`ADMIN = 'admin'`, `MEMBER = 'member'`).

- [ ] **Step 2: Adicionar a coluna `role` em `UserEntity`** (`src/modules/auth/entities/user.entity.ts`): `@Column({ type: 'enum', enum: UserRole, default: UserRole.ADMIN }) role: UserRole;`.

- [ ] **Step 3: Criar a migração `1787000000000-AddRoleToUsers.ts`**, seguindo o padrão de `1783000000000-CreateConversationRulesTable.ts` (que nomeia o tipo enum Postgres a partir do nome do enum TS em snake_case — `RuleType` → `rule_type_enum` — não de `<tabela>_<coluna>`): `up()` cria o tipo (`CREATE TYPE "user_role_enum" AS ENUM('admin', 'member')`) e adiciona a coluna (`ALTER TABLE "users" ADD COLUMN "role" "user_role_enum" NOT NULL DEFAULT 'admin'`); `down()` remove a coluna e depois o tipo.

- [ ] **Step 4: Escrever o teste falho do `RolesGuard`** em `src/common/guards/roles.guard.spec.ts`:
  ```typescript
  describe('RolesGuard', () => {
    it('allows when no @Roles() metadata is present', () => { /* reflector retorna undefined */ });
    it('allows when request.user is undefined (master API key path)', () => { /* @Roles(UserRole.ADMIN) presente, mas request.user indefinido */ });
    it('allows when request.user.role is in the required roles', () => { /* @Roles(UserRole.ADMIN), user.role = ADMIN */ });
    it('throws ForbiddenException when request.user.role is not in the required roles', () => { /* @Roles(UserRole.ADMIN), user.role = MEMBER */ });
  });
  ```

- [ ] **Step 5: Rodar os testes pra confirmar que falham**

Run: `npx jest --testPathPattern=roles.guard.spec`
Expected: FAIL com "Cannot find module '../guards/roles.guard'" (ou equivalente — o arquivo ainda não existe).

- [ ] **Step 6: Implementar `src/common/decorators/roles.decorator.ts`** — `export const ROLES_KEY = 'roles';` e `export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);`.

- [ ] **Step 7: Implementar `RolesGuard` em `src/common/guards/roles.guard.ts`** — injeta `Reflector`; lê `requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()])`; se `!requiredRoles?.length` retorna `true`; lê `request.user` do `RequestWithUser` (mesmo tipo de `jwt-auth.guard.ts`); se `!request.user` retorna `true` (master API key); se `requiredRoles.includes(request.user.role)` retorna `true`; senão lança `ForbiddenException('Insufficient role for this action')`.

- [ ] **Step 8: Rodar os testes pra confirmar que passam**

Run: `npx jest --testPathPattern=roles.guard.spec`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/modules/auth/constants/user-role.constant.ts src/modules/auth/entities/user.entity.ts src/database/migrations/1787000000000-AddRoleToUsers.ts src/common/decorators/roles.decorator.ts src/common/guards/roles.guard.ts src/common/guards/roles.guard.spec.ts
git commit -m "feat(auth): add UserRole, role column, and RolesGuard"
```

---

### Task 2: `role` no payload JWT, no `CreateUserDto` e no endpoint de criação de usuário

**Files:**
- Modify: `src/modules/auth/interfaces/auth-service.interface.ts`
- Modify: `src/modules/auth/dto/create-user.dto.ts`
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/auth.controller.ts`
- Test: `src/modules/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `UserRole` e `Roles`/`RolesGuard` do Task 1.
- Produces: `JwtPayload.role: UserRole` (presente em todo token de sessão normal, ausente nos tokens com `scope`), `CreateUserDto.role: UserRole` (obrigatório).

- [ ] **Step 1: Adicionar `role: UserRole` em `JwtPayload`** (`interfaces/auth-service.interface.ts`), com o mesmo comentário de hoje sobre `scope` atualizado pra deixar claro que `role` só existe em tokens de sessão normal.

- [ ] **Step 2: Adicionar `role` em `CreateUserDto`** — `@IsEnum(UserRole) role: UserRole;` (obrigatório, sem `@IsOptional()`).

- [ ] **Step 3: Escrever o teste falho em `auth.service.spec.ts`**:
  ```typescript
  it('login() includes the user role in the JWT payload', async () => {
    // usuário com role MEMBER no repositório mockado
    // assert que o payload assinado por jwtService.signAsync contém { role: UserRole.MEMBER }
  });
  it('createUser() persists the role from the DTO', async () => {
    // dto.role = UserRole.ADMIN
    // assert que repo.create foi chamado com { role: UserRole.ADMIN, ... }
  });
  ```

- [ ] **Step 4: Rodar os testes pra confirmar que falham**

Run: `npx jest --testPathPattern=auth.service.spec`
Expected: FAIL (payload/objeto criado ainda não inclui `role`)

- [ ] **Step 5: Implementar** — em `login()`, incluir `role: user.role` no `payload`; em `createUser()`, incluir `role: dto.role` no `repo.create(...)`.

- [ ] **Step 6: Aplicar `@Roles(UserRole.ADMIN)` em `POST /auth/users`** (`auth.controller.ts`): `@UseGuards(AuthGuard, RolesGuard)` (troca o `@UseGuards(AuthGuard)` atual) + `@Roles(UserRole.ADMIN)` — fecha o gap de hoje, em que qualquer conta logada pode criar outra conta.

- [ ] **Step 7: Rodar os testes pra confirmar que passam**

Run: `npx jest --testPathPattern=auth.service.spec`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/modules/auth/interfaces/auth-service.interface.ts src/modules/auth/dto/create-user.dto.ts src/modules/auth/auth.service.ts src/modules/auth/auth.controller.ts src/modules/auth/auth.service.spec.ts
git commit -m "feat(auth): require admin role to create new internal users"
```

---

### Task 3: Documentação — modelo de autorização

**Files:**
- Modify: `README.md`

**Interfaces:** nenhuma — só documentação.

- [ ] **Step 1: Adicionar uma seção `## Autenticação e autorização`** no `README.md`, cobrindo, pra quem for ler o projeto pela primeira vez: os dois tipos de credencial aceitos pelo `AuthGuard` (master API key / JWT), o papel de `scope` no JWT (tokens de sessão normal não têm `scope`; tokens de propósito único como o de upload têm um `scope` que restringe o que podem fazer — e, depois do plano de backend do portal do cliente, o `scope: 'client-portal'` segue a mesma ideia), e agora o campo `role` (`admin`/`member`) em `UserEntity`, o que cada um pode fazer hoje (só `admin` cria novas contas internas), e como estender a checagem (`@Roles(...)` + `RolesGuard`, sem efeito em endpoints que não o usam).

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document the authorization model (scopes and roles)"
```

---

## O que fica a cargo de quem for construir

- Um endpoint `PATCH /auth/users/:id` pra um admin alterar o `role` de uma conta existente não está neste plano (hoje não há endpoint de update de usuário nenhum) — fica pra quando isso virar uma necessidade real.
- Mensagens de erro customizadas por UI (o `ForbiddenException` do Nest já responde `403` com uma mensagem padrão, suficiente pro backend; a UI do dashboard decide como mostrar isso).
