# Design: Portal do Cliente para Regras de Auto-Resposta (Instagram)

**Data:** 2026-10-27
**Status:** Aguardando aprovação

---

## Intenção e porquê

Hoje, só a equipe (admins) cria e mantém as regras de auto-resposta do Instagram de cada client (`post_comment`, `keyword_dm`, `icebreaker`, `default` — ver [`2026-09-09-conversation-rules-design.md`](./2026-09-09-conversation-rules-design.md) e [`2026-10-20-instagram-icebreaker-rules-design.md`](./2026-10-20-instagram-icebreaker-rules-design.md)), manualmente, para cada client. A API e o modelo de dados para isso já existem e estão em produção.

Vários clients já usam ferramentas como o ManyChat e esperam poder configurar esse tipo de regra sozinhos. O objetivo deste projeto é dar essa autonomia: um portal onde o client loga e gerencia **só as próprias regras de auto-resposta do Instagram**, usando a mesma API que a equipe já usa.

---

## Estado atual (contexto que motiva as decisões abaixo)

- **`trafegoflow`** (NestJS): módulo `conversation-rules` completo (entidade, service, controller), escopado por `clientId`. Usado hoje só por admins.
- **`trafegoflow-dashboard`** (Next.js, interno): painel único da equipe, sem nenhum conceito de role. **Correção após revisão mais profunda do código:** a equipe já tem uma UI completa pra isso — `components/conversation-rules/` (seção na página do client, modal de criar/editar com validação zod espelhando as regras do backend, seletor de posts do Instagram, modal de exclusão). Essa UI (em particular `conversation-rule-upsert-dialog.tsx`) é a referência mais confiável dos campos e validações por tipo de regra para o portal novo — mais confiável que re-derivar dos DTOs do backend.
- **Identidade:** clients existem só como registros `Client` gerenciados pela equipe. Não existe login de client em lugar nenhum.
- **Autenticação hoje:** `AuthGuard` aceita a master API key **ou** qualquer JWT de usuário válido (`UserEntity`: nome/email/senha), sem nenhuma checagem de posse — qualquer usuário autenticado pode ler/alterar as regras de **qualquer** `clientId` passando o parâmetro na URL. Isso é aceitável entre admins internos de confiança, mas é o principal risco a fechar antes de expor isso a clients externos.
- **Padrão de token com escopo já existe:** `issueUploadToken` (em `auth.service.ts`) já emite um JWT com um campo `scope` (`UPLOAD_TOKEN_SCOPE = 'media-upload'`), e tanto `AuthGuard` quanto `JwtAuthGuard` já **rejeitam** qualquer token que carregue um `scope` que não esperam. Isso dá um padrão pronto para reaproveitar no token do portal do client (ver abaixo).
- As regras de auto-resposta são **só Instagram** (comentário em post, DM por palavra-chave, ice breaker, resposta padrão) — não há WhatsApp envolvido.

---

## Decisão de arquitetura

**Projeto novo, separado do `trafegoflow-dashboard`, consumindo a mesma API do `trafegoflow`.**

Considerado e descartado: estender o `trafegoflow-dashboard` com roteamento por role. Descartado porque:
- Hoje não existe nenhum conceito de role em lugar nenhum — teria que ser construído do zero de qualquer forma, não é "reuso" de algo pronto.
- Misturar login de client externo (potencialmente um ex-client, após cancelamento) no mesmo app/deploy usado pela equipe aumenta o risco de uma rota admin vazar para um client por um bug de middleware.
- O escopo do portal é propositalmente estreito (só regras de auto-resposta), então o custo de um projeto novo e enxuto é baixo.

---

## Escopo (goals)

- Client loga e gerencia as próprias regras de `post_comment`, `keyword_dm`, `icebreaker` e `default`.
- Conta do client é criada e desativada pela equipe (sem auto-cadastro) — ver seção de identidade.
- Interface moderna, com transições/animações, mas direta ao ponto — guiada pelos 4 tipos de regra já existentes, não um construtor livre (diferente do ManyChat).

## Fora de escopo (non-goals, por enquanto)

- WhatsApp.
- Qualquer outra área do client (relatórios, status de campanha, billing).
- Auto-cadastro de client.

## Anti-goals (o que tornaria isso um fracasso mesmo funcionando)

- Um client conseguir ler ou alterar regras de **outro** client.
- Uma rota/tela interna da equipe ficar acessível a partir de um login de client.
- Interface complexa demais para um client leigo (mitigado pela estrutura guiada por tipo, escolhida nos mockups).

---

## Identidade do client no backend (`trafegoflow`)

Nova entidade `ClientPortalUserEntity` (nome sugerido), espelhando o padrão já usado em `UserEntity`:

| Campo | Tipo | Observação |
|---|---|---|
| `id` | UUID PK | |
| `clientId` | UUID FK → `clients` | dono da conta |
| `email` | string, unique | |
| `passwordHash` | string \| null | bcrypt, mesmo padrão de `AuthService`; `null` até o client definir a senha pelo link de convite |
| `isActive` | boolean, default `true` | desativar = revogar acesso (igual ao `isActive` de `UserEntity`) |
| `passwordResetTokenHash` | string \| null | hash (não o token em si) do convite/reset pendente |
| `passwordResetExpiresAt` | timestamptz \| null | expiração curta (ex. 1h) do link ativo |

**Provisionamento:** feito pela equipe, numa tela nova na página do client no `trafegoflow-dashboard` (`app/(dashboard)/clientes/[id]`) — botão "Criar acesso ao portal" pedindo só o **e-mail** do client (sem senha — ela é definida pelo próprio client, via e-mail, ver abaixo). A mesma tela mostra o status do acesso (convite pendente / ativo / desativado) e permite desativar ou reenviar o convite / reset.

Isso implica novos endpoints admin-only (protegidos pelo `AuthGuard` de hoje) para criar, listar, desativar e reenviar convite dessa conta.

### E-mail transacional (Mailgun)

Provedor escolhido: **Mailgun**. Dois fluxos reaproveitam o mesmo mecanismo de token (convite inicial e "esqueci minha senha" são o mesmo recurso: "defina/redefina sua senha por link"):

- Novo `MailModule` encapsulando o client HTTP do Mailgun (API key + domínio de envio via config/env — `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`).
- Domínio de envio precisa ter os registros DNS do Mailgun (SPF/DKIM) configurados antes de ir pra produção — passo manual, fora do código, com tempo de propagação.
- Gerar o token: valor aleatório (ex. `crypto.randomUUID()` ou bytes aleatórios), guarda-se só o hash (`passwordResetTokenHash`) no banco — igual ao padrão de senha, nunca o token em texto puro — com expiração curta (`passwordResetExpiresAt`, sugestão: 1h).
- Link enviado aponta para uma rota do **portal novo** (ex. `https://portal.../definir-senha?token=...`), não da API diretamente.

**Endpoints novos:**

| Endpoint | Quem chama | O que faz |
|---|---|---|
| `POST /auth/client-portal-users` | admin (`AuthGuard`) | cria a conta (só e-mail) e dispara o e-mail de convite |
| `POST /auth/client-portal-users/:id/resend-invite` | admin (`AuthGuard`) | gera novo token e reenvia e-mail (convite ou reset) |
| `POST /auth/client-forgot-password` | público (o client, pelo e-mail dele) | se o e-mail existir e a conta estiver ativa, gera token e envia e-mail — resposta genérica sempre (não revela se o e-mail existe) |
| `POST /auth/client-reset-password` | público, com token | valida hash + expiração, define `passwordHash`, limpa o token |

Rate limiting básico em `client-forgot-password` (ex. por IP/e-mail) fica a cargo de quem construir, pra evitar abuso de envio.

### Login e token do portal

- Novo endpoint, ex. `POST /auth/client-login` (email/senha), análogo a `AuthService.login`, mas buscando em `ClientPortalUserEntity`, checando `isActive` e rejeitando se `passwordHash` ainda for `null` (convite pendente, client ainda não definiu a senha).
- JWT emitido com um novo escopo dedicado, seguindo o padrão de `UPLOAD_TOKEN_SCOPE`:
  ```typescript
  const CLIENT_PORTAL_SCOPE = 'client-portal';
  // payload: { sub: clientPortalUser.id, clientId, scope: CLIENT_PORTAL_SCOPE }
  ```
  Diferente do upload-token (5 min), esse token tem duração de sessão normal (mesmo `auth.jwtExpiresIn`).

### Fechando o gap de autorização

`AuthGuard` precisa aceitar esse novo escopo (hoje rejeita qualquer token com `scope` definido) e expor `clientId` no `request.user`. Nos endpoints de `conversation-rules`, adicionar a checagem:

> Se `request.user.scope === 'client-portal'`, o `clientId` da query/body **tem que** bater com `request.user.clientId` — senão `403 Forbidden`.

Isso mantém **os mesmos endpoints** servindo admin e client (cumprindo "usar a mesma API"), sem abrir brecha nova. Tokens de admin (sem `scope`) e a master API key continuam com o comportamento de hoje, sem essa restrição.

**`GET /conversation-rules/posts?pageId=...` — contrato não muda para admin/master key.** Hoje esse endpoint recebe `pageId` direto, sem checagem de `clientId` nenhuma; isso **continua assim** para quem autentica com a master API key ou um JWT de admin (sem `scope`) — nenhuma mudança no fluxo que o dashboard interno já usa. Só quando o token é `client-portal`: o `pageId` enviado na query é ignorado, e o handler resolve o `pageId` no servidor a partir do `clientId` do próprio token (mesma chamada que o dashboard já faz hoje via `GET /integrations?clientId=...`, filtrando a integração ativa do Instagram). Isso fecha o único ponto onde um client-portal token poderia, hoje, pedir dados de um `pageId` que não é o seu.

### Revogação em cascata com o `Client`

`ClientEntity` já tem seu próprio `isActive`, usado para representar o client cancelado/inativo no sistema como um todo — independente do `isActive` do `ClientPortalUserEntity`. O login do portal (`POST /auth/client-login`) e a autorização por `scope === 'client-portal'` devem checar **os dois**: `ClientPortalUserEntity.isActive` **e** `Client.isActive` do pai. Sem essa checagem dupla, cancelar um client não revoga o acesso ao portal — reproduzindo exatamente o cenário de risco ("ex-client com acesso") que motivou manter este portal como um app separado do dashboard interno.

---

## Portal do client — UX (decidido com mockups)

- **Tela principal:** galeria de 4 cartões, um por tipo de regra (comentário em post, palavra-chave no DM, ice breaker, resposta padrão), cada um mostrando quantas regras ativas tem.
- **Drill-down por tipo:** lista das regras existentes daquele tipo. Criar ou editar uma regra **expande inline, na própria lista** (sem modal, sem painel lateral) — escolhido por manter contexto e ser "sem susto" mesmo crescendo a lista.
- Campos do formulário seguem exatamente os DTOs já existentes por tipo:
  - `post_comment`: post (via `GET /conversation-rules/posts`), palavra-chave do comentário, resposta pública, resposta privada (só texto — sem botão, regra já validada no backend).
  - `keyword_dm`: palavra-chave, resposta (texto / quick replies / botão).
  - `icebreaker`: pergunta do ice breaker, resposta — respeitar limite de 4 ativas por client (já validado no backend, UI deve avisar antes de tentar).
  - `default`: só a resposta — um por client.
- Estilo visual: moderno, com animações de transição (ex. expandir/colapsar o form inline, hover nos cartões), mas sem exagero — prioridade é ser prático.
- **Telas de acesso** (fora da área logada): login; "definir senha" (destino do link de convite/reset, recebe `token` via query string); "esqueci minha senha" (pede e-mail, dispara `client-forgot-password`).

---

## Stack do portal novo (escolha minha, pode ser trocada)

Mesmo stack do `trafegoflow-dashboard`, por consistência e porque a equipe já conhece: Next.js 15 + Tailwind + shadcn/ui + TanStack Query + react-hook-form/zod, adicionando uma lib leve de animação (ex. `motion`) para as transições do cartão/expansão inline. Deploy e domínio separados do dashboard interno (ex. um subdomínio próprio), repo novo.

---

## O que fica a cargo de quem for construir

- Nome do projeto/repo, domínio e pipeline de deploy exatos.
- Nome final da entidade/tabela e dos endpoints novos (`ClientPortalUserEntity`, `/auth/client-login` são sugestões).
- Componentização exata das telas, estados de loading/erro/vazio, ícones.
- Migração de banco para a nova tabela de contas do portal.
- Testes (unitários no backend para o guard/checagem de `clientId` e para o fluxo de token de senha; e2e do fluxo de login e de convite/reset do client).
- Template do e-mail de convite/reset (visual, texto) e TTL final do token (sugestão: 1h).
- Configuração do domínio de envio no Mailgun (DNS) como passo de deploy — ver [configuração de webhook no Meta](./2026-09-09-conversation-rules-design.md#configuração-de-webhook-no-meta-passo-de-deploy) como exemplo do tipo de passo manual que já documentamos antes.

---

## Riscos / limitações conhecidas

- Esse é o primeiro login externo (fora da equipe) no sistema — vale uma revisão de segurança focada no isolamento entre clients antes de ir pra produção.
- Se no futuro o portal crescer para mais áreas (relatórios, billing), a checagem de escopo em cada endpoint precisa ser replicada — vale considerar um guard/decorator reutilizável desde já em vez de duplicar a lógica em cada controller.
- Entrega de e-mail depende de configuração correta do domínio no Mailgun (SPF/DKIM) **antes** do lançamento — sem isso, convites/resets podem cair em spam ou falhar silenciosamente. Vale testar entregabilidade (ex. mail-tester.com) antes de liberar pra clients reais.
