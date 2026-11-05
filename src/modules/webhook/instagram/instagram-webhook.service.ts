import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  InstagramEntry,
  InstagramWebhookPayload,
} from './interfaces/instagram-webhook-event.interface.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import { IntegrationEntity } from '../../integrations/entities/integration.entity.js';
import { AesCryptoService } from '../../../common/crypto/aes.service.js';

@Injectable()
export class InstagramWebhookService {
  private readonly logger = new Logger(InstagramWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectQueue('instagram-webhook')
    private readonly queue: Queue,
    private readonly integrationsService: IntegrationsService,
    private readonly crypto: AesCryptoService,
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
    const pageId = payload.entry?.[0]?.id;
    const integration = pageId
      ? await this.integrationsService.findByPageId(pageId).catch(() => null)
      : null;

    // Logged before signature validation so a rejected payload still shows up
    // here — needed to debug mismatches between what Meta sent and what we expect.
    this.logger.log(
      `Instagram webhook payload received (account: ${this.resolveAccountName(integration, pageId)}): ${JSON.stringify(payload)}`,
    );
    const appSecret = this.resolveAppSecret(integration);
    this.validateSignature(rawBody, signature, appSecret);
    await this.enqueueEvents(payload);
  }

  private resolveAccountName(
    integration: IntegrationEntity | null,
    pageId: string | undefined,
  ): string {
    return integration?.client?.name ?? pageId ?? 'unknown';
  }

  private resolveAppSecret(integration: IntegrationEntity | null): string {
    if (!integration) {
      throw new ForbiddenException('Webhook validation failed');
    }
    try {
      return this.crypto.decrypt(integration.appSecret ?? '');
    } catch {
      throw new ForbiddenException('Webhook validation failed');
    }
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

  private validateSignature(
    rawBody: Buffer,
    signature: string,
    appSecret: string,
  ): void {
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
