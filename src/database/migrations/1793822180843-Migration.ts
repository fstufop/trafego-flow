import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1793822180843 implements MigrationInterface {
    name = 'Migration1793822180843'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "integrations" ADD "app_secret" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "integrations" DROP COLUMN "app_secret"`);
    }

}
