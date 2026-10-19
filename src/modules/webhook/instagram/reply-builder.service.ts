import { Injectable } from '@nestjs/common';
import { ConversationReply } from '../../conversation-rules/interfaces/conversation-reply.interface.js';
import { InstagramGraphService } from './instagram-graph.service.js';

@Injectable()
export class ReplyBuilderService {
  constructor(private readonly graph: InstagramGraphService) {}

  async send(
    pageId: string,
    recipientId: string,
    reply: ConversationReply,
  ): Promise<void> {
    const text = this.buildText(reply);

    if (reply.quickReplies?.length) {
      await this.graph.sendQuickReplies(
        pageId,
        recipientId,
        text,
        reply.quickReplies,
      );
    } else {
      await this.graph.sendTextMessage(pageId, recipientId, text);
    }
  }

  async sendCommentReply(
    pageId: string,
    commentId: string,
    reply: ConversationReply,
  ): Promise<void> {
    await this.graph.sendCommentPrivateReply(
      pageId,
      commentId,
      this.buildText(reply),
    );
  }

  private buildText(reply: ConversationReply): string {
    return reply.waLink
      ? `${reply.text ?? ''}\n${reply.waLink}`.trim()
      : (reply.text ?? '');
  }
}
