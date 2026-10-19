import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { createHmac } from 'crypto';
import { InstagramWebhookService } from './instagram-webhook.service.js';
import { InstagramWebhookPayload } from './interfaces/instagram-webhook-event.interface.js';

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'meta.verifyToken') return VERIFY_TOKEN;
    if (key === 'meta.appSecret') return APP_SECRET;
    return undefined;
  }),
};

const mockQueue = {
  add: jest.fn().mockResolvedValue(undefined),
};

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstagramWebhookService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: getQueueToken('instagram-webhook'), useValue: mockQueue },
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

    it('should log the received payload even when the signature is invalid', async () => {
      const rawBody = Buffer.from(JSON.stringify(dmPayload));
      await expect(
        service.handleEvent(dmPayload, rawBody, 'sha256=invalidsig'),
      ).rejects.toThrow(ForbiddenException);

      expect(logSpy).toHaveBeenCalledWith(
        `Instagram webhook payload received: ${JSON.stringify(dmPayload)}`,
      );
    });

    it('should log the received payload when the signature is valid', async () => {
      const rawBody = Buffer.from(JSON.stringify(dmPayload));
      await service.handleEvent(dmPayload, rawBody, makeSignature(rawBody));

      expect(logSpy).toHaveBeenCalledWith(
        `Instagram webhook payload received: ${JSON.stringify(dmPayload)}`,
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
        { pageId: 'PAGE1', postId: 'POST123', commentId: 'C1' },
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
  });
});
