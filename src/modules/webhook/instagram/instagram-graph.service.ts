import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AesCryptoService } from '../../../common/crypto/aes.service.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import { IInstagramGraphService } from './interfaces/instagram-graph.interface.js';
import { OAuthTokenExpiredException } from './exceptions/oauth-token-expired.exception.js';

@Injectable()
export class InstagramGraphService implements IInstagramGraphService {
  private readonly logger = new Logger(InstagramGraphService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly integrationsService: IntegrationsService,
    private readonly crypto: AesCryptoService,
  ) {}

  async sendTextMessage(pageId: string, recipientIgsid: string, text: string): Promise<void> {
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

  async markSeen(pageId: string, recipientIgsid: string): Promise<void> {
    const token = await this.getDecryptedToken(pageId);
    await this.post(pageId, token, {
      recipient: { id: recipientIgsid },
      sender_action: 'mark_seen',
    });
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

  private async post(pageId: string, token: string, body: object): Promise<void> {
    const url = `${this.baseUrl}/me/messages`;
    await firstValueFrom(
      this.httpService.post(url, body, { params: { access_token: token } }),
    ).catch((err: { response?: { data?: { error?: { code?: number } } } }) => {
      const code = err?.response?.data?.error?.code;
      if (code === 190) {
        throw new OAuthTokenExpiredException(pageId);
      }
      this.logger.error(`Graph API error for pageId ${pageId}: ${JSON.stringify(err?.response?.data)}`);
      throw err;
    });
  }
}
