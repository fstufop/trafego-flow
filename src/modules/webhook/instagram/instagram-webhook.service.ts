import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  InstagramEntry,
  InstagramWebhookPayload,
} from './interfaces/instagram-webhook-event.interface.js';

@Injectable()
export class InstagramWebhookService {
  private readonly logger = new Logger(InstagramWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectQueue('instagram-webhook')
    private readonly queue: Queue,
  ) {}

  verifyWebhook(mode: string, token: string, challenge: string): string {
    if (
      mode !== 'subscribe' ||
      token !== this.config.get<string>('meta.verifyToken')
    ) {
      throw new ForbiddenException('Webhook verification failed');
    }
    return challenge;
  }

  async handleEvent(
    payload: InstagramWebhookPayload,
    rawBody: Buffer,
    signature: string,
  ): Promise<void> {
    // Logged before signature validation so a rejected payload still shows up
    // here — needed to debug mismatches between what Meta sent and what we expect.
    this.logger.log(
      `Instagram webhook payload received: ${JSON.stringify(payload)}`,
    );
    this.validateSignature(rawBody, signature);
    await this.enqueueEvents(payload);
  }

  private async enqueueEvents(payload: InstagramWebhookPayload): Promise<void> {
    for (const entry of payload.entry) {
      await this.enqueueEntry(entry);
    }
  }

  private async enqueueEntry(entry: InstagramEntry): Promise<void> {
    for (const event of entry.messaging ?? []) {
      if (event.postback) {
        await this.queue
          .add(
            'postback',
            {
              pageId: entry.id,
              senderId: event.sender.id,
              payload: event.postback.payload,
            },
            { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
          )
          .catch((err: Error) =>
            this.logger.warn(
              `enqueue postback failed pageId=${entry.id}: ${err.message}`,
            ),
          );
        continue;
      }
      if (!event.message) continue;
      await this.queue
        .add(
          'dm',
          {
            pageId: entry.id,
            senderId: event.sender.id,
            text: event.message?.text,
          },
          { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
        )
        .catch((err: Error) =>
          this.logger.warn(
            `enqueue dm failed pageId=${entry.id}: ${err.message}`,
          ),
        );
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== 'comments') continue;
      await this.queue
        .add(
          'comment',
          {
            pageId: entry.id,
            postId: change.value.media.id,
            commentId: change.value.id,
            text: change.value.text,
          },
          { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
        )
        .catch((err: Error) =>
          this.logger.warn(
            `enqueue comment failed pageId=${entry.id}: ${err.message}`,
          ),
        );
    }
  }

  private validateSignature(rawBody: Buffer, signature: string): void {
    const appSecret = this.config.get<string>('meta.appSecret') ?? '';
    const expected = createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');
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
