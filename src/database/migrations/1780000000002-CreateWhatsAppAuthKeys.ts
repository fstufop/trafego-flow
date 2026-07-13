import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWhatsAppAuthKeys1780000000002 implements MigrationInterface {
  name = 'CreateWhatsAppAuthKeys1780000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "whatsapp_auth_keys" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "phone_number" character varying NOT NULL,
        "key_id" character varying NOT NULL,
        "value_json" text NOT NULL,
        CONSTRAINT "UQ_whatsapp_auth_keys_phone_key" UNIQUE ("phone_number", "key_id"),
        CONSTRAINT "PK_whatsapp_auth_keys" PRIMARY KEY ("id")
      )
    `);

    // creds_json guardava só o creds.json, sem as chaves de sessão do Signal —
    // restaurar esse estado parcial causava "Bad MAC". Substituído pela tabela acima.
    await queryRunner.query(
      `ALTER TABLE "whatsapp_sessions" DROP COLUMN "creds_json"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_sessions" ADD "creds_json" text`,
    );
    await queryRunner.query(`DROP TABLE "whatsapp_auth_keys"`);
  }
}
