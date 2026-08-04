import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiStrategyContextToClients1780900000001 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "clients"
      ADD COLUMN IF NOT EXISTS "ai_strategy_context" TEXT
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE "clients"
      DROP COLUMN IF EXISTS "ai_strategy_context"
    `);
  }
}
