import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdAccountsTable1779944000000 implements MigrationInterface {
  name = 'CreateAdAccountsTable1779944000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ad_accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "client_id" uuid NOT NULL,
        "ad_account_id" character varying NOT NULL,
        "account_name" character varying,
        "access_token" text NOT NULL,
        "token_expires_at" TIMESTAMP WITH TIME ZONE,
        "isActive" boolean NOT NULL DEFAULT true,
        CONSTRAINT "UQ_ad_accounts_ad_account_id" UNIQUE ("ad_account_id"),
        CONSTRAINT "PK_ad_accounts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "ad_accounts"
        ADD CONSTRAINT "FK_ad_accounts_client_id"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ad_accounts" DROP CONSTRAINT "FK_ad_accounts_client_id"`);
    await queryRunner.query(`DROP TABLE "ad_accounts"`);
  }
}
