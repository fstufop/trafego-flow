import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { InstagramWebhookService } from './instagram-webhook.service.js';
import { ConversationBotService } from './conversation-bot.service.js';
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

const mockBotService = {
  handleDm: jest.fn().mockResolvedValue(undefined),
  handleComment: jest.fn().mockResolvedValue(undefined),
};

function makeSignature(rawBody: Buffer): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')}`;
}

describe('InstagramWebhookService', () => {
  let service: InstagramWebhookService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstagramWebhookService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: ConversationBotService, useValue: mockBotService },
      ],
    }).compile();

    service = module.get<InstagramWebhookService>(InstagramWebhookService);
  });

  describe('verifyWebhook', () => {
    it('should return challenge when mode and token are correct', () => {
      expect(service.verifyWebhook('subscribe', VERIFY_TOKEN, 'CHALLENGE_ABC')).toBe('CHALLENGE_ABC');
    });

    it('should throw ForbiddenException with wrong token', () => {
      expect(() => service.verifyWebhook('subscribe', 'wrong-token', 'ABC')).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException with wrong mode', () => {
      expect(() => service.verifyWebhook('unsubscribe', VERIFY_TOKEN, 'ABC')).toThrow(ForbiddenException);
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

    it('should throw ForbiddenException with invalid signature', () => {
      const rawBody = Buffer.from(JSON.stringify(dmPayload));
      expect(() => service.handleEvent(dmPayload, rawBody, 'sha256=invalidsig')).toThrow(ForbiddenException);
    });

    it('should return void immediately (fire-and-forget) when signature is valid', () => {
      const rawBody = Buffer.from(JSON.stringify(dmPayload));
      const result = service.handleEvent(dmPayload, rawBody, makeSignature(rawBody));
      expect(result).toBeUndefined();
    });

    it('should dispatch messaging events to handleDm (fire-and-forget)', (done) => {
      const rawBody = Buffer.from(JSON.stringify(dmPayload));
      service.handleEvent(dmPayload, rawBody, makeSignature(rawBody));
      setImmediate(() => {
        expect(mockBotService.handleDm).toHaveBeenCalledWith('PAGE123', 'IGSID_USER', 'Olá');
        done();
      });
    });

    it('should dispatch comment changes with verb=add to handleComment', (done) => {
      const commentPayload: InstagramWebhookPayload = {
        object: 'instagram',
        entry: [{
          id: 'PAGE1',
          time: 1,
          changes: [{
            field: 'comments',
            value: {
              from: { id: 'COMMENTER1', name: 'Ana' },
              post_id: 'POST123',
              comment_id: 'C1',
              message: 'oi',
              item: 'comment',
              verb: 'add',
            },
          }],
        }],
      };
      const rawBody = Buffer.from(JSON.stringify(commentPayload));
      service.handleEvent(commentPayload, rawBody, makeSignature(rawBody));
      setImmediate(() => {
        expect(mockBotService.handleComment).toHaveBeenCalledWith('PAGE1', 'POST123', 'COMMENTER1');
        done();
      });
    });

    it('should ignore comment changes with verb !== add', (done) => {
      const editedPayload: InstagramWebhookPayload = {
        object: 'instagram',
        entry: [{
          id: 'PAGE1',
          time: 1,
          changes: [{
            field: 'comments',
            value: {
              from: { id: 'COMMENTER1', name: 'Ana' },
              post_id: 'POST123',
              comment_id: 'C1',
              message: 'oi',
              item: 'comment',
              verb: 'edited',
            },
          }],
        }],
      };
      const rawBody = Buffer.from(JSON.stringify(editedPayload));
      service.handleEvent(editedPayload, rawBody, makeSignature(rawBody));
      setImmediate(() => {
        expect(mockBotService.handleComment).not.toHaveBeenCalled();
        done();
      });
    });
  });
});
