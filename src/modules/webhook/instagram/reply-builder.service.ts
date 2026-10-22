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
    if (reply.buttonUrl) {
      await this.graph.sendButtonTemplate(
        pageId,
        recipientId,
        reply.text ?? '',
        reply.buttonText ?? '',
        reply.buttonUrl,
      );
      return;
    }

    const text = reply.text ?? '';
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

  async sendPublicCommentReply(
    pageId: string,
    commentId: string,
    text: string,
  ): Promise<void> {
    await this.graph.replyToComment(pageId, commentId, text);
  }

  private buildText(reply: ConversationReply): string {
    return reply.text ?? '';
  }
}
