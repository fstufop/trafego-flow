# Client Billing — Contract & Installment Redesign

**Date:** 2026-08-18
**Status:** Approved

## Context

The current `ClientBillingEntity` holds a single global `status` (paid/pending/overdue) and a `BillingType` enum (monthly/quarterly/semiannual/annual). This model cannot represent individual installments, contract duration, or contract history per client.

The goal is to redesign billing to support:
- Contracts with a start date and a 1–12 month duration
- Automatic monthly installment generation, each with its own lifecycle
- Contract renewal (creating a new contract with optional different terms)
- Historical contract records per client

## Data Model

### `ClientBillingEntity` — changes

**Removed:**
- `type` (BillingType enum) — replaced by `durationMonths`
- `status` (BillingStatus enum) — moved to installment level
- `lastPaidAt` — tracked per installment

**Added:**
- `startDate: Date` — contract start date (required)
- `durationMonths: number` — integer 1–12 (required)
- `contractStatus: ContractStatus` — enum: `active | expired | cancelled`

**Kept:** `amount`, `discountType`, `discountValue`, `paymentMethod`, `dueDay`

**Constraint change:** `UNIQUE(clientId)` removed — a client may have multiple contracts over time.

**Relationship change:** `Client → ClientBilling` becomes OneToMany (was OneToOne).

### New `ClientBillingInstallmentEntity`

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `clientBillingId` | UUID | FK → `client_billings` |
| `installmentNumber` | integer | 1–N |
| `dueDate` | date | computed at contract creation |
| `paidAt` | timestamptz | nullable; set when paid |
| `createdAt`, `updatedAt`, `deletedAt` | timestamp | from BaseEntity |
| `status` | virtual | computed in service layer |

Status computation (not stored):
- `paidAt != null` → `paid`
- `dueDate < today` → `overdue`
- otherwise → `pending`

### Relationships

```
Client (1) ──→ (N) ClientBilling
ClientBilling (1) ──→ (N) ClientBillingInstallment
```

### Installment due date generation

Given `startDate`, `dueDay`, and `durationMonths`, installments are generated at contract creation:

- First installment: first calendar occurrence of `dueDay` after `startDate`
- Each subsequent installment: +1 month
- `dueDay` range: 1–30; for months without that day (e.g. February 29/30), use the last day of that month

Example — `startDate = 2026-01-15`, `dueDay = 10`, `durationMonths = 3`:
- Installment 1: `2026-02-10`
- Installment 2: `2026-03-10`
- Installment 3: `2026-04-10`

## Business Logic

### Create contract (`POST /clients/:id/billing`)

1. Reject if client already has an `active` contract (one active contract at a time)
2. Validate `durationMonths` (1–12) and `dueDay` (1–30)
3. Create `ClientBillingEntity` with `contractStatus = 'active'`
4. Generate `durationMonths` installments automatically
5. Persist billing + installments in a single transaction

### Mark installment as paid (`PATCH /clients/:id/billing/:billingId/installments/:installmentId/pay`)

- Sets `paidAt = now()` on the installment
- No changes to the contract record

### Renew contract (`POST /clients/:id/billing/:billingId/renew`)

1. Mark current contract as `expired`
2. Create new `ClientBillingEntity` for the same client (may have different `durationMonths`, `amount`, etc.)
3. Generate new installments
4. Persist in a single transaction
5. Return the new contract

**`RenewClientBillingDto`:** same fields as create; `amount`, `dueDay`, `paymentMethod` are optional and inherit from the previous contract if omitted.

### Cancel contract (`PATCH /clients/:id/billing/:billingId/cancel`)

- Sets `contractStatus = 'cancelled'`
- Existing installments are preserved for historical record

### Installment status enrichment

Before returning any billing response, the service computes `status` for each installment:

```ts
function computeStatus(installment): InstallmentStatus {
  if (installment.paidAt) return 'paid';
  if (installment.dueDate < new Date()) return 'overdue';
  return 'pending';
}
```

## API Endpoints

| Method | Route | Action |
|---|---|---|
| `POST` | `/clients/:id/billing` | Create contract |
| `GET` | `/clients/:id/billing` | List all contracts for client |
| `GET` | `/clients/:id/billing/active` | Get current active contract |
| `POST` | `/clients/:id/billing/:billingId/renew` | Renew contract |
| `PATCH` | `/clients/:id/billing/:billingId/cancel` | Cancel contract |
| `PATCH` | `/clients/:id/billing/:billingId/installments/:installmentId/pay` | Mark installment as paid |

## DTOs

### `CreateClientBillingDto`
```ts
startDate: Date
durationMonths: number       // 1–12
amount: number
dueDay: number               // 1–30
paymentMethod: PaymentMethod // pix | boleto | debit | credit
discountType?: DiscountType  // fixed | percentage
discountValue?: number
```

### `RenewClientBillingDto`
```ts
startDate: Date
durationMonths: number
amount?: number              // inherits from previous contract if omitted
dueDay?: number
paymentMethod?: PaymentMethod
discountType?: DiscountType
discountValue?: number
```

### `ClientBillingResponseDto`
```ts
id: string
clientId: string
startDate: Date
durationMonths: number
amount: number
discountType?: DiscountType
discountValue?: number
paymentMethod: PaymentMethod
dueDay: number
contractStatus: 'active' | 'expired' | 'cancelled'
installments: InstallmentResponseDto[]
```

### `InstallmentResponseDto`
```ts
id: string
installmentNumber: number
dueDate: Date
paidAt: Date | null
status: 'paid' | 'overdue' | 'pending'
```

## Migration Notes

- The existing `client_billings` table will be restructured (columns dropped and added)
- The `UNIQUE` constraint on `client_billings.client_id` will be dropped
- A new `client_billing_installments` table will be created
- Existing data can be cleared (confirmed by team)
- A new migration will handle all DDL changes

## Future Extensibility

The installment model (`ClientBillingInstallmentEntity`) is intentionally not tied to "client contracts" at the entity level — only via FK. This leaves room for future one-off billable services (e.g. a website update billed in installments) to reuse the installment structure under a different parent entity without structural changes.
