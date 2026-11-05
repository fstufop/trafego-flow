import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { createHmac } from 'crypto';
import { InstagramWebhookService } from './instagram-webhook.service.js';
import { InstagramWebhookPayload } from './interfaces/instagram-webhook-event.interface.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import { AesCryptoService } from '../../../common/crypto/aes.service.js';

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'meta.verifyToken') return VERIFY_TOKEN;
    return undefined;
  }),
};

const mockQueue = {
  add: jest.fn().mockResolvedValue(undefined),
};

const mockIntegrationsService = { findByPageId: jest.fn() };
const mockCrypto = { decrypt: jest.fn() };

function makeSignature(rawBody: Buffer): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')}`;
}

describe('InstagramWebhookService', () => {
  let service: InstagramWebhookService;
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    mockIntegrationsService.findByPageId.mockResolvedValue({
      appSecret: 'encrypted-app-secret',
      client: { name: 'Acme Corp' },
    });
    mockCrypto.decrypt.mockImplementation((value: string | null) => {
      if (!value) throw new Error('no app secret configured');
      return APP_SECRET;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstagramWebhookService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: getQueueToken('instagram-webhook'), useValue: mockQueue },
        { provide: IntegrationsService, useValue: mockIntegrationsService },
        { provide: AesCryptoService, useValue: mockCrypto },
      ],
    }).compile();

    service = module.get<InstagramWebhookService>(InstagramWebhookService);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('verifyWebhook', () => {
    it('should return challenge when mode and token are correct', () => {
      expect(
        service.verifyWebhook('subscribe', VERIFY_TOKEN, 'CHALLENGE_ABC'),
      ).toBe('CHALLENGE_ABC');
    });

    it('should throw ForbiddenException with wrong token', () => {
      expect(() =>
        service.verifyWebhook('subscribe', 'wrong-token', 'ABC'),
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException with wrong mode', () => {
      expect(() =>
        service.verifyWebhook('unsubscribe', VERIFY_TOKEN, 'ABC'),
      ).toThrow(ForbiddenException);
    });
  });

  describe('handleEvent', () => {
    const dmPayload: InstagramWebhookPayload = {
      object: 'instagram',
      entry: [
        {
          id: 'PAGE123',
          time: 1700000000,
          messaging: [
            {
              sender: { id: 'IGSID_USER' },
              recipient: { id: 'PAGE123' },
              timestamp: 1700000000,
              message: { mid: 'MID_1', text: 'Olá' },
            },
          ],
        },
      ],
    };

    it('should throw ForbiddenException with invalid signature', async () => {
      const rawBody = Buffer.from(JSON.stringify(dmPayload));
      await expect(
        service.handleEvent(dmPayload, rawBody, 'sha256=invalidsig'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should validate the signature against the app secret of the integration owning the page', async () => {
      const rawBody = Buffer.from(JSON.stringify(dmPayload));
      await service.handleEvent(dmPayload, rawBody, makeSignature(rawBody));

      expect(mockIntegrationsService.findByPageId).toHaveBeenCalledWith(
        'PAGE123',
      );
      expect(mockCrypto.decrypt).toHaveBeenCalledWith('encrypted-app-secret');
    });

    it('should reject a valid-looking signature computed with another tenant app secret', async () => {
      const otherTenantSignature = `sha256=${createHmac(
        'sha256',
        'someone-elses-secret',
      )
        .update(Buffer.from(JSON.stringify(dmPayload)))
        .digest('hex')}`;
      const rawBody = Buffer.from(JSON.stringify(dmPayload));

      await expect(
        service.handleEvent(dmPayload, rawBody, otherTenantSignature),
      ).rejects.toThrow(ForbiddenException);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when no integration is registered for the page', async () => {
      mockIntegrationsService.findByPageId.mockRejectedValueOnce(
        new NotFoundException('Integration for pageId PAGE123 not found'),
      );
      const rawBody = Buffer.from(JSON.stringify(dmPayload));

      await expect(
        service.handleEvent(dmPayload, rawBody, makeSignature(rawBody)),
      ).rejects.toThrow(ForbiddenException);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when the integration has no app secret configured', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValueOnce({
        appSecret: null,
      });
      const rawBody = Buffer.from(JSON.stringify(dmPayload));

      await expect(
        service.handleEvent(dmPayload, rawBody, makeSignature(rawBody)),
      ).rejects.toThrow(ForbiddenException);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should log the received payload with the account name even when the signature is invalid', async () => {
      const rawBody = Buffer.from(JSON.stringify(dmPayload));
      await expect(
        service.handleEvent(dmPayload, rawBody, 'sha256=invalidsig'),
      ).rejects.toThrow(ForbiddenException);

      expect(logSpy).toHaveBeenCalledWith(
        `Instagram webhook payload received (account: Acme Corp): ${JSON.stringify(dmPayload)}`,
      );
    });

    it('should log the received payload with the account name when the signature is valid', async () => {
      const rawBody = Buffer.from(JSON.stringify(dmPayload));
      await service.handleEvent(dmPayload, rawBody, makeSignature(rawBody));

      expect(logSpy).toHaveBeenCalledWith(
        `Instagram webhook payload received (account: Acme Corp): ${JSON.stringify(dmPayload)}`,
      );
    });

    it('should fall back to the pageId in the log when no integration is registered for the page', async () => {
      mockIntegrationsService.findByPageId.mockRejectedValueOnce(
        new NotFoundException('Integration for pageId PAGE123 not found'),
      );
      const rawBody = Buffer.from(JSON.stringify(dmPayload));

      await expect(
        service.handleEvent(dmPayload, rawBody, makeSignature(rawBody)),
      ).rejects.toThrow(ForbiddenException);

      expect(logSpy).toHaveBeenCalledWith(
        `Instagram webhook payload received (account: PAGE123): ${JSON.stringify(dmPayload)}`,
      );
    });

    it('should enqueue a dm job with the correct payload and retry options', async () => {
      const rawBody = Buffer.from(JSON.stringify(dmPayload));
      await service.handleEvent(dmPayload, rawBody, makeSignature(rawBody));

      expect(mockQueue.add).toHaveBeenCalledWith(
        'dm',
        { pageId: 'PAGE123', senderId: 'IGSID_USER', text: 'Olá' },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
    });

    it('should enqueue a comment job for a comment change event using the real Instagram payload shape', async () => {
      const commentPayload: InstagramWebhookPayload = {
        object: 'instagram',
        entry: [
          {
            id: 'PAGE1',
            time: 1,
            changes: [
              {
                field: 'comments',
                value: {
                  from: { id: 'COMMENTER1', username: 'ana' },
                  media: { id: 'POST123', media_product_type: 'FEED' },
                  id: 'C1',
                  parent_id: 'PARENT1',
                  text: 'oi',
                },
              },
            ],
          },
        ],
      };
      const rawBody = Buffer.from(JSON.stringify(commentPayload));
      await service.handleEvent(
        commentPayload,
        rawBody,
        makeSignature(rawBody),
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'comment',
        { pageId: 'PAGE1', postId: 'POST123', commentId: 'C1', text: 'oi' },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
    });

    it('should ignore changes for fields other than comments', async () => {
      const otherFieldPayload: InstagramWebhookPayload = {
        object: 'instagram',
        entry: [
          {
            id: 'PAGE1',
            time: 1,
            changes: [
              {
                field: 'mentions' as 'comments',
                value: {
                  from: { id: 'COMMENTER1', username: 'ana' },
                  media: { id: 'POST123', media_product_type: 'FEED' },
                  id: 'C1',
                  text: 'oi',
                },
              },
            ],
          },
        ],
      };
      const rawBody = Buffer.from(JSON.stringify(otherFieldPayload));
      await service.handleEvent(
        otherFieldPayload,
        rawBody,
        makeSignature(rawBody),
      );

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should log a warning and not throw when enqueueing fails', async () => {
      mockQueue.add.mockRejectedValueOnce(new Error('redis down'));
      const rawBody = Buffer.from(JSON.stringify(dmPayload));

      await expect(
        service.handleEvent(dmPayload, rawBody, makeSignature(rawBody)),
      ).resolves.toBeUndefined();
    });

    it('should enqueue a postback job (not a dm job) when the messaging event has a postback', async () => {
      const postbackPayload: InstagramWebhookPayload = {
        object: 'instagram',
        entry: [
          {
            id: 'PAGE1',
            time: 1,
            messaging: [
              {
                sender: { id: 'USER1' },
                recipient: { id: 'PAGE1' },
                timestamp: 1,
                postback: {
                  payload: 'ICEBREAKER_PAYLOAD_1',
                  title: 'Quero o grupo',
                },
              },
            ],
          },
        ],
      };
      const rawBody = Buffer.from(JSON.stringify(postbackPayload));
      await service.handleEvent(
        postbackPayload,
        rawBody,
        makeSignature(rawBody),
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        'postback',
        { pageId: 'PAGE1', senderId: 'USER1', payload: 'ICEBREAKER_PAYLOAD_1' },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
    });

    it('should not enqueue a dm job for an event that has only a postback', async () => {
      const postbackPayload: InstagramWebhookPayload = {
        object: 'instagram',
        entry: [
          {
            id: 'PAGE1',
            time: 1,
            messaging: [
              {
                sender: { id: 'USER1' },
                recipient: { id: 'PAGE1' },
                timestamp: 1,
                postback: { payload: 'P1' },
              },
            ],
          },
        ],
      };
      const rawBody = Buffer.from(JSON.stringify(postbackPayload));
      await service.handleEvent(
        postbackPayload,
        rawBody,
        makeSignature(rawBody),
      );
      expect(mockQueue.add).not.toHaveBeenCalledWith(
        'dm',
        expect.anything(),
        expect.anything(),
      );
    });

    it('should not enqueue anything for a messaging event with neither message nor postback (e.g. a read receipt)', async () => {
      const readReceiptPayload: InstagramWebhookPayload = {
        object: 'instagram',
        entry: [
          {
            id: 'PAGE1',
            time: 1,
            messaging: [
              {
                sender: { id: 'USER1' },
                recipient: { id: 'PAGE1' },
                timestamp: 1,
                read: { mid: 'MID1' },
              },
            ],
          },
        ],
      };
      const rawBody = Buffer.from(JSON.stringify(readReceiptPayload));
      await service.handleEvent(
        readReceiptPayload,
        rawBody,
        makeSignature(rawBody),
      );
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });
});
