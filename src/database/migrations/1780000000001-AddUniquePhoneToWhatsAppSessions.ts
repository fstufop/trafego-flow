import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniquePhoneToWhatsAppSessions1780000000001 implements MigrationInterface {
  name = 'AddUniquePhoneToWhatsAppSessions1780000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "whatsapp_sessions"
        ADD CONSTRAINT "UQ_whatsapp_sessions_phone_number" UNIQUE ("phone_number")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "whatsapp_sessions"
        DROP CONSTRAINT "UQ_whatsapp_sessions_phone_number"
    `);
  }
}
