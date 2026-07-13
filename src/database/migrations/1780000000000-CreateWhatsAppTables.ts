import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWhatsAppTables1780000000000 implements MigrationInterface {
  name = 'CreateWhatsAppTables1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "whatsapp_groups" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "client_id" uuid NOT NULL,
        "group_jid" character varying NOT NULL,
        "label" character varying(200),
        "isActive" boolean NOT NULL DEFAULT true,
        CONSTRAINT "UQ_whatsapp_groups_group_jid" UNIQUE ("group_jid"),
        CONSTRAINT "PK_whatsapp_groups" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "whatsapp_groups"
        ADD CONSTRAINT "FK_whatsapp_groups_client_id"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE TABLE "whatsapp_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "phone_number" character varying NOT NULL,
        "creds_json" text,
        "is_connected" boolean NOT NULL DEFAULT false,
        "last_connected_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_whatsapp_sessions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "dispatch_status_enum" AS ENUM ('sent', 'failed')
    `);

    await queryRunner.query(`
      CREATE TABLE "report_dispatch_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "client_id" uuid NOT NULL,
        "group_jid" character varying NOT NULL,
        "ad_account_id" character varying NOT NULL,
        "week_start_date" date NOT NULL,
        "status" "dispatch_status_enum" NOT NULL,
        "error_message" text,
        "sent_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_report_dispatch_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "report_dispatch_logs"
        ADD CONSTRAINT "FK_report_dispatch_logs_client_id"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "report_dispatch_logs" DROP CONSTRAINT "FK_report_dispatch_logs_client_id"`);
    await queryRunner.query(`DROP TABLE "report_dispatch_logs"`);
    await queryRunner.query(`DROP TYPE "dispatch_status_enum"`);
    await queryRunner.query(`DROP TABLE "whatsapp_sessions"`);
    await queryRunner.query(`ALTER TABLE "whatsapp_groups" DROP CONSTRAINT "FK_whatsapp_groups_client_id"`);
    await queryRunner.query(`DROP TABLE "whatsapp_groups"`);
  }
}
