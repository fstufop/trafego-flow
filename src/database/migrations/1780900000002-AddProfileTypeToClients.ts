import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProfileTypeToClients1780900000002 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_profile_type_enum') THEN
          CREATE TYPE "client_profile_type_enum" AS ENUM ('site_sales', 'message_sales', 'live_sales');
        END IF;
      END $$;
    `);
    await runner.query(`
      ALTER TABLE "clients"
      ADD COLUMN IF NOT EXISTS "profile_type" "client_profile_type_enum"
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE "clients" DROP COLUMN IF EXISTS "profile_type"`);
    await runner.query(`DROP TYPE IF EXISTS "client_profile_type_enum"`);
  }
}
