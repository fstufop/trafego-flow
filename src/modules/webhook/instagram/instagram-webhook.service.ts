import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import {
  InstagramMessagingEvent,
  InstagramWebhookPayload,
} from './interfaces/instagram-webhook-event.interface.js';

@Injectable()
export class InstagramWebhookService {
  private readonly logger = new Logger(InstagramWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  verifyWebhook(mode: string, token: string, challenge: string): string {
    if (mode !== 'subscribe' || token !== this.config.get<string>('meta.verifyToken')) {
      throw new ForbiddenException('Webhook verification failed');
    }
    return challenge;
  }

  async handleEvent(
    payload: InstagramWebhookPayload,
    rawBody: Buffer,
    signature: string,
  ): Promise<void> {
    this.validateSignature(rawBody, signature);

    for (const entry of payload.entry) {
      for (const event of entry.messaging ?? []) {
        await this.processEvent(entry.id, event).catch((err: Error) => {
          // pageId desconhecido ou inativo — descarta silenciosamente para não gerar erro ao Meta
          this.logger.warn(
            `Skipping event for pageId ${entry.id}: ${err.message}`,
          );
        });
      }
    }
  }

  private validateSignature(rawBody: Buffer, signature: string): void {
    const appSecret = this.config.get<string>('meta.appSecret') ?? '';
    const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const expectedHeader = `sha256=${expected}`;
    const receivedHeader = signature ?? '';

    // timingSafeEqual exige buffers do mesmo tamanho
    if (expectedHeader.length !== receivedHeader.length) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    const safe = timingSafeEqual(
      Buffer.from(expectedHeader),
      Buffer.from(receivedHeader),
    );
    if (!safe) throw new ForbiddenException('Invalid webhook signature');
  }

  private async processEvent(pageId: string, event: InstagramMessagingEvent): Promise<void> {
    const integration = await this.integrationsService.findByPageId(pageId);
    if (!integration.isActive) return;

    // Fase 1: identificar client e logar evento estruturado
    // Módulo conversations/bot vai processar a lógica de triagem
    this.logger.log(
      `[client:${integration.clientId}] event from igsid:${event.sender.id} — ` +
        `text="${event.message?.text ?? '[no-text]'}"`,
    );
  }
}
