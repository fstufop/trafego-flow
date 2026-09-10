import { Injectable } from '@nestjs/common';
import { ConversationReply } from '../../conversation-rules/entities/conversation-rule.entity.js';
import { InstagramGraphService } from './instagram-graph.service.js';

@Injectable()
export class ReplyBuilderService {
  constructor(private readonly graph: InstagramGraphService) {}

  async send(pageId: string, recipientId: string, reply: ConversationReply): Promise<void> {
    const text = reply.waLink
      ? `${reply.text ?? ''}\n${reply.waLink}`.trim()
      : (reply.text ?? '');

    if (reply.quickReplies?.length) {
      await this.graph.sendQuickReplies(pageId, recipientId, text, reply.quickReplies);
    } else {
      await this.graph.sendTextMessage(pageId, recipientId, text);
    }
  }
}
