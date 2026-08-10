import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdsetAlertSnapshotsTable1781000000001
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE adset_alert_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id VARCHAR NOT NULL,
        client_id VARCHAR NOT NULL,
        ad_account_id VARCHAR NOT NULL,
        adset_id VARCHAR NOT NULL,
        adset_name VARCHAR NOT NULL,
        roas DECIMAL(10, 4),
        updated_time DATE NOT NULL,
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS adset_alert_snapshots;`);
  }
}
