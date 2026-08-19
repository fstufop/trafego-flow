# Client Billing Contract & Installment Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `ClientBillingEntity` to support multi-month contracts with auto-generated monthly installments, individual installment payment tracking, and contract renewal history per client.

**Architecture:** A new `ClientBillingInstallmentEntity` stores one row per installment; the `ClientBillingEntity` is restructured (removes global status/type, adds startDate/durationMonths/contractStatus); a new `ClientBillingService` owns all billing use cases; billing endpoints are added to `ClientsController`.

**Tech Stack:** NestJS 11, TypeORM, PostgreSQL, class-validator, Jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-08-18-client-billing-contract-redesign.md`

## Global Constraints

- TypeScript strict mode; no `any` unless already present in the file.
- All new files use `.js` extension in import paths (ESM/NodeNext).
- Decimal DB columns use the existing `decimalTransformer` pattern from `client-billing.entity.ts`.
- `dueDay` valid range: 1–30 (spec). For months with fewer days, clamp to last day of that month.
- One active contract per client at a time (enforced in service layer).
- All billing+installment writes must use a TypeORM `DataSource` transaction.
- Existing data may be cleared; migration may TRUNCATE before restructuring.
- Run `npm run lint` and `npm run test` before each commit.

---

## File Map

**New files:**
| Path | Responsibility |
|---|---|
| `src/database/migrations/1781000000000-RedesignClientBilling.ts` | DDL: restructure `client_billings`, create `client_billing_installments` |
| `src/modules/clients/entities/client-billing-installment.entity.ts` | TypeORM entity for installment rows |
| `src/modules/clients/dto/renew-client-billing.dto.ts` | Input DTO for contract renewal |
| `src/modules/clients/dto/client-billing-response.dto.ts` | Response interfaces + helper functions (toDto, computeStatus) |
| `src/modules/clients/billing/installment-dates.helper.ts` | Pure function: generate N due dates from startDate + dueDay |
| `src/modules/clients/billing/installment-dates.helper.spec.ts` | Unit tests for the date helper |
| `src/modules/clients/billing/client-billing.service.ts` | All billing use cases (create, list, active, renew, cancel, pay) |
| `src/modules/clients/billing/client-billing.service.spec.ts` | Unit tests for ClientBillingService |

**Modified files:**
| Path | Change |
|---|---|
| `src/modules/clients/entities/client-billing.entity.ts` | Remove BillingType/BillingStatus/lastPaidAt; add ContractStatus, startDate, durationMonths; ManyToOne |
| `src/modules/clients/entities/client.entity.ts` | OneToOne billing → OneToMany billings |
| `src/modules/clients/dto/create-client-billing.dto.ts` | Replace type/status with startDate/durationMonths; dueDay max 30 |
| `src/modules/clients/dto/create-client.dto.ts` | Remove optional `billing` field |
| `src/modules/clients/dto/update-client.dto.ts` | Remove `billing` and `UpdateClientBillingDto` |
| `src/modules/clients/clients.service.ts` | Remove all billing handling; remove billing from relations |
| `src/modules/clients/interfaces/clients-service.interface.ts` | No billing methods needed (billing has its own service) |
| `src/modules/clients/clients.controller.ts` | Inject ClientBillingService; add 6 billing endpoints |
| `src/modules/clients/clients.module.ts` | Add ClientBillingInstallmentEntity + ClientBillingService |

---

## Task 1: Database Migration

**Files:**
- Create: `src/database/migrations/1781000000000-RedesignClientBilling.ts`

**Interfaces:**
- Produces: `client_billings` table with columns `start_date DATE`, `duration_months INTEGER`, `contract_status contract_status_enum`; new `client_billing_installments` table.

- [ ] **Step 1: Create the migration file**

```ts
// src/database/migrations/1781000000000-RedesignClientBilling.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class RedesignClientBilling1781000000000 implements MigrationInterface {
  name = 'RedesignClientBilling1781000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Clear existing data (confirmed by team)
    await queryRunner.query(`TRUNCATE TABLE "client_billings" CASCADE`);

    // Drop old constraint and columns
    await queryRunner.query(`ALTER TABLE "client_billings" DROP CONSTRAINT IF EXISTS "UQ_client_billings_client_id"`);
    await queryRunner.query(`ALTER TABLE "client_billings" DROP CONSTRAINT IF EXISTS "client_billings_due_day_check"`);
    await queryRunner.query(`ALTER TABLE "client_billings" DROP COLUMN IF EXISTS "type"`);
    await queryRunner.query(`ALTER TABLE "client_billings" DROP COLUMN IF EXISTS "status"`);
    await queryRunner.query(`ALTER TABLE "client_billings" DROP COLUMN IF EXISTS "last_paid_at"`);

    // Drop old enums no longer needed
    await queryRunner.query(`DROP TYPE IF EXISTS "billing_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "billing_status"`);

    // New enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "contract_status" AS ENUM ('active', 'expired', 'cancelled');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `);

    // Add new columns
    await queryRunner.query(`
      ALTER TABLE "client_billings"
        ADD COLUMN "start_date"       DATE             NOT NULL DEFAULT CURRENT_DATE,
        ADD COLUMN "duration_months"  INTEGER          NOT NULL DEFAULT 1,
        ADD COLUMN "contract_status"  "contract_status" NOT NULL DEFAULT 'active',
        ADD CONSTRAINT "client_billings_due_day_check" CHECK ("due_day" BETWEEN 1 AND 30),
        ADD CONSTRAINT "client_billings_duration_check" CHECK ("duration_months" BETWEEN 1 AND 12)
    `);

    // Remove defaults (only needed for the ALTER ADD on existing rows that were just cleared)
    await queryRunner.query(`
      ALTER TABLE "client_billings"
        ALTER COLUMN "start_date"      DROP DEFAULT,
        ALTER COLUMN "duration_months" DROP DEFAULT,
        ALTER COLUMN "contract_status" DROP DEFAULT
    `);

    // Create installments table
    await queryRunner.query(`
      CREATE TABLE "client_billing_installments" (
        "id"                  uuid          NOT NULL DEFAULT gen_random_uuid(),
        "created_at"          TIMESTAMP     NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP     NOT NULL DEFAULT now(),
        "deleted_at"          TIMESTAMP,
        "client_billing_id"   uuid          NOT NULL,
        "installment_number"  INTEGER       NOT NULL,
        "due_date"            DATE          NOT NULL,
        "paid_at"             TIMESTAMPTZ,
        CONSTRAINT "PK_client_billing_installments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_billing_installment_number" UNIQUE ("client_billing_id", "installment_number"),
        CONSTRAINT "FK_installments_billing" FOREIGN KEY ("client_billing_id")
          REFERENCES "client_billings"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "client_billing_installments"`);

    await queryRunner.query(`ALTER TABLE "client_billings" DROP CONSTRAINT IF EXISTS "client_billings_duration_check"`);
    await queryRunner.query(`ALTER TABLE "client_billings" DROP CONSTRAINT IF EXISTS "client_billings_due_day_check"`);
    await queryRunner.query(`ALTER TABLE "client_billings" DROP COLUMN IF EXISTS "start_date"`);
    await queryRunner.query(`ALTER TABLE "client_billings" DROP COLUMN IF EXISTS "duration_months"`);
    await queryRunner.query(`ALTER TABLE "client_billings" DROP COLUMN IF EXISTS "contract_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "contract_status"`);

    await queryRunner.query(`
      DO $$ BEGIN CREATE TYPE "billing_type" AS ENUM ('monthly','quarterly','semiannual','annual');
      EXCEPTION WHEN duplicate_object THEN null; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN CREATE TYPE "billing_status" AS ENUM ('paid','pending','overdue');
      EXCEPTION WHEN duplicate_object THEN null; END $$
    `);
    await queryRunner.query(`
      ALTER TABLE "client_billings"
        ADD COLUMN IF NOT EXISTS "type"         "billing_type"  NOT NULL DEFAULT 'monthly',
        ADD COLUMN IF NOT EXISTS "status"       "billing_status" NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS "last_paid_at" TIMESTAMPTZ,
        ADD CONSTRAINT "UQ_client_billings_client_id" UNIQUE ("client_id"),
        ADD CONSTRAINT "client_billings_due_day_check" CHECK ("due_day" BETWEEN 1 AND 31)
    `);
  }
}
```

- [ ] **Step 2: Run the migration**

```bash
npm run build && npm run migration
```

Expected: migration runs without errors; `client_billing_installments` table exists.

- [ ] **Step 3: Commit**

```bash
git add src/database/migrations/1781000000000-RedesignClientBilling.ts
git commit -m "feat: migration — redesign client_billings and add client_billing_installments"
```

---

## Task 2: Update TypeORM Entities

**Files:**
- Modify: `src/modules/clients/entities/client-billing.entity.ts`
- Modify: `src/modules/clients/entities/client.entity.ts`
- Create: `src/modules/clients/entities/client-billing-installment.entity.ts`

**Interfaces:**
- Produces: `ClientBillingEntity` with fields `startDate`, `durationMonths`, `contractStatus: ContractStatus`; `ClientBillingInstallmentEntity` with fields `clientBillingId`, `installmentNumber`, `dueDate`, `paidAt`; enums `ContractStatus`, `PaymentMethod`, `DiscountType`.

- [ ] **Step 1: Rewrite `client-billing.entity.ts`**

```ts
// src/modules/clients/entities/client-billing.entity.ts
import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { ClientEntity } from './client.entity.js';
import { ClientBillingInstallmentEntity } from './client-billing-installment.entity.js';

export enum ContractStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export enum PaymentMethod {
  PIX = 'pix',
  BOLETO = 'boleto',
  DEBIT = 'debit',
  CREDIT = 'credit',
}

export enum DiscountType {
  FIXED = 'fixed',
  PERCENTAGE = 'percentage',
}

const decimalTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value != null ? parseFloat(value) : null),
};

@Entity('client_billings')
export class ClientBillingEntity extends BaseEntity {
  @Column({ name: 'client_id' })
  clientId: string;

  @ManyToOne(() => ClientEntity, (client) => client.billings)
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ name: 'start_date', type: 'date' })
  startDate: Date;

  @Column({ name: 'duration_months' })
  durationMonths: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, transformer: decimalTransformer })
  amount: number;

  @Column({ name: 'discount_type', type: 'enum', enum: DiscountType, nullable: true })
  discountType: DiscountType | null;

  @Column({
    name: 'discount_value',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  discountValue: number | null;

  @Column({ name: 'payment_method', type: 'enum', enum: PaymentMethod })
  paymentMethod: PaymentMethod;

  @Column({ name: 'due_day' })
  dueDay: number;

  @Column({ name: 'contract_status', type: 'enum', enum: ContractStatus })
  contractStatus: ContractStatus;

  @OneToMany(() => ClientBillingInstallmentEntity, (inst) => inst.billing, { cascade: true })
  installments: ClientBillingInstallmentEntity[];
}
```

- [ ] **Step 2: Create `client-billing-installment.entity.ts`**

```ts
// src/modules/clients/entities/client-billing-installment.entity.ts
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { ClientBillingEntity } from './client-billing.entity.js';

@Entity('client_billing_installments')
export class ClientBillingInstallmentEntity extends BaseEntity {
  @Column({ name: 'client_billing_id' })
  clientBillingId: string;

  @ManyToOne(() => ClientBillingEntity, (billing) => billing.installments)
  @JoinColumn({ name: 'client_billing_id' })
  billing: ClientBillingEntity;

  @Column({ name: 'installment_number' })
  installmentNumber: number;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;
}
```

- [ ] **Step 3: Update `client.entity.ts`** — change OneToOne to OneToMany

```ts
// src/modules/clients/entities/client.entity.ts
import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { ClientBillingEntity } from './client-billing.entity.js';
import { ClientProfileType } from '../enums/client-profile-type.enum.js';

@Entity('clients')
export class ClientEntity extends BaseEntity {
  @Column({ length: 200 })
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ name: 'whatsapp_group_code', type: 'varchar', length: 200, nullable: true })
  whatsappGroupCode: string | null;

  @Column({ name: 'google_drive_folder_url', type: 'text', nullable: true })
  googleDriveFolderUrl: string | null;

  @Column({ name: 'ai_strategy_context', type: 'text', nullable: true })
  aiStrategyContext: string | null;

  @Column({ type: 'enum', enum: ClientProfileType, nullable: true, name: 'profile_type' })
  profileType: ClientProfileType | null;

  @OneToMany(() => ClientBillingEntity, (billing) => billing.client)
  billings: ClientBillingEntity[];
}
```

- [ ] **Step 4: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/clients/entities/
git commit -m "feat: update entities — ClientBillingEntity redesign, new ClientBillingInstallmentEntity"
```

---

## Task 3: DTOs and Response Types

**Files:**
- Modify: `src/modules/clients/dto/create-client-billing.dto.ts`
- Modify: `src/modules/clients/dto/create-client.dto.ts`
- Modify: `src/modules/clients/dto/update-client.dto.ts`
- Create: `src/modules/clients/dto/renew-client-billing.dto.ts`
- Create: `src/modules/clients/dto/client-billing-response.dto.ts`

**Interfaces:**
- Produces: `CreateClientBillingDto` (startDate, durationMonths, amount, dueDay, paymentMethod, optional discounts); `RenewClientBillingDto` (startDate, durationMonths required; rest optional); `InstallmentResponseDto` and `ClientBillingResponseDto` interfaces; `toClientBillingResponseDto()` and `toInstallmentResponseDto()` named exports from `client-billing-response.dto.ts`.

- [ ] **Step 1: Rewrite `create-client-billing.dto.ts`**

```ts
// src/modules/clients/dto/create-client-billing.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { DiscountType, PaymentMethod } from '../entities/client-billing.entity.js';

export class CreateClientBillingDto {
  @ApiProperty({ example: '2026-01-15', description: 'Contract start date' })
  @Type(() => Date)
  @IsDate()
  startDate: Date;

  @ApiProperty({ example: 6, description: 'Contract duration in months (1–12)' })
  @IsInt()
  @Min(1)
  @Max(12)
  durationMonths: number;

  @ApiProperty({ example: 1500.0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @ApiProperty({ example: 10, description: 'Due day of month (1–30)' })
  @IsInt()
  @Min(1)
  @Max(30)
  dueDay: number;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.PIX })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiPropertyOptional({ enum: DiscountType })
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @ApiPropertyOptional({ example: 100.0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  discountValue?: number;
}
```

- [ ] **Step 2: Create `renew-client-billing.dto.ts`**

```ts
// src/modules/clients/dto/renew-client-billing.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { DiscountType, PaymentMethod } from '../entities/client-billing.entity.js';

export class RenewClientBillingDto {
  @ApiProperty({ example: '2026-07-01', description: 'New contract start date' })
  @Type(() => Date)
  @IsDate()
  startDate: Date;

  @ApiProperty({ example: 6, description: 'Contract duration in months (1–12)' })
  @IsInt()
  @Min(1)
  @Max(12)
  durationMonths: number;

  @ApiPropertyOptional({ example: 1500.0, description: 'Inherits from previous contract if omitted' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  amount?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  dueDay?: number;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ enum: DiscountType })
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @ApiPropertyOptional({ example: 100.0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  discountValue?: number;
}
```

- [ ] **Step 3: Create `client-billing-response.dto.ts`**

```ts
// src/modules/clients/dto/client-billing-response.dto.ts
import { ContractStatus, DiscountType, PaymentMethod } from '../entities/client-billing.entity.js';
import { ClientBillingEntity } from '../entities/client-billing.entity.js';
import { ClientBillingInstallmentEntity } from '../entities/client-billing-installment.entity.js';

export type InstallmentStatus = 'paid' | 'overdue' | 'pending';

export interface InstallmentResponseDto {
  id: string;
  installmentNumber: number;
  dueDate: Date;
  paidAt: Date | null;
  status: InstallmentStatus;
}

export interface ClientBillingResponseDto {
  id: string;
  clientId: string;
  startDate: Date;
  durationMonths: number;
  amount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  paymentMethod: PaymentMethod;
  dueDay: number;
  contractStatus: ContractStatus;
  installments: InstallmentResponseDto[];
}

export function computeInstallmentStatus(installment: ClientBillingInstallmentEntity): InstallmentStatus {
  if (installment.paidAt) return 'paid';
  const due = installment.dueDate instanceof Date ? installment.dueDate : new Date(installment.dueDate);
  if (due < new Date()) return 'overdue';
  return 'pending';
}

export function toInstallmentResponseDto(installment: ClientBillingInstallmentEntity): InstallmentResponseDto {
  return {
    id: installment.id,
    installmentNumber: installment.installmentNumber,
    dueDate: installment.dueDate,
    paidAt: installment.paidAt,
    status: computeInstallmentStatus(installment),
  };
}

export function toClientBillingResponseDto(
  billing: ClientBillingEntity,
  installments: ClientBillingInstallmentEntity[],
): ClientBillingResponseDto {
  return {
    id: billing.id,
    clientId: billing.clientId,
    startDate: billing.startDate,
    durationMonths: billing.durationMonths,
    amount: billing.amount,
    discountType: billing.discountType,
    discountValue: billing.discountValue,
    paymentMethod: billing.paymentMethod,
    dueDay: billing.dueDay,
    contractStatus: billing.contractStatus,
    installments: [...installments]
      .sort((a, b) => a.installmentNumber - b.installmentNumber)
      .map(toInstallmentResponseDto),
  };
}
```

- [ ] **Step 4: Update `create-client.dto.ts`** — remove the optional billing field

Replace the file content with:

```ts
// src/modules/clients/dto/create-client.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ClientProfileType } from '../enums/client-profile-type.enum.js';

export class CreateClientDto {
  @ApiProperty({ example: 'Agência XYZ', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({ example: 'contato@agenciaxyz.com.br' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: '(32) 99999-0000' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: '120363000000000000@g.us' })
  @IsOptional()
  @IsString()
  whatsappGroupCode?: string;

  @ApiPropertyOptional({ example: 'https://drive.google.com/drive/folders/xxx' })
  @IsOptional()
  @IsString()
  googleDriveFolderUrl?: string;

  @ApiPropertyOptional({ enum: ClientProfileType, example: ClientProfileType.SITE_SALES })
  @IsOptional()
  @IsEnum(ClientProfileType)
  profileType?: ClientProfileType;
}
```

- [ ] **Step 5: Update `update-client.dto.ts`** — remove billing

```ts
// src/modules/clients/dto/update-client.dto.ts
import { PartialType } from '@nestjs/swagger';
import { CreateClientDto } from './create-client.dto.js';

export class UpdateClientDto extends PartialType(CreateClientDto) {}
```

- [ ] **Step 6: Build to verify**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/clients/dto/
git commit -m "feat: update DTOs — new billing input/response types, remove billing from client DTOs"
```

---

## Task 4: Installment Date Helper (TDD)

**Files:**
- Create: `src/modules/clients/billing/installment-dates.helper.ts`
- Create: `src/modules/clients/billing/installment-dates.helper.spec.ts`

**Interfaces:**
- Produces: `generateInstallmentDates(startDate: Date, dueDay: number, durationMonths: number): Date[]` — returns an array of `durationMonths` Date objects representing each installment's due date.

- [ ] **Step 1: Write the failing tests**

```ts
// src/modules/clients/billing/installment-dates.helper.spec.ts
import { generateInstallmentDates } from './installment-dates.helper.js';

describe('generateInstallmentDates', () => {
  it('starts next month when dueDay is before startDate day', () => {
    // startDate Jan 15, dueDay 10 → first due Feb 10
    const result = generateInstallmentDates(new Date(2026, 0, 15), 10, 3);
    expect(result).toEqual([new Date(2026, 1, 10), new Date(2026, 2, 10), new Date(2026, 3, 10)]);
  });

  it('starts current month when dueDay is after startDate day', () => {
    // startDate Jan 5, dueDay 10 → first due Jan 10
    const result = generateInstallmentDates(new Date(2026, 0, 5), 10, 3);
    expect(result).toEqual([new Date(2026, 0, 10), new Date(2026, 1, 10), new Date(2026, 2, 10)]);
  });

  it('starts next month when dueDay equals startDate day', () => {
    // dueDay on the same day as startDate: use next month
    const result = generateInstallmentDates(new Date(2026, 0, 10), 10, 1);
    expect(result).toEqual([new Date(2026, 1, 10)]);
  });

  it('clamps to Feb 28 for dueDay 30 in a non-leap year', () => {
    const result = generateInstallmentDates(new Date(2026, 0, 1), 30, 2);
    expect(result[0]).toEqual(new Date(2026, 0, 30)); // Jan 30 exists
    expect(result[1]).toEqual(new Date(2026, 1, 28)); // Feb 28 in 2026
  });

  it('clamps to Feb 29 for dueDay 30 in a leap year', () => {
    const result = generateInstallmentDates(new Date(2028, 0, 1), 30, 2);
    expect(result[0]).toEqual(new Date(2028, 0, 30));
    expect(result[1]).toEqual(new Date(2028, 1, 29)); // 2028 is a leap year
  });

  it('wraps correctly across year boundary', () => {
    const result = generateInstallmentDates(new Date(2026, 10, 1), 15, 3);
    expect(result).toEqual([
      new Date(2026, 10, 15), // Nov 15
      new Date(2026, 11, 15), // Dec 15
      new Date(2027, 0, 15),  // Jan 15
    ]);
  });

  it('generates exactly durationMonths installments', () => {
    const result = generateInstallmentDates(new Date(2026, 0, 1), 10, 12);
    expect(result).toHaveLength(12);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest --testPathPattern=installment-dates.helper.spec
```

Expected: all tests FAIL with "Cannot find module".

- [ ] **Step 3: Implement the helper**

```ts
// src/modules/clients/billing/installment-dates.helper.ts

export function generateInstallmentDates(startDate: Date, dueDay: number, durationMonths: number): Date[] {
  const clampedDueDay = Math.min(dueDay, 30);
  let year = startDate.getFullYear();
  let month = startDate.getMonth(); // 0-indexed

  // Find first installment month: dueDay must fall strictly after startDate
  const candidate = dateForMonth(year, month, clampedDueDay);
  if (candidate <= startDate) {
    month += 1;
    if (month > 11) { month = 0; year++; }
  }

  const dates: Date[] = [];
  for (let i = 0; i < durationMonths; i++) {
    const totalMonths = month + i;
    const y = year + Math.floor(totalMonths / 12);
    const m = totalMonths % 12;
    dates.push(dateForMonth(y, m, clampedDueDay));
  }
  return dates;
}

function dateForMonth(year: number, month: number, targetDay: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(targetDay, lastDay));
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx jest --testPathPattern=installment-dates.helper.spec
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/clients/billing/installment-dates.helper.ts src/modules/clients/billing/installment-dates.helper.spec.ts
git commit -m "feat: add installment due date generation helper with tests"
```

---

## Task 5: ClientBillingService (TDD)

**Files:**
- Create: `src/modules/clients/billing/client-billing.service.ts`
- Create: `src/modules/clients/billing/client-billing.service.spec.ts`

**Interfaces:**
- Consumes: `generateInstallmentDates(startDate, dueDay, durationMonths): Date[]`; `toClientBillingResponseDto(billing, installments): ClientBillingResponseDto`; `toInstallmentResponseDto(installment): InstallmentResponseDto`; `ContractStatus`, `ClientBillingEntity`, `ClientBillingInstallmentEntity`, `CreateClientBillingDto`, `RenewClientBillingDto`.
- Produces: `ClientBillingService` injectable with methods: `createBilling(clientId, dto): Promise<ClientBillingResponseDto>`; `listBillings(clientId): Promise<ClientBillingResponseDto[]>`; `getActiveBilling(clientId): Promise<ClientBillingResponseDto>`; `renewBilling(clientId, billingId, dto): Promise<ClientBillingResponseDto>`; `cancelBilling(clientId, billingId): Promise<ClientBillingResponseDto>`; `payInstallment(clientId, billingId, installmentId): Promise<InstallmentResponseDto>`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/modules/clients/billing/client-billing.service.spec.ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClientBillingService } from './client-billing.service.js';
import { ClientBillingEntity, ContractStatus, PaymentMethod } from '../entities/client-billing.entity.js';
import { ClientBillingInstallmentEntity } from '../entities/client-billing-installment.entity.js';
import { CreateClientBillingDto } from '../dto/create-client-billing.dto.js';

const makeBillingRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  update: jest.fn(),
  create: jest.fn((data: unknown) => data),
  save: jest.fn(async (e: unknown) => e),
});

const makeInstallmentRepo = () => ({
  findOne: jest.fn(),
  save: jest.fn(async (e: unknown) => e),
  create: jest.fn((data: unknown) => data),
});

const makeManager = () => ({
  create: jest.fn((_, data: unknown) => ({ id: 'new-id', ...data as object })),
  save: jest.fn(async (e: unknown) => Array.isArray(e)
    ? (e as unknown[]).map((x, i) => ({ id: `inst-${i}`, ...x as object }))
    : { id: 'saved-id', ...e as object }),
  update: jest.fn(),
});

const makeDataSource = (manager = makeManager()) => ({
  transaction: jest.fn((cb: (m: ReturnType<typeof makeManager>) => Promise<unknown>) => cb(manager)),
});

describe('ClientBillingService', () => {
  let service: ClientBillingService;
  let billingRepo: ReturnType<typeof makeBillingRepo>;
  let installmentRepo: ReturnType<typeof makeInstallmentRepo>;

  beforeEach(async () => {
    billingRepo = makeBillingRepo();
    installmentRepo = makeInstallmentRepo();

    const module = await Test.createTestingModule({
      providers: [
        ClientBillingService,
        { provide: getRepositoryToken(ClientBillingEntity), useValue: billingRepo },
        { provide: getRepositoryToken(ClientBillingInstallmentEntity), useValue: installmentRepo },
        { provide: DataSource, useValue: makeDataSource() },
      ],
    }).compile();

    service = module.get(ClientBillingService);
  });

  describe('createBilling', () => {
    const dto: CreateClientBillingDto = {
      startDate: new Date(2026, 0, 1),
      durationMonths: 3,
      dueDay: 10,
      amount: 1500,
      paymentMethod: PaymentMethod.PIX,
    };

    it('throws ConflictException when an active contract already exists', async () => {
      billingRepo.findOne.mockResolvedValue({ id: 'existing', contractStatus: ContractStatus.ACTIVE });
      await expect(service.createBilling('client-1', dto)).rejects.toThrow(ConflictException);
    });

    it('creates contract and generates durationMonths installments', async () => {
      billingRepo.findOne.mockResolvedValue(null);
      const result = await service.createBilling('client-1', dto);
      expect(result.installments).toHaveLength(3);
      expect(result.contractStatus).toBe(ContractStatus.ACTIVE);
    });
  });

  describe('getActiveBilling', () => {
    it('throws NotFoundException when no active contract exists', async () => {
      billingRepo.findOne.mockResolvedValue(null);
      await expect(service.getActiveBilling('client-1')).rejects.toThrow(NotFoundException);
    });

    it('returns the active billing with enriched installment statuses', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 30); // 30 days ahead
      billingRepo.findOne.mockResolvedValue({
        id: 'billing-1',
        clientId: 'client-1',
        startDate: new Date(2026, 0, 1),
        durationMonths: 1,
        amount: 1500,
        discountType: null,
        discountValue: null,
        paymentMethod: PaymentMethod.PIX,
        dueDay: 10,
        contractStatus: ContractStatus.ACTIVE,
        installments: [{ id: 'inst-1', installmentNumber: 1, dueDate: futureDate, paidAt: null }],
      });
      const result = await service.getActiveBilling('client-1');
      expect(result.installments[0].status).toBe('pending');
    });
  });

  describe('renewBilling', () => {
    it('throws NotFoundException when contract not found', async () => {
      billingRepo.findOne.mockResolvedValue(null);
      await expect(
        service.renewBilling('client-1', 'billing-1', { startDate: new Date(), durationMonths: 6 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when contract is not active', async () => {
      billingRepo.findOne.mockResolvedValue({ id: 'billing-1', clientId: 'client-1', contractStatus: ContractStatus.EXPIRED });
      await expect(
        service.renewBilling('client-1', 'billing-1', { startDate: new Date(), durationMonths: 6 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelBilling', () => {
    it('throws NotFoundException when contract not found', async () => {
      billingRepo.findOne.mockResolvedValue(null);
      await expect(service.cancelBilling('client-1', 'billing-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when already cancelled', async () => {
      billingRepo.findOne.mockResolvedValue({
        id: 'billing-1',
        contractStatus: ContractStatus.CANCELLED,
        installments: [],
      });
      await expect(service.cancelBilling('client-1', 'billing-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('payInstallment', () => {
    it('throws NotFoundException when contract not found', async () => {
      billingRepo.findOne.mockResolvedValue(null);
      await expect(service.payInstallment('client-1', 'billing-1', 'inst-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when installment not found', async () => {
      billingRepo.findOne.mockResolvedValue({ id: 'billing-1' });
      installmentRepo.findOne.mockResolvedValue(null);
      await expect(service.payInstallment('client-1', 'billing-1', 'inst-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when installment is already paid', async () => {
      billingRepo.findOne.mockResolvedValue({ id: 'billing-1' });
      installmentRepo.findOne.mockResolvedValue({ id: 'inst-1', paidAt: new Date() });
      await expect(service.payInstallment('client-1', 'billing-1', 'inst-1')).rejects.toThrow(BadRequestException);
    });

    it('sets paidAt and returns paid status', async () => {
      billingRepo.findOne.mockResolvedValue({ id: 'billing-1' });
      const installment = { id: 'inst-1', installmentNumber: 1, dueDate: new Date(2026, 0, 10), paidAt: null };
      installmentRepo.findOne.mockResolvedValue(installment);
      installmentRepo.save.mockResolvedValue({ ...installment, paidAt: new Date() });
      const result = await service.payInstallment('client-1', 'billing-1', 'inst-1');
      expect(result.status).toBe('paid');
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest --testPathPattern=client-billing.service.spec
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `client-billing.service.ts`**

```ts
// src/modules/clients/billing/client-billing.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClientBillingEntity, ContractStatus } from '../entities/client-billing.entity.js';
import { ClientBillingInstallmentEntity } from '../entities/client-billing-installment.entity.js';
import { CreateClientBillingDto } from '../dto/create-client-billing.dto.js';
import { RenewClientBillingDto } from '../dto/renew-client-billing.dto.js';
import {
  ClientBillingResponseDto,
  InstallmentResponseDto,
  toClientBillingResponseDto,
  toInstallmentResponseDto,
} from '../dto/client-billing-response.dto.js';
import { generateInstallmentDates } from './installment-dates.helper.js';

@Injectable()
export class ClientBillingService {
  constructor(
    @InjectRepository(ClientBillingEntity)
    private readonly billingRepo: Repository<ClientBillingEntity>,
    @InjectRepository(ClientBillingInstallmentEntity)
    private readonly installmentRepo: Repository<ClientBillingInstallmentEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async createBilling(clientId: string, dto: CreateClientBillingDto): Promise<ClientBillingResponseDto> {
    const existing = await this.billingRepo.findOne({
      where: { clientId, contractStatus: ContractStatus.ACTIVE },
    });
    if (existing) throw new ConflictException('Client already has an active contract');

    return this.dataSource.transaction(async (manager) => {
      const billing = await manager.save(
        manager.create(ClientBillingEntity, {
          clientId,
          startDate: new Date(dto.startDate),
          durationMonths: dto.durationMonths,
          amount: dto.amount,
          dueDay: dto.dueDay,
          paymentMethod: dto.paymentMethod,
          discountType: dto.discountType ?? null,
          discountValue: dto.discountValue ?? null,
          contractStatus: ContractStatus.ACTIVE,
        }),
      );

      const dueDates = generateInstallmentDates(new Date(dto.startDate), dto.dueDay, dto.durationMonths);
      const installments = await manager.save(
        dueDates.map((dueDate, i) =>
          manager.create(ClientBillingInstallmentEntity, {
            clientBillingId: billing.id,
            installmentNumber: i + 1,
            dueDate,
            paidAt: null,
          }),
        ),
      );

      return toClientBillingResponseDto(billing, installments);
    });
  }

  async listBillings(clientId: string): Promise<ClientBillingResponseDto[]> {
    const billings = await this.billingRepo.find({
      where: { clientId },
      relations: { installments: true },
      order: { createdAt: 'DESC' },
    });
    return billings.map((b) => toClientBillingResponseDto(b, b.installments));
  }

  async getActiveBilling(clientId: string): Promise<ClientBillingResponseDto> {
    const billing = await this.billingRepo.findOne({
      where: { clientId, contractStatus: ContractStatus.ACTIVE },
      relations: { installments: true },
    });
    if (!billing) throw new NotFoundException(`No active contract for client ${clientId}`);
    return toClientBillingResponseDto(billing, billing.installments);
  }

  async renewBilling(
    clientId: string,
    billingId: string,
    dto: RenewClientBillingDto,
  ): Promise<ClientBillingResponseDto> {
    const current = await this.billingRepo.findOne({ where: { id: billingId, clientId } });
    if (!current) throw new NotFoundException(`Contract ${billingId} not found for client ${clientId}`);
    if (current.contractStatus !== ContractStatus.ACTIVE) {
      throw new BadRequestException('Only active contracts can be renewed');
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.update(ClientBillingEntity, { id: billingId }, { contractStatus: ContractStatus.EXPIRED });

      const effectiveDueDay = dto.dueDay ?? current.dueDay;
      const newBilling = await manager.save(
        manager.create(ClientBillingEntity, {
          clientId,
          startDate: new Date(dto.startDate),
          durationMonths: dto.durationMonths,
          amount: dto.amount ?? current.amount,
          dueDay: effectiveDueDay,
          paymentMethod: dto.paymentMethod ?? current.paymentMethod,
          discountType: dto.discountType ?? current.discountType,
          discountValue: dto.discountValue ?? current.discountValue,
          contractStatus: ContractStatus.ACTIVE,
        }),
      );

      const dueDates = generateInstallmentDates(new Date(dto.startDate), effectiveDueDay, dto.durationMonths);
      const installments = await manager.save(
        dueDates.map((dueDate, i) =>
          manager.create(ClientBillingInstallmentEntity, {
            clientBillingId: newBilling.id,
            installmentNumber: i + 1,
            dueDate,
            paidAt: null,
          }),
        ),
      );

      return toClientBillingResponseDto(newBilling, installments);
    });
  }

  async cancelBilling(clientId: string, billingId: string): Promise<ClientBillingResponseDto> {
    const billing = await this.billingRepo.findOne({
      where: { id: billingId, clientId },
      relations: { installments: true },
    });
    if (!billing) throw new NotFoundException(`Contract ${billingId} not found for client ${clientId}`);
    if (billing.contractStatus === ContractStatus.CANCELLED) {
      throw new BadRequestException('Contract is already cancelled');
    }

    await this.billingRepo.update({ id: billingId }, { contractStatus: ContractStatus.CANCELLED });
    billing.contractStatus = ContractStatus.CANCELLED;
    return toClientBillingResponseDto(billing, billing.installments);
  }

  async payInstallment(
    clientId: string,
    billingId: string,
    installmentId: string,
  ): Promise<InstallmentResponseDto> {
    const billing = await this.billingRepo.findOne({ where: { id: billingId, clientId } });
    if (!billing) throw new NotFoundException(`Contract ${billingId} not found for client ${clientId}`);

    const installment = await this.installmentRepo.findOne({
      where: { id: installmentId, clientBillingId: billingId },
    });
    if (!installment) throw new NotFoundException(`Installment ${installmentId} not found`);
    if (installment.paidAt) throw new BadRequestException('Installment is already paid');

    installment.paidAt = new Date();
    const saved = await this.installmentRepo.save(installment);
    return toInstallmentResponseDto(saved);
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx jest --testPathPattern=client-billing.service.spec
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/clients/billing/
git commit -m "feat: add ClientBillingService with contract lifecycle and installment management"
```

---

## Task 6: Clean Up ClientsService

**Files:**
- Modify: `src/modules/clients/clients.service.ts`
- Modify: `src/modules/clients/interfaces/clients-service.interface.ts`

**Interfaces:**
- Produces: `ClientsService` methods `create`, `findAll`, `findOne`, `update`, `remove`, `clearCache` — all without any billing handling; `findAll` and `findOne` no longer load billing relation.

- [ ] **Step 1: Rewrite `clients.service.ts`** — remove all billing handling

```ts
// src/modules/clients/clients.service.ts
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { ClientEntity } from './entities/client.entity.js';
import { IClientsService } from './interfaces/clients-service.interface.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

const cacheKey = (id: string) => `client:id:${id}`;

@Injectable()
export class ClientsService implements IClientsService {
  constructor(
    @InjectRepository(ClientEntity)
    private readonly repo: Repository<ClientEntity>,
    @Inject(CACHE_MANAGER)
    private readonly cache: Cache,
  ) {}

  async create(dto: CreateClientDto): Promise<ClientEntity> {
    try {
      return await this.repo.save(this.repo.create(dto));
    } catch (err) {
      if (err instanceof QueryFailedError && (err as QueryFailedError & { code: string }).code === '23505') {
        throw new ConflictException('A client with this email already exists');
      }
      throw err;
    }
  }

  findAll(): Promise<ClientEntity[]> {
    return this.repo.find({ where: { isActive: true } });
  }

  async findOne(id: string): Promise<ClientEntity> {
    const cached = await this.cache.get<ClientEntity>(cacheKey(id));
    if (cached) return cached;

    const client = await this.repo.findOne({ where: { id } });
    if (!client) throw new NotFoundException(`Client ${id} not found`);

    await this.cache.set(cacheKey(id), client);
    return client;
  }

  async update(id: string, dto: UpdateClientDto): Promise<ClientEntity> {
    const client = await this.findOne(id);
    await this.repo.save({ ...client, ...dto });
    await this.cache.del(cacheKey(id));
    return this.repo.findOne({ where: { id } }) as Promise<ClientEntity>;
  }

  async remove(id: string): Promise<void> {
    const client = await this.findOne(id);
    await this.repo.softRemove(client);
    await this.cache.del(cacheKey(id));
  }

  async clearCache(id: string): Promise<void> {
    await this.cache.del(cacheKey(id));
  }
}
```

- [ ] **Step 2: Update `clients-service.interface.ts`**

```ts
// src/modules/clients/interfaces/clients-service.interface.ts
import { ClientEntity } from '../entities/client.entity.js';
import { CreateClientDto } from '../dto/create-client.dto.js';
import { UpdateClientDto } from '../dto/update-client.dto.js';

export interface IClientsService {
  create(dto: CreateClientDto): Promise<ClientEntity>;
  findAll(): Promise<ClientEntity[]>;
  findOne(id: string): Promise<ClientEntity>;
  update(id: string, dto: UpdateClientDto): Promise<ClientEntity>;
  remove(id: string): Promise<void>;
  clearCache(id: string): Promise<void>;
}
```

- [ ] **Step 3: Build and lint**

```bash
npm run build && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/clients/clients.service.ts src/modules/clients/interfaces/clients-service.interface.ts
git commit -m "refactor: remove billing handling from ClientsService"
```

---

## Task 7: Controller — Add Billing Endpoints

**Files:**
- Modify: `src/modules/clients/clients.controller.ts`

**Interfaces:**
- Consumes: `ClientBillingService` with methods `createBilling`, `listBillings`, `getActiveBilling`, `renewBilling`, `cancelBilling`, `payInstallment`; `CreateClientBillingDto`; `RenewClientBillingDto`.
- Produces: 6 new HTTP endpoints under `/clients/:id/billing/*`.

- [ ] **Step 1: Rewrite `clients.controller.ts`** with new billing endpoints

```ts
// src/modules/clients/clients.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { ClientsService } from './clients.service.js';
import { ClientBillingService } from './billing/client-billing.service.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';
import { CreateClientBillingDto } from './dto/create-client-billing.dto.js';
import { RenewClientBillingDto } from './dto/renew-client-billing.dto.js';

@ApiTags('clients')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(AuthGuard)
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly billingService: ClientBillingService,
  ) {}

  // ── Client CRUD ──────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new client' })
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all active clients' })
  findAll() {
    return this.clientsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a client by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a client' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete a client' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.remove(id);
  }

  @Delete(':id/cache')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Invalidate cached data for a client' })
  clearCache(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.clearCache(id);
  }

  // ── Billing ───────────────────────────────────────────────────────────────

  @Post(':id/billing')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a contract for a client' })
  createBilling(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateClientBillingDto,
  ) {
    return this.billingService.createBilling(id, dto);
  }

  @Get(':id/billing')
  @ApiOperation({ summary: 'List all contracts for a client' })
  listBillings(@Param('id', ParseUUIDPipe) id: string) {
    return this.billingService.listBillings(id);
  }

  @Get(':id/billing/active')
  @ApiOperation({ summary: 'Get the active contract for a client' })
  getActiveBilling(@Param('id', ParseUUIDPipe) id: string) {
    return this.billingService.getActiveBilling(id);
  }

  @Post(':id/billing/:billingId/renew')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Renew a contract' })
  renewBilling(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('billingId', ParseUUIDPipe) billingId: string,
    @Body() dto: RenewClientBillingDto,
  ) {
    return this.billingService.renewBilling(id, billingId, dto);
  }

  @Patch(':id/billing/:billingId/cancel')
  @ApiOperation({ summary: 'Cancel a contract' })
  cancelBilling(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('billingId', ParseUUIDPipe) billingId: string,
  ) {
    return this.billingService.cancelBilling(id, billingId);
  }

  @Patch(':id/billing/:billingId/installments/:installmentId/pay')
  @ApiOperation({ summary: 'Mark an installment as paid' })
  payInstallment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('billingId', ParseUUIDPipe) billingId: string,
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
  ) {
    return this.billingService.payInstallment(id, billingId, installmentId);
  }
}
```

- [ ] **Step 2: Build to verify**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/clients/clients.controller.ts
git commit -m "feat: add billing endpoints to ClientsController"
```

---

## Task 8: Module Wiring

**Files:**
- Modify: `src/modules/clients/clients.module.ts`

**Interfaces:**
- Consumes: `ClientBillingInstallmentEntity`, `ClientBillingService` (from previous tasks).
- Produces: `ClientsModule` with all three entities registered and `ClientBillingService` as a provider.

- [ ] **Step 1: Update `clients.module.ts`**

```ts
// src/modules/clients/clients.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientEntity } from './entities/client.entity.js';
import { ClientBillingEntity } from './entities/client-billing.entity.js';
import { ClientBillingInstallmentEntity } from './entities/client-billing-installment.entity.js';
import { ClientsController } from './clients.controller.js';
import { ClientsService } from './clients.service.js';
import { ClientBillingService } from './billing/client-billing.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ClientEntity, ClientBillingEntity, ClientBillingInstallmentEntity]),
  ],
  controllers: [ClientsController],
  providers: [ClientsService, ClientBillingService],
  exports: [ClientsService, ClientBillingService],
})
export class ClientsModule {}
```

- [ ] **Step 2: Run full test suite and build**

```bash
npm run build && npm run test
```

Expected: all tests pass; build succeeds.

- [ ] **Step 3: Start dev server and smoke-test the endpoints manually**

```bash
npm run start:dev
```

Verify with curl or Swagger UI (`/api`):
1. `POST /clients/:id/billing` — creates contract + installments
2. `GET /clients/:id/billing/active` — returns active contract with installment statuses
3. `PATCH /clients/:id/billing/:billingId/installments/:installmentId/pay` — marks installment paid
4. `POST /clients/:id/billing/:billingId/renew` — expires current, creates new contract
5. `PATCH /clients/:id/billing/:billingId/cancel` — cancels contract

- [ ] **Step 4: Commit**

```bash
git add src/modules/clients/clients.module.ts
git commit -m "feat: wire ClientBillingService and ClientBillingInstallmentEntity into ClientsModule"
```
