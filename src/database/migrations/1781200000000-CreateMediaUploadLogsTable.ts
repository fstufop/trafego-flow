import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMediaUploadLogsTable1781200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "media_upload_status_enum" AS ENUM ('processing', 'success', 'failed')
    `);
    await queryRunner.query(`
      CREATE TABLE "media_upload_logs" (
        "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
        "client_id"          VARCHAR      NOT NULL,
        "ad_account_id"      VARCHAR      NOT NULL,
        "media_name"         VARCHAR      NOT NULL,
        "original_file_name" VARCHAR      NOT NULL,
        "mime_type"          VARCHAR      NOT NULL,
        "status"             "media_upload_status_enum" NOT NULL DEFAULT 'processing',
        "drive_file_id"      VARCHAR      NOT NULL,
        "drive_url"          VARCHAR      NOT NULL,
        "meta_asset_id"      VARCHAR,
        "error_message"      TEXT,
        "attempt_count"      INTEGER      NOT NULL DEFAULT 0,
        "created_at"         TIMESTAMP    NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP    NOT NULL DEFAULT now(),
        "deleted_at"         TIMESTAMP,
        CONSTRAINT "PK_media_upload_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_media_upload_logs_client_id" ON "media_upload_logs" ("client_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_media_upload_logs_client_id"`);
    await queryRunner.query(`DROP TABLE "media_upload_logs"`);
    await queryRunner.query(`DROP TYPE "media_upload_status_enum"`);
  }
}
