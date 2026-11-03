import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;
const DEFAULT_PASSWORD =
  process.env.CLIENT_PORTAL_DEFAULT_PASSWORD ?? 'Trafego@2026';

export class AddMustChangePasswordToClientPortalUsers1789000000000 implements MigrationInterface {
  name = 'AddMustChangePasswordToClientPortalUsers1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "client_portal_users"
        ADD COLUMN "must_change_password" boolean NOT NULL DEFAULT false
    `);

    // Accounts that were still waiting on the (now-paused) invite email are
    // stuck without a password forever — give them the default password too
    // so an admin can hand it out manually, same as any other account.
    const defaultPasswordHash = await bcrypt.hash(
      DEFAULT_PASSWORD,
      BCRYPT_ROUNDS,
    );
    await queryRunner.query(
      `UPDATE "client_portal_users"
         SET "password_hash" = $1, "must_change_password" = true
         WHERE "password_hash" IS NULL`,
      [defaultPasswordHash],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_portal_users" DROP COLUMN "must_change_password"`,
    );
  }
}
