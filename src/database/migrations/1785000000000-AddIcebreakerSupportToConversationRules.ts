import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIcebreakerSupportToConversationRules1785000000000
  implements MigrationInterface
{
  name = 'AddIcebreakerSupportToConversationRules1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "rule_type_enum" ADD VALUE 'icebreaker'`);
    await queryRunner.query(`
      ALTER TABLE "conversation_rules" ADD COLUMN "icebreaker_question" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres cannot drop a single enum value; down() leaves the enum value in place
    // and only reverts the column, consistent with how an additive enum change is
    // normally handled in this codebase (there's no prior example of reverting one).
    await queryRunner.query(`
      ALTER TABLE "conversation_rules" DROP COLUMN "icebreaker_question"
    `);
  }
}
