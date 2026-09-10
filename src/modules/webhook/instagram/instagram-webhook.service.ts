import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { ConversationBotService } from './conversation-bot.service.js';
import {
  InstagramEntry,
  InstagramWebhookPayload,
} from './interfaces/instagram-webhook-event.interface.js';

@Injectable()
export class InstagramWebhookService {
  private readonly logger = new Logger(InstagramWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly botService: ConversationBotService,
  ) {}

  verifyWebhook(mode: string, token: string, challenge: string): string {
    if (mode !== 'subscribe' || token !== this.config.get<string>('meta.verifyToken')) {
      throw new ForbiddenException('Webhook verification failed');
    }
    return challenge;
  }

  handleEvent(
    payload: InstagramWebhookPayload,
    rawBody: Buffer,
    signature: string,
  ): void {
    this.validateSignature(rawBody, signature);
    setImmediate(() => this.dispatchEvents(payload));
  }

  private dispatchEvents(payload: InstagramWebhookPayload): void {
    for (const entry of payload.entry) {
      this.dispatchEntry(entry);
    }
  }

  private dispatchEntry(entry: InstagramEntry): void {
    for (const event of entry.messaging ?? []) {
      this.botService
        .handleDm(entry.id, event.sender.id, event.message?.text)
        .catch((err: Error) => this.logger.warn(`handleDm error pageId=${entry.id}: ${err.message}`));
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== 'comments' || change.value.verb !== 'add') continue;
      this.botService
        .handleComment(entry.id, change.value.post_id, change.value.from.id)
        .catch((err: Error) => this.logger.warn(`handleComment error pageId=${entry.id}: ${err.message}`));
    }
  }

  private validateSignature(rawBody: Buffer, signature: string): void {
    const appSecret = this.config.get<string>('meta.appSecret') ?? '';
    const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const expectedHeader = `sha256=${expected}`;
    const receivedHeader = signature ?? '';

    if (expectedHeader.length !== receivedHeader.length) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    const safe = timingSafeEqual(
      Buffer.from(expectedHeader),
      Buffer.from(receivedHeader),
    );
    if (!safe) throw new ForbiddenException('Invalid webhook signature');
  }
}
