import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInsightSnapshotsTable1780900000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS "insight_snapshots" (
        "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
        "ad_account_id"    VARCHAR NOT NULL,
        "client_id"        VARCHAR NOT NULL,
        "week_start_date"  DATE NOT NULL,
        "snapshot_json"    JSONB NOT NULL,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"       TIMESTAMPTZ,
        CONSTRAINT "PK_insight_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_insight_snapshots_account_week"
          UNIQUE ("ad_account_id", "week_start_date")
      )
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE IF EXISTS "insight_snapshots"`);
  }
}
