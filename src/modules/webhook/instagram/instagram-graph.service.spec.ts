import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { InstagramGraphService } from './instagram-graph.service.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import { AesCryptoService } from '../../../common/crypto/aes.service.js';
import {
  IntegrationEntity,
  MetaPlatform,
} from '../../integrations/entities/integration.entity.js';
import { OAuthTokenExpiredException } from './exceptions/oauth-token-expired.exception.js';
import { GraphApiRateLimitException } from './exceptions/graph-api-rate-limit.exception.js';
import { MessagingWindowExpiredException } from './exceptions/messaging-window-expired.exception.js';

const mockIntegration: Partial<IntegrationEntity> = {
  id: 'uuid-int-1',
  pageId: 'PAGE123',
  platform: MetaPlatform.INSTAGRAM,
  accessToken: 'encrypted-token',
};

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'meta.graphApiUrl') return 'https://graph.facebook.com';
    if (key === 'meta.graphApiVersion') return 'v21.0';
    return undefined;
  }),
};

const mockHttpService = { post: jest.fn() };
const mockIntegrationsService = { findByPageId: jest.fn() };
const mockCrypto = { decrypt: jest.fn().mockReturnValue('plaintext-token') };

describe('InstagramGraphService', () => {
  let service: InstagramGraphService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockIntegrationsService.findByPageId.mockResolvedValue(mockIntegration);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstagramGraphService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfig },
        { provide: IntegrationsService, useValue: mockIntegrationsService },
        { provide: AesCryptoService, useValue: mockCrypto },
      ],
    }).compile();

    service = module.get<InstagramGraphService>(InstagramGraphService);
  });

  describe('sendTextMessage', () => {
    it('should call Graph API with correct URL and body', async () => {
      mockHttpService.post.mockReturnValue(
        of({ data: { message_id: 'MSG_1' } }),
      );

      await service.sendTextMessage('PAGE123', 'IGSID_USER', 'Olá!');

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/PAGE123/messages',
        { recipient: { id: 'IGSID_USER' }, message: { text: 'Olá!' } },
        { params: { access_token: 'plaintext-token' } },
      );
    });

    it('should throw OAuthTokenExpiredException when Graph API returns error 190', async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() => ({ response: { data: { error: { code: 190 } } } })),
      );

      await expect(
        service.sendTextMessage('PAGE123', 'IGSID_USER', 'Olá'),
      ).rejects.toThrow(OAuthTokenExpiredException);
    });

    it('should throw GraphApiRateLimitException on HTTP 429', async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() => ({
          response: { status: 429, data: { error: { code: 4 } } },
        })),
      );

      await expect(
        service.sendTextMessage('PAGE123', 'IGSID_USER', 'Olá'),
      ).rejects.toThrow(GraphApiRateLimitException);
    });

    it('should throw GraphApiRateLimitException on known rate-limit error codes', async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() => ({ response: { data: { error: { code: 613 } } } })),
      );

      await expect(
        service.sendTextMessage('PAGE123', 'IGSID_USER', 'Olá'),
      ).rejects.toThrow(GraphApiRateLimitException);
    });

    it('should throw MessagingWindowExpiredException when outside the allowed window', async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() => ({
          response: { data: { error: { code: 10, error_subcode: 2534022 } } },
        })),
      );

      await expect(
        service.sendTextMessage('PAGE123', 'IGSID_USER', 'Olá'),
      ).rejects.toThrow(MessagingWindowExpiredException);
    });

    it('should rethrow the original error when it does not match a known case', async () => {
      const unknownError = { response: { data: { error: { code: 100 } } } };
      mockHttpService.post.mockReturnValue(throwError(() => unknownError));

      await expect(
        service.sendTextMessage('PAGE123', 'IGSID_USER', 'Olá'),
      ).rejects.toBe(unknownError);
    });
  });

  describe('sendQuickReplies', () => {
    it('should format quick_replies correctly', async () => {
      mockHttpService.post.mockReturnValue(of({ data: {} }));

      await service.sendQuickReplies(
        'PAGE123',
        'IGSID_USER',
        'Escolha uma opção:',
        ['Sim', 'Não'],
      );

      const callArgs = mockHttpService.post.mock.calls[0];
      expect(callArgs[1].message.quick_replies).toEqual([
        { content_type: 'text', title: 'Sim', payload: 'Sim' },
        { content_type: 'text', title: 'Não', payload: 'Não' },
      ]);
    });
  });

  describe('sendCommentPrivateReply', () => {
    it('should call Graph API with recipient.comment_id instead of an IGSID', async () => {
      mockHttpService.post.mockReturnValue(
        of({ data: { message_id: 'MSG_1' } }),
      );

      await service.sendCommentPrivateReply(
        'PAGE123',
        'COMMENT1',
        'Te chamei no privado!',
      );

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/PAGE123/messages',
        {
          recipient: { comment_id: 'COMMENT1' },
          message: { text: 'Te chamei no privado!' },
        },
        { params: { access_token: 'plaintext-token' } },
      );
    });

    it('should throw OAuthTokenExpiredException when Graph API returns error 190', async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() => ({ response: { data: { error: { code: 190 } } } })),
      );

      await expect(
        service.sendCommentPrivateReply('PAGE123', 'COMMENT1', 'Oi'),
      ).rejects.toThrow(OAuthTokenExpiredException);
    });
  });

  describe('markSeen', () => {
    it('should send mark_seen sender action', async () => {
      mockHttpService.post.mockReturnValue(of({ data: {} }));

      await service.markSeen('PAGE123', 'IGSID_USER');

      const callArgs = mockHttpService.post.mock.calls[0];
      expect(callArgs[1]).toEqual({
        recipient: { id: 'IGSID_USER' },
        sender_action: 'mark_seen',
      });
    });
  });

  describe('replyToComment', () => {
    it('should POST to /{commentId}/replies with the message as a param', async () => {
      mockHttpService.post.mockReturnValue(of({ data: { id: 'REPLY1' } }));

      await service.replyToComment('PAGE123', 'COMMENT1', 'Te enviamos na DM!');

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/COMMENT1/replies',
        {},
        { params: { access_token: 'plaintext-token', message: 'Te enviamos na DM!' } },
      );
    });

    it('should throw OAuthTokenExpiredException when Graph API returns error 190', async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() => ({ response: { data: { error: { code: 190 } } } })),
      );

      await expect(
        service.replyToComment('PAGE123', 'COMMENT1', 'Oi'),
      ).rejects.toThrow(OAuthTokenExpiredException);
    });

    it('should throw GraphApiRateLimitException on HTTP 429', async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() => ({ response: { status: 429, data: { error: { code: 4 } } } })),
      );

      await expect(
        service.replyToComment('PAGE123', 'COMMENT1', 'Oi'),
      ).rejects.toThrow(GraphApiRateLimitException);
    });

    it('should rethrow the original error when it does not match a known case', async () => {
      const unknownError = { response: { data: { error: { code: 100 } } } };
      mockHttpService.post.mockReturnValue(throwError(() => unknownError));

      await expect(
        service.replyToComment('PAGE123', 'COMMENT1', 'Oi'),
      ).rejects.toBe(unknownError);
    });
  });

  describe('sendButtonTemplate', () => {
    it('should send a button template with a single web_url button', async () => {
      mockHttpService.post.mockReturnValue(of({ data: { message_id: 'MSG_1' } }));

      await service.sendButtonTemplate(
        'PAGE123', 'IGSID_USER', 'Clique abaixo:', 'Entrar no grupo', 'https://chat.whatsapp.com/XXXX',
      );

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/PAGE123/messages',
        {
          recipient: { id: 'IGSID_USER' },
          message: {
            attachment: {
              type: 'template',
              payload: {
                template_type: 'button',
                text: 'Clique abaixo:',
                buttons: [{ type: 'web_url', url: 'https://chat.whatsapp.com/XXXX', title: 'Entrar no grupo' }],
              },
            },
          },
        },
        { params: { access_token: 'plaintext-token' } },
      );
    });

    it('should throw OAuthTokenExpiredException when Graph API returns error 190', async () => {
      mockHttpService.post.mockReturnValue(throwError(() => ({ response: { data: { error: { code: 190 } } } })));
      await expect(
        service.sendButtonTemplate('PAGE123', 'IGSID_USER', 'txt', 'btn', 'https://chat.whatsapp.com/X'),
      ).rejects.toThrow(OAuthTokenExpiredException);
    });
  });

  describe('setIceBreakers', () => {
    it('should POST to messenger_profile with locale "default" and the given questions', async () => {
      mockHttpService.post.mockReturnValue(of({ data: { success: true } }));

      await service.setIceBreakers('PAGE123', [
        { question: 'Quero entrar no grupo VIP 🎉', payload: 'PAYLOAD_1' },
      ]);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/PAGE123/messenger_profile',
        {
          platform: 'instagram',
          ice_breakers: [{
            locale: 'default',
            call_to_actions: [{ question: 'Quero entrar no grupo VIP 🎉', payload: 'PAYLOAD_1' }],
          }],
        },
        { params: { access_token: 'plaintext-token' } },
      );
    });

    it('should throw GraphApiRateLimitException on HTTP 429', async () => {
      mockHttpService.post.mockReturnValue(throwError(() => ({ response: { status: 429, data: { error: { code: 4 } } } })));
      await expect(service.setIceBreakers('PAGE123', [])).rejects.toThrow(GraphApiRateLimitException);
    });

    it('should rethrow the original error on an unrecognized Graph API error', async () => {
      const unknownError = { response: { data: { error: { code: 100 } } } };
      mockHttpService.post.mockReturnValue(throwError(() => unknownError));
      await expect(service.setIceBreakers('PAGE123', [])).rejects.toBe(unknownError);
    });
  });
});
