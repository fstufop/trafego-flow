import { MigrationInterface, QueryRunner } from 'typeorm';

const TABLES = [
  'clients',
  'integrations',
  'ad_accounts',
  'whatsapp_groups',
  'whatsapp_sessions',
  'report_dispatch_logs',
  'whatsapp_auth_keys',
  'users',
  'client_billings',
];

export class RenameTimestampColumnsToSnakeCase1780500000000 implements MigrationInterface {
  name = 'RenameTimestampColumnsToSnakeCase1780500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      await queryRunner.query(`ALTER TABLE "${table}" RENAME COLUMN "createdAt" TO "created_at"`);
      await queryRunner.query(`ALTER TABLE "${table}" RENAME COLUMN "updatedAt" TO "updated_at"`);
      await queryRunner.query(`ALTER TABLE "${table}" RENAME COLUMN "deletedAt" TO "deleted_at"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [...TABLES].reverse()) {
      await queryRunner.query(`ALTER TABLE "${table}" RENAME COLUMN "deleted_at" TO "deletedAt"`);
      await queryRunner.query(`ALTER TABLE "${table}" RENAME COLUMN "updated_at" TO "updatedAt"`);
      await queryRunner.query(`ALTER TABLE "${table}" RENAME COLUMN "created_at" TO "createdAt"`);
    }
  }
}
