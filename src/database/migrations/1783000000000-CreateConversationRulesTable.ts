import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConversationRulesTable1783000000000 implements MigrationInterface {
  name = 'CreateConversationRulesTable1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "rule_type_enum" AS ENUM ('post_comment', 'keyword_dm', 'default')
    `);

    await queryRunner.query(`
      CREATE TABLE "conversation_rules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "client_id" uuid NOT NULL,
        "type" "rule_type_enum" NOT NULL,
        "trigger_value" character varying,
        "reply" jsonb NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_conversation_rules" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_conv_rules_client_type_trigger"
      ON "conversation_rules" ("client_id", "type", COALESCE("trigger_value", ''))
      WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "conversation_rules"
        ADD CONSTRAINT "FK_conversation_rules_client_id"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversation_rules" DROP CONSTRAINT "FK_conversation_rules_client_id"`);
    await queryRunner.query(`DROP INDEX "UQ_conv_rules_client_type_trigger"`);
    await queryRunner.query(`DROP TABLE "conversation_rules"`);
    await queryRunner.query(`DROP TYPE "rule_type_enum"`);
  }
}
