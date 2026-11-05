import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AesCryptoService } from '../../../common/crypto/aes.service.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import {
  IInstagramGraphService,
  InstagramFollowStatus,
} from './interfaces/instagram-graph.interface.js';
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

  async getFollowStatus(
    pageId: string,
    igsid: string,
  ): Promise<InstagramFollowStatus> {
    const token = await this.getDecryptedToken(pageId);
    const url = `${this.baseUrl}/${igsid}`;

    this.logger.log(
      `[follow-status] Requesting profile for igsid=${igsid} pageId=${pageId}`,
    );

    const response = await firstValueFrom(
      this.httpService.get<InstagramFollowStatus>(url, {
        params: {
          access_token: token,
          fields:
            'name,username,follower_count,is_user_follow_business,is_business_follow_user',
        },
      }),
    ).catch(
      (err: {
        response?: { status?: number; data?: { error?: { code?: number } } };
      }) => {
        this.logger.warn(
          `[follow-status] Graph API error for igsid=${igsid} pageId=${pageId}: ${JSON.stringify(err?.response?.data)}`,
        );
        return this.handleCommonGraphError(pageId, err);
      },
    );

    this.logger.log(
      `[follow-status] Result for igsid=${igsid}: ${JSON.stringify(response.data)}`,
    );

    return response.data;
  }

  async subscribeAccountToWebhooks(
    pageId: string,
    fields: string[],
  ): Promise<{ success: boolean }> {
    const token = await this.getDecryptedToken(pageId);
    const url = `${this.baseUrl}/${pageId}/subscribed_apps`;

    this.logger.log(
      `[subscribe] Subscribing pageId=${pageId} to fields=${fields.join(',')}`,
    );

    const response = await firstValueFrom(
      this.httpService.post<{ success: boolean }>(
        url,
        {},
        {
          params: {
            access_token: token,
            subscribed_fields: fields.join(','),
          },
        },
      ),
    ).catch(
      (err: {
        response?: { status?: number; data?: { error?: { code?: number } } };
      }) => {
        this.logger.warn(
          `[subscribe] Graph API error for pageId=${pageId}: ${JSON.stringify(err?.response?.data)}`,
        );
        return this.handleCommonGraphError(pageId, err);
      },
    );

    this.logger.log(
      `[subscribe] Result for pageId=${pageId}: ${JSON.stringify(response.data)}`,
    );

    return response.data;
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

  async sendButtonTemplate(
    pageId: string,
    recipientIgsid: string,
    text: string,
    buttonTitle: string,
    buttonUrl: string,
  ): Promise<void> {
    const token = await this.getDecryptedToken(pageId);
    await this.post(pageId, token, {
      recipient: { id: recipientIgsid },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text,
            buttons: [{ type: 'web_url', url: buttonUrl, title: buttonTitle }],
          },
        },
      },
    });
  }

  async setIceBreakers(
    pageId: string,
    questions: Array<{ question: string; payload: string }>,
  ): Promise<void> {
    const token = await this.getDecryptedToken(pageId);
    const url = `${this.baseUrl}/${pageId}/messenger_profile`;
    const errorHandler = (err: {
      response?: { status?: number; data?: { error?: { code?: number } } };
    }) => this.handleCommonGraphError(pageId, err);

    if (questions.length === 0) {
      await firstValueFrom(
        this.httpService.delete(url, {
          data: { fields: ['ice_breakers'] },
          params: { access_token: token },
        }),
      ).catch(errorHandler);
      return;
    }

    await firstValueFrom(
      this.httpService.post(
        url,
        {
          platform: 'instagram',
          ice_breakers: [
            {
              locale: 'default',
              call_to_actions: questions.map((q) => ({
                question: q.question,
                payload: q.payload,
              })),
            },
          ],
        },
        { params: { access_token: token } },
      ),
    ).catch(errorHandler);
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
