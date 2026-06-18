import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1779922436820 implements MigrationInterface {
    name = 'Migration1779922436820'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_clients_email"`);
        await queryRunner.query(`CREATE TYPE "public"."integrations_platform_enum" AS ENUM('instagram', 'whatsapp')`);
        await queryRunner.query(`CREATE TABLE "integrations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "client_id" uuid NOT NULL, "platform" "public"."integrations_platform_enum" NOT NULL, "page_id" character varying NOT NULL, "access_token" text NOT NULL, "token_expires_at" TIMESTAMP WITH TIME ZONE, "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_d4a5575c26e055d30aec76a2cf4" UNIQUE ("page_id"), CONSTRAINT "PK_9adcdc6d6f3922535361ce641e8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "created_at"`);
        await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "updated_at"`);
        await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "is_active"`);
        await queryRunner.query(`ALTER TABLE "clients" ADD "createdAt" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "clients" ADD "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "clients" ADD "deletedAt" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "clients" ADD "isActive" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "clients" ADD CONSTRAINT "UQ_b48860677afe62cd96e12659482" UNIQUE ("email")`);
        await queryRunner.query(`ALTER TABLE "integrations" ADD CONSTRAINT "FK_55b9da95c145622a9a32a348e7a" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "integrations" DROP CONSTRAINT "FK_55b9da95c145622a9a32a348e7a"`);
        await queryRunner.query(`ALTER TABLE "clients" DROP CONSTRAINT "UQ_b48860677afe62cd96e12659482"`);
        await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "isActive"`);
        await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "deletedAt"`);
        await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "updatedAt"`);
        await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "createdAt"`);
        await queryRunner.query(`ALTER TABLE "clients" ADD "is_active" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "clients" ADD "deleted_at" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "clients" ADD "updated_at" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "clients" ADD "created_at" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`DROP TABLE "integrations"`);
        await queryRunner.query(`DROP TYPE "public"."integrations_platform_enum"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_clients_email" ON "clients" USING btree ("email") WHERE (deleted_at IS NULL)`);
    }

}
