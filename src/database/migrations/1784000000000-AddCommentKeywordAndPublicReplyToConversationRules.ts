import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommentKeywordAndPublicReplyToConversationRules1784000000000
  implements MigrationInterface
{
  name = 'AddCommentKeywordAndPublicReplyToConversationRules1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversation_rules"
        ADD COLUMN "comment_keyword" character varying,
        ADD COLUMN "public_reply" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversation_rules"
        DROP COLUMN "public_reply",
        DROP COLUMN "comment_keyword"
    `);
  }
}
