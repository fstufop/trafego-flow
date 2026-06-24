import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { InstagramWebhookService } from './instagram-webhook.service.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import { IntegrationEntity, MetaPlatform } from '../../integrations/entities/integration.entity.js';
import { InstagramWebhookPayload } from './interfaces/instagram-webhook-event.interface.js';

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';

const mockIntegration: Partial<IntegrationEntity> = {
  id: 'uuid-int-1',
  clientId: 'uuid-client-1',
  platform: MetaPlatform.INSTAGRAM,
  pageId: 'PAGE123',
  isActive: true,
};

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'meta.verifyToken') return VERIFY_TOKEN;
    if (key === 'meta.appSecret') return APP_SECRET;
    return undefined;
  }),
};

const mockIntegrationsService = {
  findByPageId: jest.fn(),
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
        { provide: IntegrationsService, useValue: mockIntegrationsService },
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
    const payload: InstagramWebhookPayload = {
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
      const rawBody = Buffer.from(JSON.stringify(payload));
      await expect(service.handleEvent(payload, rawBody, 'sha256=invalidsig')).rejects.toThrow(ForbiddenException);
    });

    it('should process event when signature is valid', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(mockIntegration);
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = makeSignature(rawBody);

      await expect(service.handleEvent(payload, rawBody, signature)).resolves.toBeUndefined();
      expect(mockIntegrationsService.findByPageId).toHaveBeenCalledWith('PAGE123');
    });

    it('should silently discard event for unknown pageId (no error to Meta)', async () => {
      mockIntegrationsService.findByPageId.mockRejectedValue(new Error('Not found'));
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = makeSignature(rawBody);

      await expect(service.handleEvent(payload, rawBody, signature)).resolves.toBeUndefined();
    });
  });
});
