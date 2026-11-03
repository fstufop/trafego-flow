# Plano de Implementação: Senha padrão para client portal (corte temporário do e-mail)

**Spec:** combinada em conversa (brainstorming), sem arquivo em `tasks/specs/`
**Data:** 2026-10-30
**Motivo:** Mailgun está com problema; por ora o e-mail de convite/senha do client portal é cortado. Quando o Mailgun voltar, o fluxo de e-mail pode ser restaurado (este plano não apaga o código de e-mail de convite do `MailService`, só deixa de chamá-lo na criação de conta).

## Análise de Alternativas

| Alternativa | Descrição | Prós | Contras |
|---|---|---|---|
| A (Escolhida) | Senha padrão fixa (configurável via env), setada direto no `passwordHash` na criação e no reset admin; flag `mustChangePassword` força troca; novo endpoint de troca autenticada | Sem dependência do Mailgun; simples de reverter (git) quando o e-mail voltar; reaproveita 100% do fluxo de `forgot-password` existente, que não é tocado | Cliente recebe a senha "fora de banda" (WhatsApp manual) — processo manual do admin |
| B | Gerar senha aleatória por cliente na criação, devolver no response da API pra admin copiar | Mais seguro (sem senha repetida entre tenants) | Mais mudança de contrato de API, mais fricção para o fluxo "por ora"; usuário já definiu que quer senha fixa |
| C | Manter `passwordHash: null` e token de convite, só trocando o canal de envio (ex: mostrar o link na tela do admin em vez de e-mail) | Reaproveita 100% da lógica de token existente | Não é o que foi pedido — usuário quer senha padrão pronta, não um link de definição |

**Decisão:** Alternativa A — já validada e aprovada em conversa com o usuário; minimiza mudança de contrato e é trivialmente reversível.

## Recursos Reutilizáveis Identificados
- `ConfigModule` / `registerAs` (`src/config/mailgun.config.ts` como referência) — novo namespace `clientPortal` para a senha padrão.
- `ClientPortalAuthGuard` (`src/common/guards/client-portal-auth.guard.ts`) — protege o novo endpoint de troca de senha; já popula `request.user` com `JwtPayload { sub, clientId, scope }`.
- `AuthGuard` + `RolesGuard` + `@Roles(UserRole.ADMIN)` — já protegem as rotas admin (`createAccount`, `resendInvite`), reaproveitados tal qual no endpoint renomeado de reset.
- `BCRYPT_ROUNDS = 12` (const local em `client-portal-auth.service.ts:29`) — reaproveitado nos novos métodos do service; a migration precisa do próprio literal `12` (não há export compartilhado).
- `ResetPasswordDto` (`dto/reset-password.dto.ts`) como modelo de validação (`MinLength(8)`, `MaxLength(72)`) para o `newPassword` do novo `ChangePasswordDto`.
- Padrão `me()` do controller (checagem de `payload.scope !== CLIENT_PORTAL_SCOPE`) — reaproveitado no novo endpoint de troca de senha para rejeitar chamadas feitas com API key mestre ou JWT admin puro.

## Diagrama de Fluxo

```
Criação de conta (admin)
POST /auth/client-portal-users
    ↓ AuthGuard + RolesGuard(ADMIN)
ClientPortalAuthController.createAccount
    ↓ ClientPortalAuthService.createAccount
    ↓ passwordHash = bcrypt(senhaPadrao) | mustChangePassword = true
    ↓ save (sem e-mail)

Reset manual (admin)
POST /auth/client-portal-users/:id/reset-password
    ↓ AuthGuard + RolesGuard(ADMIN)
ClientPortalAuthController.resetPassword
    ↓ ClientPortalAuthService.resetToDefaultPassword
    ↓ passwordHash = bcrypt(senhaPadrao) | mustChangePassword = true | limpa tokens de reset
    ↓ save (sem e-mail)

Troca de senha (cliente logado)
POST /auth/client-change-password
    ↓ ClientPortalAuthGuard (scope client-portal)
ClientPortalAuthController.changePassword
    ↓ ClientPortalAuthService.changePassword
    ↓ bcrypt.compare(oldPassword) → 401 se inválida
    ↓ passwordHash = bcrypt(newPassword) | mustChangePassword = false
    ↓ save

Login / me — inalterados na lógica, só passam a expor mustChangePassword no payload de resposta
```

## Tarefas Sequenciais

### Tarefa 1 — Config da senha padrão
**Arquivos:**
- `src/config/client-portal.config.ts` (novo) — `registerAs('clientPortal', () => ({ defaultPassword: process.env.CLIENT_PORTAL_DEFAULT_PASSWORD ?? 'Trafego@2026' }))`
- `src/config/configuration.ts` — adicionar ao array `configLoads` e ao `Joi.object`: `CLIENT_PORTAL_DEFAULT_PASSWORD: Joi.string().default('Trafego@2026')`
- `.env.example` — nova seção, seguindo o estilo em português já usado para Mailgun:
  ```
  # Senha padrão atribuída a novas contas do client portal (envio de e-mail está pausado por ora)
  CLIENT_PORTAL_DEFAULT_PASSWORD=Trafego@2026
  ```
**Depende de:** nada
**Testável:** `npm run start:dev` sobe sem erro de validação do Joi

### Tarefa 2 — Entity: campo `mustChangePassword`
**Arquivo:** `src/modules/auth/entities/client-portal-user.entity.ts`
**O que fazer:** adicionar `@Column({ name: 'must_change_password', default: false }) mustChangePassword: boolean;` — **sem** `@Exclude()`, pois precisa ser exposto no login/me.
**Depende de:** nada
**Testável:** compila sem erro

### Tarefa 3 — Migration
**Arquivo:** `src/database/migrations/1789000000000-AddMustChangePasswordToClientPortalUsers.ts`
**O que fazer:**
- `up()`: `ALTER TABLE "client_portal_users" ADD COLUMN "must_change_password" boolean NOT NULL DEFAULT false`; depois, calcular `const hash = await bcrypt.hash(process.env.CLIENT_PORTAL_DEFAULT_PASSWORD ?? 'Trafego@2026', 12)` e rodar `UPDATE "client_portal_users" SET "password_hash" = $1, "must_change_password" = true WHERE "password_hash" IS NULL` (parametrizado, conta pendentes de convite herdam a senha padrão).
- `down()`: `ALTER TABLE "client_portal_users" DROP COLUMN "must_change_password"` (não reverte o backfill de senha — é dado, não schema).
**Depende de:** Tarefa 2 (schema deve bater com a entity)
**Testável:** `npm run migration` roda limpo contra o banco local; `npm run migration:revert` desfaz o schema

### Tarefa 4 — DTO de troca de senha
**Arquivo:** `src/modules/auth/dto/change-password.dto.ts` (novo)
**O que fazer:** `oldPassword: string` (`@IsString() @IsNotEmpty()`) e `newPassword: string` (`@IsString() @MinLength(8) @MaxLength(72)`), mesmo estilo de `@ApiProperty` do `ResetPasswordDto`.
**Depende de:** nada
**Testável:** compila sem erro

### Tarefa 5 — Service: `createAccount`, `resetToDefaultPassword`, `changePassword`, `login`
**Arquivo:** `src/modules/auth/client-portal-auth.service.ts`
**O que fazer:**
- `createAccount` (linhas 78-118 hoje): trocar `passwordHash: null` por `passwordHash: await bcrypt.hash(this.config.get('clientPortal.defaultPassword'), BCRYPT_ROUNDS)` e setar `mustChangePassword: true`; remover as chamadas a `generateAndStoreToken`/`sendInviteEmail` (linhas 114-115) desse fluxo — **não mexer** nessas funções, pois `forgotPassword` ainda as usa.
- Renomear `resendInvite` (120-128) → `resetToDefaultPassword(id)`: busca o usuário (404 se não existir, igual hoje), seta `passwordHash` = hash da senha padrão, `mustChangePassword = true`, `passwordResetTokenHash = null`, `passwordResetExpiresAt = null`, salva — sem chamar `sendInviteEmail`.
- Novo método `changePassword(userId: string, dto: ChangePasswordDto)`: busca por id, `bcrypt.compare(dto.oldPassword, user.passwordHash)` — se falso, `throw new UnauthorizedException(...)` (mesmo tipo de erro usado em `login` para credencial inválida); se verdadeiro, `passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS)`, `mustChangePassword = false`, salva.
- `login` (169-210): incluir `mustChangePassword: user.mustChangePassword` no `ClientPortalLoginResult` (interface nas linhas 31-35) e no objeto retornado.
**Depende de:** Tarefas 1, 2, 4
**Testável:** `npx jest --testPathPattern=client-portal-auth.service.spec` (atualizar/estender os specs existentes para os cenários novos e renomeados)

### Tarefa 6 — Controller: rotas
**Arquivo:** `src/modules/auth/client-portal-auth.controller.ts`
**O que fazer:**
- `createAccount` (45-56): atualizar `@ApiOperation summary` (não envia mais e-mail).
- Rota `resend-invite` (98-109): renomear path para `client-portal-users/:id/reset-password`, método `resetPassword(id)` chamando `clientPortalAuthService.resetToDefaultPassword(id)`, `@ApiOperation({ summary: 'Reset a client portal user password to the default password' })`. Mantém `AuthGuard, RolesGuard, Roles(ADMIN), HttpCode(204), ApiBearerAuth, ApiSecurity('x-api-key')`.
- Novo endpoint `POST /auth/client-change-password`: `@UseGuards(ClientPortalAuthGuard)`, `@CurrentUser() payload: JwtPayload`, replica a checagem de `payload.scope !== CLIENT_PORTAL_SCOPE` usada em `me()` (151-155) para rejeitar API key mestre/JWT admin puro, body `ChangePasswordDto`, chama `clientPortalAuthService.changePassword(payload.sub, dto)`, `@HttpCode(HttpStatus.NO_CONTENT)`.
- `me()` (137-160): incluir `mustChangePassword` no objeto de resposta.
**Depende de:** Tarefa 5
**Testável:** `npm run test:e2e` cobrindo as 3 rotas tocadas

### Tarefa 7 — Atualizar/estender testes existentes
**Arquivos:** `src/modules/auth/client-portal-auth.service.spec.ts` e/ou `*.controller.spec.ts` (se existirem — confirmar antes de criar novos)
**O que fazer:** atualizar os testes que cobrem `createAccount`/`resendInvite` para o novo comportamento (sem e-mail, senha padrão), adicionar casos para `changePassword` (sucesso, senha antiga errada) e para `mustChangePassword` aparecer em `login`/`me`.
**Depende de:** Tarefas 5 e 6
**Testável:** `npm run test` e `npm run test:e2e`

---

### Tarefa 8 — Dashboard: hook de mutation
**Repo/Arquivo:** `trafegoflow-dashboard/hooks/use-client-portal-access.ts`
**O que fazer:** renomear `useResendClientPortalInvite` → `useResetClientPortalPassword`, apontando para `POST /auth/client-portal-users/${id}/reset-password` (mesmo shape de `useMutation`).
**Depende de:** Tarefa 6 (rota precisa existir no backend)
**Testável:** `npm run build`/`npm run lint` no dashboard

### Tarefa 9 — Dashboard: botão e toasts
**Repo/Arquivo:** `trafegoflow-dashboard/components/client-portal-access/client-portal-access-section.tsx`
**O que fazer:** trocar o botão "Reenviar convite" por "Resetar senha" (mesma posição/variant), handler usando o novo hook, toasts "Senha resetada" (sucesso) / mensagem de erro equivalente à atual.
**Depende de:** Tarefa 8
**Testável:** rodar o dashboard localmente e clicar no botão contra o backend local

### Tarefa 10 — Dashboard: tipo
**Repo/Arquivo:** `trafegoflow-dashboard/types/client-portal-user.ts`
**O que fazer:** adicionar `mustChangePassword: boolean` na interface `ClientPortalUser`.
**Depende de:** nada (pode ser feito em paralelo)
**Testável:** compila sem erro de tipo

## Estimativa
| Tarefa | Complexidade | Estimativa |
|---|---|---|
| 1 — Config senha padrão | Baixa | 15 min |
| 2 — Entity mustChangePassword | Baixa | 10 min |
| 3 — Migration | Média | 30 min |
| 4 — DTO change-password | Baixa | 10 min |
| 5 — Service (3 métodos + login) | Alta | 1-1.5h |
| 6 — Controller (3 rotas) | Média | 45 min |
| 7 — Testes unitários/e2e | Média | 1-1.5h |
| 8 — Dashboard hook | Baixa | 15 min |
| 9 — Dashboard botão/toasts | Baixa | 20 min |
| 10 — Dashboard tipo | Baixa | 5 min |

**Total estimado:** ~4.5-5h

## Riscos e Dependências
- **Rota renomeada:** `resend-invite` → `reset-password` é breaking change de contrato — confirmar que nenhum outro consumidor (ex: scripts, outro frontend) chama a rota antiga antes de remover.
- **Migration com bcrypt:** o hash é calculado em Node dentro da migration (não em SQL puro) — precisa rodar com as mesmas envs de produção (`CLIENT_PORTAL_DEFAULT_PASSWORD`) para o backfill ficar coerente com o valor real usado depois.
- **Divergência de BCRYPT_ROUNDS:** a migration usa o literal `12` fixo; se `BCRYPT_ROUNDS` mudar no service no futuro, a migration antiga não deve ser alterada retroativamente (hashes já salvos ficam válidos de qualquer forma, bcrypt independe do rounds usado na comparação).
- **Reversibilidade:** como o pedido é "por ora", preferimos não criar feature flag — reverter depois é um `git revert` dos commits desta mudança, reaproveitando o `MailService`/`sendInviteEmail` que continuam intactos.
- **Fora de escopo:** `trafegoflow-client-portal` (tela de troca obrigatória no primeiro acesso, modal de "fale no WhatsApp" no esqueci-senha) fica para uma sessão futura — o backend já expõe `mustChangePassword` para quando isso for implementado.
