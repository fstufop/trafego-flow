import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropUniqueGroupJidFromWhatsAppGroups1780900000003 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_groups" DROP CONSTRAINT IF EXISTS "UQ_whatsapp_groups_group_jid"`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_groups" ADD CONSTRAINT "UQ_whatsapp_groups_group_jid" UNIQUE ("group_jid")`,
    );
  }
}
