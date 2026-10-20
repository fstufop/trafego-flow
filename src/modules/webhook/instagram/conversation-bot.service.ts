import { Injectable, Logger } from '@nestjs/common';
import { ConversationRulesService } from '../../conversation-rules/conversation-rules.service.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import { ReplyBuilderService } from './reply-builder.service.js';
import { GraphApiRateLimitException } from './exceptions/graph-api-rate-limit.exception.js';

@Injectable()
export class ConversationBotService {
  private readonly logger = new Logger(ConversationBotService.name);

  constructor(
    private readonly rulesService: ConversationRulesService,
    private readonly integrationsService: IntegrationsService,
    private readonly replyBuilder: ReplyBuilderService,
  ) {}

  async handleDm(
    pageId: string,
    senderId: string,
    text: string | undefined,
  ): Promise<void> {
    if (senderId === pageId) return;
    if (!text) return;

    let clientId: string;
    try {
      const integration = await this.integrationsService.findByPageId(pageId);
      if (!integration.isActive) return;
      clientId = integration.clientId;
    } catch (err) {
      this.logger.warn(
        `No integration found for pageId ${pageId} (dm): ${(err as Error).message}`,
      );
      return;
    }

    const rule =
      (await this.rulesService.findKeywordRule(clientId, text)) ??
      (await this.rulesService.findDefaultRule(clientId));

    if (!rule) return;

    // Rate limit is transient — rethrow so the BullMQ job fails and retries with backoff.
    // Any other error (expired token, closed messaging window, etc.) is permanent for this
    // message, so it's just logged instead of wasting retries on something that will never succeed.
    await this.replyBuilder
      .send(pageId, senderId, rule.reply)
      .catch((err: Error) => {
        if (err instanceof GraphApiRateLimitException) throw err;
        this.logger.error(
          `Failed to send DM reply for pageId ${pageId}: ${err.message}`,
        );
      });
  }

  async handleComment(
    pageId: string,
    postId: string,
    commentId: string,
    text: string,
  ): Promise<void> {
    let clientId: string;
    try {
      const integration = await this.integrationsService.findByPageId(pageId);
      if (!integration.isActive) return;
      clientId = integration.clientId;
    } catch (err) {
      this.logger.warn(
        `No integration found for pageId ${pageId} (comment): ${(err as Error).message}`,
      );
      return;
    }

    const rule = await this.rulesService.findPostRule(clientId, postId, text);
    if (!rule) return;

    // Private DM and public comment reply are independent: one failing must
    // not prevent the other from being attempted.
    const results = await Promise.allSettled([
      this.replyBuilder.sendCommentReply(pageId, commentId, rule.reply),
      this.replyBuilder.sendPublicCommentReply(pageId, commentId, rule.publicReply!),
    ]);

    let rateLimitError: GraphApiRateLimitException | undefined;
    for (const result of results) {
      if (result.status !== 'rejected') continue;
      const err = result.reason as Error;
      if (err instanceof GraphApiRateLimitException) {
        rateLimitError = err;
        continue;
      }
      this.logger.error(
        `Failed to send comment reply for pageId ${pageId}: ${err.message}`,
      );
    }
    if (rateLimitError) throw rateLimitError;
  }
}
