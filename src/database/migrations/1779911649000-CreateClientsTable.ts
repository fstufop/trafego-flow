import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClientsTable1779911649000 implements MigrationInterface {
  name = 'CreateClientsTable1779911649000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "clients" (
        "id"          uuid              NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"  TIMESTAMP         NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMP         NOT NULL DEFAULT now(),
        "deleted_at"  TIMESTAMP,
        "name"        character varying(200) NOT NULL,
        "email"       character varying     NOT NULL,
        "is_active"   boolean           NOT NULL DEFAULT true,
        CONSTRAINT "PK_clients" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_clients_email" ON "clients" ("email")
      WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_clients_email"`);
    await queryRunner.query(`DROP TABLE "clients"`);
  }
}
