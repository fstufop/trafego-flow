import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1780100000000 implements MigrationInterface {
  name = 'CreateUsersTable1780100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "name" character varying(200) NOT NULL,
        "email" character varying NOT NULL,
        "password_hash" character varying NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
