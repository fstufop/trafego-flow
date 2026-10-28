import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClientPortalUsersTable1788000000000 implements MigrationInterface {
  name = 'CreateClientPortalUsersTable1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "client_portal_users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "client_id" uuid NOT NULL,
        "email" character varying NOT NULL,
        "password_hash" character varying,
        "is_active" boolean NOT NULL DEFAULT true,
        "password_reset_token_hash" character varying,
        "password_reset_expires_at" TIMESTAMP,
        CONSTRAINT "PK_client_portal_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_client_portal_users_email" UNIQUE ("email")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "client_portal_users"
        ADD CONSTRAINT "FK_client_portal_users_client_id"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_portal_users" DROP CONSTRAINT "FK_client_portal_users_client_id"`,
    );
    await queryRunner.query(`DROP TABLE "client_portal_users"`);
  }
}
