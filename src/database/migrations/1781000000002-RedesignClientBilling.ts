import { MigrationInterface, QueryRunner } from 'typeorm';

export class RedesignClientBilling1781000000000 implements MigrationInterface {
  name = 'RedesignClientBilling1781000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Clear existing data (confirmed by team)
    await queryRunner.query(`TRUNCATE TABLE "client_billings" CASCADE`);

    // Drop old constraint and columns
    await queryRunner.query(
      `ALTER TABLE "client_billings" DROP CONSTRAINT IF EXISTS "UQ_client_billings_client_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_billings" DROP CONSTRAINT IF EXISTS "client_billings_due_day_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_billings" DROP COLUMN IF EXISTS "type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_billings" DROP COLUMN IF EXISTS "status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_billings" DROP COLUMN IF EXISTS "last_paid_at"`,
    );

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
    await queryRunner.query(
      `DROP TABLE IF EXISTS "client_billing_installments"`,
    );

    await queryRunner.query(
      `ALTER TABLE "client_billings" DROP CONSTRAINT IF EXISTS "client_billings_duration_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_billings" DROP CONSTRAINT IF EXISTS "client_billings_due_day_check"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_billings" DROP COLUMN IF EXISTS "start_date"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_billings" DROP COLUMN IF EXISTS "duration_months"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_billings" DROP COLUMN IF EXISTS "contract_status"`,
    );
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
