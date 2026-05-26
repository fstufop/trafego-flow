# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run start:dev       # development server with hot reload
npm run build           # compile TypeScript → dist/
npm run start:prod      # run compiled build

npm run lint            # ESLint with auto-fix
npm run format          # Prettier formatting

npm run test            # unit tests (src/**/*.spec.ts)
npm run test:watch      # unit tests in watch mode
npm run test:cov        # unit tests with coverage report
npm run test:e2e        # end-to-end tests (test/*.e2e-spec.ts)

npx jest --testPathPattern=<filename>   # run a single test file
```

## Architecture

This is a **multi-tenant messaging automation platform** for traffic managers who run paid campaigns on Meta. The core problem: clients receive a high volume of messages from WhatsApp and Instagram that can't be answered manually.

### Intended system design (from README)

```
Meta Platforms                  Our Platform (NestJS)               External Services
──────────────     ──────────────────────────────────────────────   ─────────────────
WhatsApp Cloud  → │ Webhook Receiver                              │
Instagram Graph → │   ↓ Message Parser & Tenant Router           │ → OpenAI / Dialogflow
                  │       ↓ Token Manager & Encryptor ↔ DB       │ → CRM (Pipedrive / HubSpot)
                  │           ↓ Bot Logic / NLP Engine            │
                  │               ↓ Automated Reply               │ → WhatsApp / Instagram
```

**Four core layers:**
1. **Webhook Receiver** — single entry point for all Meta webhook events (WhatsApp Cloud API + Instagram Graph API)
2. **Message Parser & Tenant Router** — identifies which client (tenant) owns the incoming message and routes accordingly
3. **Token Manager & Encryptor** — loads and stores per-tenant API credentials; backed by PostgreSQL (persistence) and Redis (cache)
4. **Bot Logic / NLP Engine** — processes the message, calls AI services, pushes qualified leads to CRM, sends automated replies back via Meta APIs

### Multi-tenancy model
Each tenant is a traffic manager's client — they have their own WhatsApp number and/or Instagram account, their own Meta API tokens, and their own bot configuration. Token Manager handles credential isolation between tenants.

## Tech stack

- **NestJS 11** + **TypeScript 5.7**, ES2023 target, NodeNext module resolution
- **ESLint 9** flat config (`eslint.config.mjs`) — `@typescript-eslint/no-explicit-any` is disabled
- **Prettier** — single quotes, trailing commas everywhere
- **Jest 30** with ts-jest; E2E config lives in `test/jest-e2e.json`
- Planned persistence: **PostgreSQL** + **Redis**
