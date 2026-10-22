import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ConversationBotService } from '../conversation-bot.service.js';
import {
  InstagramCommentJobPayload,
  InstagramDmJobPayload,
  InstagramPostbackJobPayload,
} from '../types/instagram-webhook-job.type.js';

@Processor('instagram-webhook')
export class InstagramWebhookProcessor extends WorkerHost {
  constructor(private readonly botService: ConversationBotService) {
    super();
  }

  async process(
    job: Job<
      | InstagramDmJobPayload
      | InstagramCommentJobPayload
      | InstagramPostbackJobPayload
    >,
  ): Promise<void> {
    if (job.name === 'dm') {
      const { pageId, senderId, text } = job.data as InstagramDmJobPayload;
      await this.botService.handleDm(pageId, senderId, text);
      return;
    }

    if (job.name === 'comment') {
      const { pageId, postId, commentId, text } =
        job.data as InstagramCommentJobPayload;
      await this.botService.handleComment(pageId, postId, commentId, text);
      return;
    }

    if (job.name === 'postback') {
      const { pageId, senderId, payload } =
        job.data as InstagramPostbackJobPayload;
      await this.botService.handleIcebreaker(pageId, senderId, payload);
    }
  }
}
