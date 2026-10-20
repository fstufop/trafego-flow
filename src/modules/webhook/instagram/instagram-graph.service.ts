import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AesCryptoService } from '../../../common/crypto/aes.service.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import { IInstagramGraphService } from './interfaces/instagram-graph.interface.js';
import { OAuthTokenExpiredException } from './exceptions/oauth-token-expired.exception.js';
import { GraphApiRateLimitException } from './exceptions/graph-api-rate-limit.exception.js';
import { MessagingWindowExpiredException } from './exceptions/messaging-window-expired.exception.js';

// Meta error codes that mean "rate limit reached" (app/page/custom limits, including code 613).
const RATE_LIMIT_ERROR_CODES = [4, 17, 32, 80004, 613];
// Meta error code 10 + these subcodes mean "outside the 24h/7-day messaging window".
const WINDOW_EXPIRED_SUBCODES = [2534022, 2018278, 2018065];

@Injectable()
export class InstagramGraphService implements IInstagramGraphService {
  private readonly logger = new Logger(InstagramGraphService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly integrationsService: IntegrationsService,
    private readonly crypto: AesCryptoService,
  ) {}

  async sendTextMessage(
    pageId: string,
    recipientIgsid: string,
    text: string,
  ): Promise<void> {
    const token = await this.getDecryptedToken(pageId);
    await this.post(pageId, token, {
      recipient: { id: recipientIgsid },
      message: { text },
    });
  }

  async sendQuickReplies(
    pageId: string,
    recipientIgsid: string,
    text: string,
    options: string[],
  ): Promise<void> {
    const token = await this.getDecryptedToken(pageId);
    await this.post(pageId, token, {
      recipient: { id: recipientIgsid },
      message: {
        text,
        quick_replies: options.map((title) => ({
          content_type: 'text',
          title,
          payload: title,
        })),
      },
    });
  }

  async sendCommentPrivateReply(
    pageId: string,
    commentId: string,
    text: string,
  ): Promise<void> {
    const token = await this.getDecryptedToken(pageId);
    await this.post(pageId, token, {
      recipient: { comment_id: commentId },
      message: { text },
    });
  }

  async markSeen(pageId: string, recipientIgsid: string): Promise<void> {
    const token = await this.getDecryptedToken(pageId);
    await this.post(pageId, token, {
      recipient: { id: recipientIgsid },
      sender_action: 'mark_seen',
    });
  }

  async replyToComment(
    pageId: string,
    commentId: string,
    message: string,
  ): Promise<void> {
    const token = await this.getDecryptedToken(pageId);
    const url = `${this.baseUrl}/${commentId}/replies`;
    await firstValueFrom(
      this.httpService.post(
        url,
        {},
        { params: { access_token: token, message } },
      ),
    ).catch(
      (err: {
        response?: { status?: number; data?: { error?: { code?: number } } };
      }) => this.handleCommonGraphError(pageId, err),
    );
  }

  private get baseUrl(): string {
    const url = this.config.get<string>('meta.graphApiUrl');
    const version = this.config.get<string>('meta.graphApiVersion');
    return `${url}/${version}`;
  }

  private async getDecryptedToken(pageId: string): Promise<string> {
    const integration = await this.integrationsService.findByPageId(pageId);
    return this.crypto.decrypt(integration.accessToken);
  }

  private async post(
    pageId: string,
    token: string,
    body: object,
  ): Promise<void> {
    const url = `${this.baseUrl}/${pageId}/messages`;
    await firstValueFrom(
      this.httpService.post(url, body, { params: { access_token: token } }),
    ).catch(
      (err: {
        response?: {
          status?: number;
          data?: { error?: { code?: number; error_subcode?: number } };
        };
      }) => {
        const code = err?.response?.data?.error?.code;
        const subcode = err?.response?.data?.error?.error_subcode;

        if (
          code === 10 &&
          subcode !== undefined &&
          WINDOW_EXPIRED_SUBCODES.includes(subcode)
        ) {
          throw new MessagingWindowExpiredException(pageId);
        }

        this.handleCommonGraphError(pageId, err);
      },
    );
  }

  private handleCommonGraphError(
    pageId: string,
    err: {
      response?: { status?: number; data?: { error?: { code?: number } } };
    },
  ): never {
    const status = err?.response?.status;
    const code = err?.response?.data?.error?.code;

    if (code === 190) {
      throw new OAuthTokenExpiredException(pageId);
    }
    if (
      status === 429 ||
      (code !== undefined && RATE_LIMIT_ERROR_CODES.includes(code))
    ) {
      throw new GraphApiRateLimitException(pageId);
    }

    this.logger.error(
      `Graph API error for pageId ${pageId}: ${JSON.stringify(err?.response?.data)}`,
    );
    throw err;
  }
}
