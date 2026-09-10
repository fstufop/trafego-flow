import { Injectable, Logger } from '@nestjs/common';
import { ConversationRulesService } from '../../conversation-rules/conversation-rules.service.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import { ReplyBuilderService } from './reply-builder.service.js';

@Injectable()
export class ConversationBotService {
  private readonly logger = new Logger(ConversationBotService.name);

  constructor(
    private readonly rulesService: ConversationRulesService,
    private readonly integrationsService: IntegrationsService,
    private readonly replyBuilder: ReplyBuilderService,
  ) {}

  async handleDm(pageId: string, senderId: string, text: string | undefined): Promise<void> {
    if (senderId === pageId) return;
    if (!text) return;

    let clientId: string;
    try {
      const integration = await this.integrationsService.findByPageId(pageId);
      if (!integration.isActive) return;
      clientId = integration.clientId;
    } catch {
      return;
    }

    const rule =
      (await this.rulesService.findKeywordRule(clientId, text)) ??
      (await this.rulesService.findDefaultRule(clientId));

    if (!rule) return;

    await this.replyBuilder.send(pageId, senderId, rule.reply).catch((err: Error) => {
      this.logger.error(`Failed to send DM reply for pageId ${pageId}: ${err.message}`);
    });
  }

  async handleComment(pageId: string, postId: string, commenterId: string): Promise<void> {
    let clientId: string;
    try {
      const integration = await this.integrationsService.findByPageId(pageId);
      if (!integration.isActive) return;
      clientId = integration.clientId;
    } catch {
      return;
    }

    const rule = await this.rulesService.findPostRule(clientId, postId);
    if (!rule) return;

    await this.replyBuilder.send(pageId, commenterId, rule.reply).catch((err: Error) => {
      this.logger.error(`Failed to send comment reply for pageId ${pageId}: ${err.message}`);
    });
  }
}
