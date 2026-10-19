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
        'https://graph.facebook.com/v21.0/me/messages',
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
        'https://graph.facebook.com/v21.0/me/messages',
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
});
