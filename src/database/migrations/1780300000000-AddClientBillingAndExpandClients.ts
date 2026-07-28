import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientBillingAndExpandClients1780300000000 implements MigrationInterface {
  name = 'AddClientBillingAndExpandClients1780300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "clients"
        ADD COLUMN IF NOT EXISTS "phone"                   character varying(20),
        ADD COLUMN IF NOT EXISTS "whatsapp_group_code"     character varying(200),
        ADD COLUMN IF NOT EXISTS "google_drive_folder_url" text
    `);

    await queryRunner.query(`CREATE TYPE "billing_type"        AS ENUM ('monthly', 'quarterly', 'semiannual', 'annual')`);
    await queryRunner.query(`CREATE TYPE "payment_method_enum" AS ENUM ('pix', 'boleto', 'debit', 'credit')`);
    await queryRunner.query(`CREATE TYPE "billing_status"      AS ENUM ('paid', 'pending', 'overdue')`);
    await queryRunner.query(`CREATE TYPE "discount_type"       AS ENUM ('fixed', 'percentage')`);

    await queryRunner.query(`
      CREATE TABLE "client_billings" (
        "id"             uuid                    NOT NULL DEFAULT gen_random_uuid(),
        "created_at"     TIMESTAMP               NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP               NOT NULL DEFAULT now(),
        "deleted_at"     TIMESTAMP,
        "client_id"      uuid                    NOT NULL,
        "type"           "billing_type"          NOT NULL,
        "amount"         numeric(10,2)           NOT NULL,
        "discount_type"  "discount_type",
        "discount_value" numeric(10,2),
        "payment_method" "payment_method_enum"   NOT NULL,
        "due_day"        integer                 NOT NULL CHECK ("due_day" BETWEEN 1 AND 31),
        "status"         "billing_status"        NOT NULL,
        "last_paid_at"   TIMESTAMPTZ,
        CONSTRAINT "PK_client_billings"           PRIMARY KEY ("id"),
        CONSTRAINT "UQ_client_billings_client_id" UNIQUE ("client_id"),
        CONSTRAINT "FK_client_billings_client_id" FOREIGN KEY ("client_id")
          REFERENCES "clients"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "client_billings"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "discount_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "billing_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payment_method_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "billing_type"`);
    await queryRunner.query(`
      ALTER TABLE "clients"
        DROP COLUMN IF EXISTS "google_drive_folder_url",
        DROP COLUMN IF EXISTS "whatsapp_group_code",
        DROP COLUMN IF EXISTS "phone"
    `);
  }
}
