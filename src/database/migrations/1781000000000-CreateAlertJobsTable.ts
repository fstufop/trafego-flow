import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAlertJobsTable1781000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE alert_job_type AS ENUM ('ADSET_INSIGHTS')`);
    await queryRunner.query(`CREATE TYPE alert_job_status AS ENUM ('ACTIVE', 'INACTIVE')`);
    await queryRunner.query(`
      CREATE TABLE alert_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type alert_job_type NOT NULL,
        status alert_job_status NOT NULL DEFAULT 'ACTIVE',
        client_id VARCHAR,
        fields TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS alert_jobs`);
    await queryRunner.query(`DROP TYPE IF EXISTS alert_job_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS alert_job_type`);
  }
}
