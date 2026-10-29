# Portal do Cliente — Backend (trafegoflow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a clients externos uma identidade própria (`ClientPortalUserEntity`), um login com senha definida por e-mail (Mailgun), e fechar o gap de autorização que hoje deixa qualquer token autenticado ler/alterar as regras de `conversation-rules` de qualquer `clientId`.

**Architecture:** Nova entidade e serviço `ClientPortalAuthService` dentro do módulo `auth` existente (reaproveita `JwtModule` já configurado ali). Um `MailModule` novo e genérico encapsula o envio via Mailgun (chamada HTTP direta com `@nestjs/axios`, sem SDK novo). O padrão de JWT com `scope` já existente (`UPLOAD_TOKEN_SCOPE`) é estendido com um novo valor `client-portal`; um `ClientPortalScopeGuard` novo e reutilizável fecha a checagem de posse por `clientId` nos endpoints de `conversation-rules`.

**Tech Stack:** NestJS 11, TypeORM, `@nestjs/jwt`, `@nestjs/axios`, `bcrypt`, `class-validator`/`class-transformer`, Jest/ts-jest.

**Spec:** `docs/superpowers/specs/2026-10-27-client-portal-auto-reply-design.md`
**Depende de:** `docs/superpowers/plans/2026-10-28-admin-user-roles.md` (Task 1 — `UserRole`, `@Roles(...)` e `RolesGuard` precisam existir antes da Task 7 deste plano, que os usa para restringir as rotas admin de `client-portal-users` a contas `UserRole.ADMIN`).

## Global Constraints

- Tokens sem `scope` (admin) e a master API key mantêm exatamente o comportamento de hoje — nenhuma mudança de contrato pra eles.
- O token de convite/reset nunca é armazenado em texto puro — só `sha256(token)` fica no banco (`passwordResetTokenHash`), com expiração de 1h (`CLIENT_PORTAL_RESET_TOKEN_TTL_MS`).
- `ClientPortalUserEntity.passwordHash` começa `null` e só é definido em `reset-password`.
- `POST /auth/client-forgot-password` sempre responde `204` independente de o e-mail existir ou não (não revela existência de conta).
- Mailgun configurado via env: `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`, `CLIENT_PORTAL_URL` (base URL do portal novo, usada para montar o link do e-mail).

## Review Focus

- Login com `passwordHash === null` (convite nunca aceito) — deve rejeitar com `UnauthorizedException` clara, não estourar em `bcrypt.compare(password, null)`.
- `reset-password` com token expirado ou já consumido (campos zerados após uso) — deve rejeitar com `400`/`401`, nunca `500`.
- `ClientPortalScopeGuard` numa rota sem `clientId` resolvível na query nem no body — deve rejeitar (`ForbiddenException`), nunca deixar passar silenciosamente nem lançar exceção não tratada.
- `PATCH`/`DELETE /conversation-rules/:id` têm `clientId` só na **query**, não no body — confirmar que o guard lê a fonte certa pra cada verbo, não só `request.body.clientId`.
- Client com `Client.isActive = false` (cancelado) mas `ClientPortalUserEntity.isActive = true` tentando logar ou usar um token já emitido — os dois caminhos (login e guard) devem rejeitar.

---

### Task 1: `ClientPortalUserEntity` + migração

**Files:**
- Create: `src/modules/auth/entities/client-portal-user.entity.ts`
- Create: `src/database/migrations/1788000000000-CreateClientPortalUsersTable.ts`

**Interfaces:**
- Produces: `ClientPortalUserEntity extends BaseEntity` com `clientId: string`, `email: string`, `passwordHash: string | null`, `isActive: boolean` (default `true`), `passwordResetTokenHash: string | null`, `passwordResetExpiresAt: Date | null`, e um getter serializado `hasPassword: boolean` (`passwordHash !== null`) — é assim que a tela admin (plano separado, `trafegoflow-dashboard`) distingue "convite pendente" de "ativo" sem a API nunca expor o hash.

- [ ] **Step 1: Criar a entidade** em `src/modules/auth/entities/client-portal-user.entity.ts`, seguindo exatamente o padrão de `src/modules/auth/entities/user.entity.ts` (`@Entity('client_portal_users')`, `extends BaseEntity`, `@Exclude()` em `passwordHash` e em `passwordResetTokenHash`), mais um `@Expose() get hasPassword(): boolean { return this.passwordHash !== null; }` (serialização global já habilitada via `ClassSerializerInterceptor` em `main.ts`).

- [ ] **Step 2: Criar a migração**, mesmo padrão de `1783000000000-CreateConversationRulesTable.ts`:

```sql
CREATE TABLE "client_portal_users" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMP,
  "client_id" uuid NOT NULL,
  "email" character varying NOT NULL,
  "password_hash" character varying,
  "is_active" boolean NOT NULL DEFAULT true,
  "password_reset_token_hash" character varying,
  "password_reset_expires_at" TIMESTAMP,
  CONSTRAINT "PK_client_portal_users" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_client_portal_users_email" UNIQUE ("email")
);
ALTER TABLE "client_portal_users"
  ADD CONSTRAINT "FK_client_portal_users_client_id"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
```
`down()` desfaz a FK e dropa a tabela, mesmo padrão do exemplo.

- [ ] **Step 3: Verificar**

Run: `npm run build`
Expected: compila sem erro (entidade é pega automaticamente por `entities: [__dirname + '/**/*.entity{.ts,.js}']` em `app.module.ts`).

- [ ] **Step 4: Commit**

```bash
git add src/modules/auth/entities/client-portal-user.entity.ts src/database/migrations/1788000000000-CreateClientPortalUsersTable.ts
git commit -m "feat(auth): add ClientPortalUserEntity and migration"
```

---

### Task 2: `MailModule` — envio via Mailgun

**Files:**
- Create: `src/config/mailgun.config.ts`
- Create: `src/modules/mail/mail.module.ts`
- Create: `src/modules/mail/mail.service.ts`
- Test: `src/modules/mail/mail.service.spec.ts`
- Modify: `src/config/configuration.ts` (adicionar `mailgunConfig` a `configLoads` e as 4 variáveis ao `validationSchema`)
- Modify: `.env.example` (adicionar `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`, `CLIENT_PORTAL_URL`)

**Interfaces:**
- Produces: `MailService.send({ to: string; subject: string; html: string }): Promise<void>`, exportado por `MailModule`.

- [ ] **Step 1: Escrever o teste falhando** em `src/modules/mail/mail.service.spec.ts`:

```typescript
describe('MailService', () => {
  it('posts the message to the Mailgun API with basic auth and form-encoded body', async () => {
    const httpService = { post: jest.fn().mockReturnValue(of({ data: { id: 'ok' } })) };
    const config = { get: jest.fn((k: string) => ({
      'mailgun.apiKey': 'key-123', 'mailgun.domain': 'mg.example.com', 'mailgun.from': 'no-reply@example.com',
    })[k]) };
    const service = new MailService(httpService as any, config as any);

    await service.send({ to: 'client@example.com', subject: 'Assunto', html: '<p>Oi</p>' });

    expect(httpService.post).toHaveBeenCalledWith(
      'https://api.mailgun.net/v3/mg.example.com/messages',
      expect.any(URLSearchParams),
      expect.objectContaining({ auth: { username: 'api', password: 'key-123' } }),
    );
  });

  it('propagates an error when Mailgun responds with failure', async () => {
    const httpService = { post: jest.fn().mockReturnValue(throwError(() => new Error('mailgun down'))) };
    const config = { get: jest.fn().mockReturnValue('x') };
    const service = new MailService(httpService as any, config as any);

    await expect(service.send({ to: 'a@b.com', subject: 's', html: 'h' })).rejects.toThrow('mailgun down');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx jest mail.service.spec.ts`
Expected: FAIL — `MailService` não existe.

- [ ] **Step 3: Implementar `MailService.send(input: { to: string; subject: string; html: string }): Promise<void>`** em `src/modules/mail/mail.service.ts`, injetando `HttpService` (`@nestjs/axios`) e `ConfigService`. Monta um `URLSearchParams` com `from`, `to`, `subject`, `html`, faz `POST` para `https://api.mailgun.net/v3/${domain}/messages` com `auth: { username: 'api', password: apiKey }`, via `firstValueFrom` (mesmo padrão de `conversation-rules.service.ts` para chamadas HTTP externas).

- [ ] **Step 4: Criar `src/config/mailgun.config.ts`** (`registerAs('mailgun', () => ({ apiKey: process.env.MAILGUN_API_KEY, domain: process.env.MAILGUN_DOMAIN, from: process.env.MAILGUN_FROM, portalUrl: process.env.CLIENT_PORTAL_URL }))`), registrar em `configuration.ts` (`configLoads` + 4 chaves `Joi.string().required()` no `validationSchema`), e criar `MailModule` (`imports: [HttpModule]`, `providers: [MailService]`, `exports: [MailService]`).

- [ ] **Step 5: Adicionar as 4 variáveis ao `.env.example`** com valores de exemplo.

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npx jest mail.service.spec.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/config/mailgun.config.ts src/config/configuration.ts src/modules/mail .env.example
git commit -m "feat(mail): add Mailgun-backed MailModule"
```

---

### Task 3: Escopo `client-portal` no `AuthGuard`

**Files:**
- Create: `src/modules/auth/constants/client-portal.constant.ts`
- Modify: `src/modules/auth/interfaces/auth-service.interface.ts`
- Modify: `src/common/guards/auth.guard.ts`
- Modify: `src/common/guards/auth.guard.spec.ts`

**Interfaces:**
- Produces: `CLIENT_PORTAL_SCOPE = 'client-portal'`, `CLIENT_PORTAL_RESET_TOKEN_TTL_MS = 3_600_000` (ambos em `client-portal.constant.ts`); `JwtPayload.clientId?: string`.

- [ ] **Step 1: Escrever o teste falhando** em `auth.guard.spec.ts` (novo `it`, mesmo arquivo/estilo dos existentes):

```typescript
it('allows a token with the client-portal scope and exposes clientId', async () => {
  verifyAsync.mockResolvedValue({ sub: 'portal-user-id', clientId: 'client-id', scope: 'client-portal' });
  const ctx = makeContext({ authorization: 'Bearer client-token' });

  await expect(guard.canActivate(ctx)).resolves.toBe(true);
});

it('still rejects a token with an unrecognized scope (e.g. media-upload)', async () => {
  verifyAsync.mockResolvedValue({ sub: 'user-id', scope: 'media-upload' });
  await expect(
    guard.canActivate(makeContext({ authorization: 'Bearer scoped-token' })),
  ).rejects.toThrow(UnauthorizedException);
});
```

- [ ] **Step 2: Rodar e confirmar que a primeira falha**

Run: `npx jest auth.guard.spec.ts`
Expected: FAIL — o guard de hoje rejeita qualquer `scope` definido.

- [ ] **Step 3: Adicionar `CLIENT_PORTAL_SCOPE` e `CLIENT_PORTAL_RESET_TOKEN_TTL_MS`** em `src/modules/auth/constants/client-portal.constant.ts` (mesmo padrão de `upload-token.constant.ts`).

- [ ] **Step 4: Adicionar `clientId?: string` a `JwtPayload`** em `auth-service.interface.ts`, com o mesmo comentário de por que é opcional (presente só em tokens `client-portal`).

- [ ] **Step 5: Alterar `AuthGuard.canActivate`** em `auth.guard.ts`: a checagem `if (payload.scope !== undefined) throw ...` passa a ser `if (payload.scope !== undefined && payload.scope !== CLIENT_PORTAL_SCOPE) throw ...`.

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npx jest auth.guard.spec.ts`
Expected: PASS (todos os `it`, incluindo os já existentes)

- [ ] **Step 7: Commit**

```bash
git add src/modules/auth/constants/client-portal.constant.ts src/modules/auth/interfaces/auth-service.interface.ts src/common/guards/auth.guard.ts src/common/guards/auth.guard.spec.ts
git commit -m "feat(auth): accept the client-portal JWT scope in AuthGuard"
```

---

### Task 4: `ClientPortalAuthService` — provisionamento pelo admin (criar / listar / desativar / reenviar convite)

**Files:**
- Create: `src/modules/auth/dto/create-client-portal-user.dto.ts`
- Create: `src/modules/auth/client-portal-auth.service.ts`
- Test: `src/modules/auth/client-portal-auth.service.spec.ts`

**Interfaces:**
- Consumes: `MailService.send(...)` (Task 2), `CLIENT_PORTAL_RESET_TOKEN_TTL_MS` (Task 3), `ClientPortalUserEntity` (Task 1).
- Produces: `ClientPortalAuthService.createAccount(dto: CreateClientPortalUserDto): Promise<ClientPortalUserEntity>`, `.resendInvite(id: string): Promise<void>`, `.findByClient(clientId: string): Promise<ClientPortalUserEntity | null>`, `.setActive(id: string, isActive: boolean): Promise<ClientPortalUserEntity>`.

- [ ] **Step 1: Escrever o teste falhando** em `client-portal-auth.service.spec.ts` (mock de `Repository<ClientPortalUserEntity>` e `MailService`, mesmo estilo de `auth.service.spec.ts`):

```typescript
describe('createAccount', () => {
  it('creates the account with a null passwordHash and sends an invite email', async () => {
    mockRepo.create.mockReturnValue({ id: 'new-id', email: 'client@x.com', clientId: 'c1' });
    mockRepo.save.mockImplementation((e) => Promise.resolve(e));

    const result = await service.createAccount({ clientId: 'c1', email: 'client@x.com' });

    expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'c1', email: 'client@x.com', passwordHash: null,
    }));
    expect(mockMailService.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'client@x.com' }));
    expect(result.email).toBe('client@x.com');
  });

  it('throws ConflictException when the email is already registered', async () => {
    mockRepo.save.mockRejectedValue(Object.assign(new QueryFailedError('', [], new Error()), { code: '23505' }));
    await expect(service.createAccount({ clientId: 'c1', email: 'dup@x.com' })).rejects.toThrow(ConflictException);
  });
});

describe('resendInvite', () => {
  it('generates a new token and resends the invite email', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 'u1', email: 'client@x.com', isActive: true });
    await service.resendInvite('u1');
    expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ passwordResetTokenHash: expect.any(String) }));
    expect(mockMailService.send).toHaveBeenCalled();
  });

  it('throws NotFoundException for an unknown id', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await expect(service.resendInvite('missing')).rejects.toThrow(NotFoundException);
  });
});

describe('findByClient', () => {
  it('returns the portal user for that client, or null if none exists', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await expect(service.findByClient('c1')).resolves.toBeNull();
    expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { clientId: 'c1' } });
  });
});

describe('setActive', () => {
  it('flips isActive and persists it', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 'u1', isActive: true });
    mockRepo.save.mockImplementation((e) => Promise.resolve(e));
    const result = await service.setActive('u1', false);
    expect(result.isActive).toBe(false);
  });

  it('throws NotFoundException for an unknown id', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await expect(service.setActive('missing', false)).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx jest client-portal-auth.service.spec.ts`
Expected: FAIL — `ClientPortalAuthService` não existe.

- [ ] **Step 3: Criar `CreateClientPortalUserDto`** (`clientId: string` com `@IsUUID()`, `email: string` com `@IsEmail()`), mesmo estilo de `create-user.dto.ts`.

- [ ] **Step 4: Implementar `ClientPortalAuthService`** com um método privado `generateAndStoreToken(user): Promise<string>` (gera `crypto.randomBytes(32).toString('hex')`, guarda `sha256(token)` em `passwordResetTokenHash` e `now + CLIENT_PORTAL_RESET_TOKEN_TTL_MS` em `passwordResetExpiresAt`, retorna o token em texto puro pra ir no e-mail) reutilizado por `createAccount` e `resendInvite`. O e-mail monta o link como `${config.get('mailgun.portalUrl')}/definir-senha?token=${token}`. `createAccount` trata `QueryFailedError` com `code === '23505'` como `ConflictException`, igual a `AuthService.createUser`. `findByClient` é um `findOne({ where: { clientId } })` simples (retorna `null` se não houver conta). `setActive` busca por `id` (`NotFoundException` se não achar), seta `isActive` e salva.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx jest client-portal-auth.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/dto/create-client-portal-user.dto.ts src/modules/auth/client-portal-auth.service.ts src/modules/auth/client-portal-auth.service.spec.ts
git commit -m "feat(auth): client portal account provisioning + invite email"
```

---

### Task 5: `ClientPortalAuthService` — login, esqueci minha senha, redefinir senha

**Files:**
- Create: `src/modules/auth/dto/client-login.dto.ts`
- Create: `src/modules/auth/dto/forgot-password.dto.ts`
- Create: `src/modules/auth/dto/reset-password.dto.ts`
- Modify: `src/modules/auth/client-portal-auth.service.ts`
- Modify: `src/modules/auth/client-portal-auth.service.spec.ts`

**Interfaces:**
- Consumes: `ClientsService.findOne(id: string): Promise<ClientEntity>` (já existe, exportado por `ClientsModule`).
- Produces: `ClientPortalAuthService.login(dto: ClientLoginDto): Promise<{ accessToken: string; tokenType: 'Bearer'; expiresIn: string }>`, `.forgotPassword(dto: ForgotPasswordDto): Promise<void>`, `.resetPassword(dto: ResetPasswordDto): Promise<void>`.

- [ ] **Step 1: Escrever os testes falhando** (adicionar a `client-portal-auth.service.spec.ts`):

```typescript
describe('login', () => {
  it('rejects when passwordHash is null (invite never accepted)', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash: null, isActive: true, clientId: 'c1' });
    await expect(service.login({ email: 'a@b.com', password: 'x' })).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when the parent Client is inactive', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash: await bcrypt.hash('pw', 4), isActive: true, clientId: 'c1' });
    mockClientsService.findOne.mockResolvedValue({ id: 'c1', isActive: false });
    await expect(service.login({ email: 'a@b.com', password: 'pw' })).rejects.toThrow(UnauthorizedException);
  });

  it('returns a client-portal-scoped token for valid, active credentials', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 'u1', email: 'a@b.com', passwordHash: await bcrypt.hash('pw', 4), isActive: true, clientId: 'c1' });
    mockClientsService.findOne.mockResolvedValue({ id: 'c1', isActive: true });

    const result = await service.login({ email: 'a@b.com', password: 'pw' });

    expect(mockJwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'u1', clientId: 'c1', scope: 'client-portal' }),
    );
    expect(result.accessToken).toBe('signed-token');
  });
});

describe('resetPassword', () => {
  it('sets the password and clears the token when the token is valid and unexpired', async () => {
    const tokenHash = crypto.createHash('sha256').update('plain-token').digest('hex');
    mockRepo.findOne.mockResolvedValue({ id: 'u1', passwordResetTokenHash: tokenHash, passwordResetExpiresAt: new Date(Date.now() + 1000) });

    await service.resetPassword({ token: 'plain-token', password: 'new-password' });

    expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      passwordResetTokenHash: null, passwordResetExpiresAt: null,
    }));
  });

  it('rejects an expired token', async () => {
    const tokenHash = crypto.createHash('sha256').update('plain-token').digest('hex');
    mockRepo.findOne.mockResolvedValue({ id: 'u1', passwordResetTokenHash: tokenHash, passwordResetExpiresAt: new Date(Date.now() - 1000) });
    await expect(service.resetPassword({ token: 'plain-token', password: 'new-password' })).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an unknown token', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await expect(service.resetPassword({ token: 'nope', password: 'new-password' })).rejects.toThrow(UnauthorizedException);
  });
});

describe('forgotPassword', () => {
  it('resolves silently (no email sent) when the address is unknown', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await expect(service.forgotPassword({ email: 'unknown@x.com' })).resolves.toBeUndefined();
    expect(mockMailService.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx jest client-portal-auth.service.spec.ts`
Expected: FAIL — `login`/`forgotPassword`/`resetPassword` não existem.

- [ ] **Step 3: Criar os 3 DTOs** (`ClientLoginDto`: `email`/`password`, igual a `LoginDto`; `ForgotPasswordDto`: `email`; `ResetPasswordDto`: `token: string`, `password` com as mesmas validações de `CreateUserDto.password`).

- [ ] **Step 4: Implementar `login`, `forgotPassword`, `resetPassword`** em `ClientPortalAuthService`, injetando `ClientsService` e `JwtService`. `login` busca por `email` + `isActive: true`, rejeita se `passwordHash` for `null` antes de chamar `bcrypt.compare`, valida a senha, busca o `Client` via `clientsService.findOne(user.clientId)` e rejeita se `!client.isActive`, então assina `{ sub: user.id, clientId: user.clientId, scope: CLIENT_PORTAL_SCOPE }`. `resetPassword` faz hash do token recebido e busca por `passwordResetTokenHash` igual + `passwordResetExpiresAt > now`.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx jest client-portal-auth.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/dto/client-login.dto.ts src/modules/auth/dto/forgot-password.dto.ts src/modules/auth/dto/reset-password.dto.ts src/modules/auth/client-portal-auth.service.ts src/modules/auth/client-portal-auth.service.spec.ts
git commit -m "feat(auth): client portal login, forgot-password and reset-password"
```

---

### Task 6: `ClientPortalScopeGuard` (checagem de posse reutilizável)

**Files:**
- Create: `src/modules/auth/guards/client-portal-scope.guard.ts`
- Test: `src/modules/auth/guards/client-portal-scope.guard.spec.ts`
- Modify: `src/modules/auth/client-portal-auth.service.ts` (novo método `assertAccess`)
- Modify: `src/modules/auth/client-portal-auth.service.spec.ts`

**Interfaces:**
- Consumes: `JwtPayload` (do `request.user`, já setado pelo `AuthGuard`).
- Produces: `ClientPortalAuthService.assertAccess(payload: JwtPayload, targetClientId: string | undefined): Promise<void>` (lança `ForbiddenException`); `ClientPortalScopeGuard implements CanActivate`.

- [ ] **Step 1: Escrever o teste falhando** para `assertAccess` em `client-portal-auth.service.spec.ts`:

```typescript
describe('assertAccess', () => {
  it('passes through silently for a non-client-portal payload (admin token)', async () => {
    await expect(service.assertAccess({ sub: 'admin', email: 'a', name: 'A' }, 'any-client-id')).resolves.toBeUndefined();
  });

  it('throws when targetClientId does not match the token clientId', async () => {
    await expect(
      service.assertAccess({ sub: 'u1', email: 'a', name: 'A', clientId: 'c1', scope: 'client-portal' }, 'c2'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws when targetClientId is undefined (no clientId resolvable on the request)', async () => {
    await expect(
      service.assertAccess({ sub: 'u1', email: 'a', name: 'A', clientId: 'c1', scope: 'client-portal' }, undefined),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws when the portal user itself is inactive', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 'u1', isActive: false });
    await expect(
      service.assertAccess({ sub: 'u1', email: 'a', name: 'A', clientId: 'c1', scope: 'client-portal' }, 'c1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws when the parent Client is inactive', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 'u1', isActive: true });
    mockClientsService.findOne.mockResolvedValue({ id: 'c1', isActive: false });
    await expect(
      service.assertAccess({ sub: 'u1', email: 'a', name: 'A', clientId: 'c1', scope: 'client-portal' }, 'c1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('resolves when everything matches and is active', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 'u1', isActive: true });
    mockClientsService.findOne.mockResolvedValue({ id: 'c1', isActive: true });
    await expect(
      service.assertAccess({ sub: 'u1', email: 'a', name: 'A', clientId: 'c1', scope: 'client-portal' }, 'c1'),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx jest client-portal-auth.service.spec.ts`
Expected: FAIL — `assertAccess` não existe.

- [ ] **Step 3: Implementar `assertAccess`** em `ClientPortalAuthService`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx jest client-portal-auth.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Escrever o teste falhando do guard** em `client-portal-scope.guard.spec.ts` (mock de `ClientPortalAuthService.assertAccess`, mesmo estilo de `auth.guard.spec.ts`):

```typescript
describe('ClientPortalScopeGuard', () => {
  const assertAccess = jest.fn();
  const guard = new ClientPortalScopeGuard({ assertAccess } as any);

  const makeContext = (user: any, query: any = {}, body: any = {}): ExecutionContext =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user, query, body }) }) }) as any;

  it('resolves clientId from the query string', async () => {
    assertAccess.mockResolvedValue(undefined);
    await guard.canActivate(makeContext({ scope: 'client-portal', clientId: 'c1' }, { clientId: 'c1' }));
    expect(assertAccess).toHaveBeenCalledWith(expect.anything(), 'c1');
  });

  it('falls back to the body when there is no query clientId', async () => {
    assertAccess.mockResolvedValue(undefined);
    await guard.canActivate(makeContext({ scope: 'client-portal', clientId: 'c1' }, {}, { clientId: 'c1' }));
    expect(assertAccess).toHaveBeenCalledWith(expect.anything(), 'c1');
  });

  it('propagates ForbiddenException from assertAccess', async () => {
    assertAccess.mockRejectedValue(new ForbiddenException());
    await expect(guard.canActivate(makeContext({ scope: 'client-portal' }, {}))).rejects.toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `npx jest client-portal-scope.guard.spec.ts`
Expected: FAIL — arquivo não existe.

- [ ] **Step 7: Implementar `ClientPortalScopeGuard`**: lê `request.user`, `request.query?.clientId ?? request.body?.clientId`, chama `clientPortalAuthService.assertAccess(user, clientId)`, retorna `true` se não lançar.

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `npx jest client-portal-scope.guard.spec.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/modules/auth/client-portal-auth.service.ts src/modules/auth/client-portal-auth.service.spec.ts src/modules/auth/guards/client-portal-scope.guard.ts src/modules/auth/guards/client-portal-scope.guard.spec.ts
git commit -m "feat(auth): reusable ClientPortalScopeGuard for per-client ownership checks"
```

---

### Task 7: `ClientPortalAuthController` + wiring no `AuthModule`

**Files:**
- Create: `src/modules/auth/client-portal-auth.controller.ts`
- Create: `src/modules/auth/dto/set-client-portal-user-active.dto.ts`
- Modify: `src/modules/auth/auth.module.ts`

**Interfaces:**
- Consumes: todos os métodos de `ClientPortalAuthService` (Tasks 4–6); `UserRole`, `Roles` e `RolesGuard` (`docs/superpowers/plans/2026-10-28-admin-user-roles.md`, Task 1); `ClientPortalAuthGuard` (Task 3 — corrigido durante a revisão: é um guard **separado** de `AuthGuard`, mesmo padrão de `MediaUploadAuthGuard`, que aceita master key / sem `scope` / `scope: CLIENT_PORTAL_SCOPE` — `AuthGuard` em si voltou a rejeitar qualquer `scope`, igual ao comportamento original, pra não abrir as outras 12+ controllers que usam `@UseGuards(AuthGuard)` pra tokens de client).
- Produces: `POST /auth/client-portal-users` (admin), `GET /auth/client-portal-users?clientId=` (admin), `PATCH /auth/client-portal-users/:id` (admin, `{ isActive: boolean }`), `POST /auth/client-portal-users/:id/resend-invite` (admin), `POST /auth/client-login` (público), `POST /auth/client-forgot-password` (público), `POST /auth/client-reset-password` (público), `GET /auth/client-portal/me` (token `client-portal`, retorna `{ clientId, email }` — é assim que o portal novo descobre o próprio `clientId` pra montar as chamadas a `/conversation-rules`, já que o JWT fica num cookie `httpOnly` e nunca é lido no browser). `ClientPortalScopeGuard` exportado por `AuthModule`.

- [ ] **Step 1: Implementar `ClientPortalAuthController`** espelhando `AuthController` (DTOs + `HttpCode`/`ApiOperation` por rota; as quatro rotas admin levam `@UseGuards(AuthGuard, RolesGuard)` + `@Roles(UserRole.ADMIN)` + `@ApiBearerAuth()` + `@ApiSecurity('x-api-key')` — só conta `admin` pode provisionar/revogar acesso de client ao portal, e um token `client-portal` já é rejeitado por `AuthGuard` antes mesmo de chegar no `RolesGuard`; as três públicas não levam guard; `GET /auth/client-portal/me` leva `@UseGuards(ClientPortalAuthGuard)` (não `AuthGuard` — é a única forma de uma rota aceitar o token `client-portal`) + `@CurrentUser()`, busca `ClientPortalUserEntity` por `payload.sub` e retorna `{ clientId: user.clientId, email: user.email }` — mesmo espírito do `AuthController.me()` já existente). O `PATCH` usa um DTO simples `SetClientPortalUserActiveDto { isActive: boolean }`.

- [ ] **Step 2: Registrar em `AuthModule`**: `TypeOrmModule.forFeature([UserEntity, ClientPortalUserEntity])`, importar `MailModule` e `ClientsModule`, adicionar `ClientPortalAuthController` a `controllers`, `ClientPortalAuthService` e `ClientPortalScopeGuard` a `providers`, exportar `ClientPortalScopeGuard` (pra uso em `ConversationRulesModule`).

- [ ] **Step 3: Verificar**

Run: `npm run build`
Expected: compila sem erro (checa imports circulares — `AuthModule` passa a importar `ClientsModule`; confirmar que `ClientsModule` não importa `AuthModule`, evitando ciclo).

- [ ] **Step 4: Commit**

```bash
git add src/modules/auth/client-portal-auth.controller.ts src/modules/auth/auth.module.ts
git commit -m "feat(auth): wire up client portal auth endpoints"
```

---

### Task 8: Checagem de posse em `conversation-rules` (create/findAll/update/remove)

**Files:**
- Modify: `src/modules/conversation-rules/conversation-rules.controller.ts`
- Modify: `src/modules/conversation-rules/conversation-rules.module.ts`
- Create: `src/modules/conversation-rules/conversation-rules.controller.spec.ts`

**Interfaces:**
- Consumes: `ClientPortalScopeGuard` (Task 6/7, exportado por `AuthModule`); `ClientPortalAuthGuard` (Task 3).

- [ ] **Step 0: Trocar o guard de classe do controller** de `@UseGuards(AuthGuard)` para `@UseGuards(ClientPortalAuthGuard)` em `ConversationRulesController` — toda a controller (CRUD + `getPosts`, Task 9) precisa aceitar tanto um JWT normal de admin quanto um token `client-portal` (hoje só `AuthGuard` está lá, que passou a rejeitar `client-portal` de novo depois da correção da Task 3). Isso não muda nada pro admin/master-key — `ClientPortalAuthGuard` aceita exatamente os mesmos dois casos que `AuthGuard` aceita hoje, mais o `client-portal`.

- [ ] **Step 1: Escrever o teste falhando** em `conversation-rules.controller.spec.ts` (módulo de teste Nest com `ConversationRulesService` mockado, sem precisar montar o guard de verdade — foco é confirmar que o guard está anotado nos 4 métodos):

```typescript
import { Reflector } from '@nestjs/core';

describe('ConversationRulesController guards', () => {
  const reflector = new Reflector();

  it.each(['create', 'findAll', 'update', 'remove'])(
    'applies ClientPortalScopeGuard to %s',
    (method) => {
      const guards = reflector.get('__guards__', ConversationRulesController.prototype[method]);
      expect(guards).toContain(ClientPortalScopeGuard);
    },
  );

  it('does not apply ClientPortalScopeGuard to getPosts', () => {
    const guards = reflector.get('__guards__', ConversationRulesController.prototype.getPosts) ?? [];
    expect(guards).not.toContain(ClientPortalScopeGuard);
  });
});
```

(Se `Reflect.getMetadata('__guards__', ...)` não for a chave certa na versão do Nest instalada, usar `Reflect.getMetadata(GUARDS_METADATA, ...)` de `@nestjs/common/constants` — confirmar a constante certa ao implementar.)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx jest conversation-rules.controller.spec.ts`
Expected: FAIL — nenhum método tem o guard ainda.

- [ ] **Step 3: Adicionar `@UseGuards(ClientPortalScopeGuard)` em `create`, `findAll`, `update`, `remove`** no controller (em cima do `@UseGuards(ClientPortalAuthGuard)` de classe já trocado no Step 0); importar `AuthModule` em `ConversationRulesModule` pra ter `ClientPortalScopeGuard` e `ClientPortalAuthGuard` disponíveis para injeção.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx jest conversation-rules.controller.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/conversation-rules/conversation-rules.controller.ts src/modules/conversation-rules/conversation-rules.module.ts src/modules/conversation-rules/conversation-rules.controller.spec.ts
git commit -m "feat(conversation-rules): enforce per-client ownership for client-portal tokens"
```

---

### Task 9: `GET /conversation-rules/posts` — resolver `pageId` a partir do token para tokens `client-portal`

**Files:**
- Modify: `src/modules/conversation-rules/conversation-rules.service.ts`
- Modify: `src/modules/conversation-rules/conversation-rules.service.spec.ts`
- Modify: `src/modules/conversation-rules/conversation-rules.controller.ts`
- Modify: `src/modules/conversation-rules/conversation-rules.controller.spec.ts`

**Interfaces:**
- Consumes: `IntegrationsService.findAll(clientId: string): Promise<IntegrationEntity[]>` (já existe).
- Produces: `ConversationRulesService.getRecentPostsForClient(clientId: string, limit?: number, after?: string): Promise<InstagramPostsResult>`.

- [ ] **Step 1: Escrever o teste falhando** em `conversation-rules.service.spec.ts`:

```typescript
describe('getRecentPostsForClient', () => {
  it('resolves the pageId from the client\'s active Instagram integration', async () => {
    mockIntegrationsService.findAll.mockResolvedValue([
      { platform: 'whatsapp', isActive: true, pageId: 'wrong' },
      { platform: 'instagram', isActive: true, pageId: 'ig-page-1' },
    ]);
    const spy = jest.spyOn(service, 'getRecentPosts').mockResolvedValue({ data: [], paging: null });

    await service.getRecentPostsForClient('client-1', 12);

    expect(spy).toHaveBeenCalledWith('ig-page-1', 12, undefined);
  });

  it('throws NotFoundException when the client has no active Instagram integration', async () => {
    mockIntegrationsService.findAll.mockResolvedValue([]);
    await expect(service.getRecentPostsForClient('client-1')).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx jest conversation-rules.service.spec.ts`
Expected: FAIL — método não existe.

- [ ] **Step 3: Implementar `getRecentPostsForClient`** em `ConversationRulesService`, reaproveitando `getRecentPosts` já existente.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx jest conversation-rules.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Escrever o teste falhando do controller** em `conversation-rules.controller.spec.ts`:

```typescript
describe('getPosts', () => {
  it('uses the query pageId for an admin/master-key request (no clientId resolution)', async () => {
    await controller.getPosts({ pageId: 'ig-1', limit: 12 } as any, undefined);
    expect(mockService.getRecentPosts).toHaveBeenCalledWith('ig-1', 12, undefined);
    expect(mockService.getRecentPostsForClient).not.toHaveBeenCalled();
  });

  it('ignores the query pageId and resolves it from the token for a client-portal request', async () => {
    await controller.getPosts({ pageId: 'attacker-page', limit: 12 } as any, { clientId: 'c1', scope: 'client-portal' } as any);
    expect(mockService.getRecentPostsForClient).toHaveBeenCalledWith('c1', 12, undefined);
    expect(mockService.getRecentPosts).not.toHaveBeenCalledWith('attacker-page', expect.anything(), expect.anything());
  });
});
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `npx jest conversation-rules.controller.spec.ts`
Expected: FAIL — `getPosts` ainda não recebe `@CurrentUser()` nem ramifica.

- [ ] **Step 7: Alterar `getPosts`** no controller para receber `@CurrentUser() user?: JwtPayload` e ramificar: `user?.scope === CLIENT_PORTAL_SCOPE ? this.rulesService.getRecentPostsForClient(user.clientId!, query.limit, query.after) : this.rulesService.getRecentPosts(query.pageId, query.limit, query.after)`.

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `npx jest conversation-rules.controller.spec.ts conversation-rules.service.spec.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/modules/conversation-rules/conversation-rules.service.ts src/modules/conversation-rules/conversation-rules.service.spec.ts src/modules/conversation-rules/conversation-rules.controller.ts src/modules/conversation-rules/conversation-rules.controller.spec.ts
git commit -m "fix(conversation-rules): derive pageId from the client-portal token instead of trusting the query param"
```

---

### Task 10: Documentação — portal do cliente e estrutura multi-tenant

**Files:**
- Modify: `README.md`

**Interfaces:** nenhuma — só documentação.

- [ ] **Step 1: Adicionar uma seção `## Portal do cliente`** no `README.md`, cobrindo, pra quem for ler o projeto pela primeira vez: o que é o `ClientPortalUserEntity` e em que ele difere de `UserEntity` (login de cliente externo vs. conta interna da equipe — identidades e tabelas separadas, nunca a mesma), o fluxo de convite/reset de senha via Mailgun (sem senha definida pelo admin — só um link por e-mail), o `scope: 'client-portal'` no JWT e o que ele restringe (só os próprios dados, via `ClientPortalScopeGuard`), e o link para o repo novo do frontend (`trafegoflow-client-portal`) e para o spec (`docs/superpowers/specs/2026-10-27-client-portal-auto-reply-design.md`) como referência mais detalhada.

- [ ] **Step 2: Atualizar o diagrama de estrutura de dados (`erDiagram`) existente no `README.md`** incluindo `CLIENT_PORTAL_USER` como uma entidade ligada a `CLIENT` (`CLIENT ||--o| CLIENT_PORTAL_USER : "tem acesso via"`), consistente com o restante do diagrama já existente.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the client portal identity and invite/reset flow"
```

---

## O que fica a cargo de quem for construir

- Template final do e-mail (HTML) de convite/reset — este plano só fixa o link e o assunto como exemplos.
- Testes e2e completos do fluxo de login/reset (o plano cobre unitário; `test/jest-e2e.json` já existe como base).
- Rate limiting em `client-forgot-password` (citado no spec, não coberto por teste aqui).
- Nome exato da constante de metadata de guards usada no Task 8 (`GUARDS_METADATA` ou equivalente) — confirmar na versão instalada do `@nestjs/common` ao implementar.
