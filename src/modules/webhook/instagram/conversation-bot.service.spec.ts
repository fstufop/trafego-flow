import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConversationBotService } from './conversation-bot.service.js';
import { ConversationRulesService } from '../../conversation-rules/conversation-rules.service.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import { ReplyBuilderService } from './reply-builder.service.js';
import { GraphApiRateLimitException } from './exceptions/graph-api-rate-limit.exception.js';

const mockRulesService = {
  findKeywordRule: jest.fn(),
  findDefaultRule: jest.fn(),
  findPostRule: jest.fn(),
  findIcebreakerRule: jest.fn(),
};

const mockIntegrationsService = {
  findByPageId: jest.fn(),
};

const mockReplyBuilder = {
  send: jest.fn(),
  sendCommentReply: jest.fn(),
  sendPublicCommentReply: jest.fn(),
};

const activeIntegration = { clientId: 'client-1', isActive: true };

describe('ConversationBotService', () => {
  let service: ConversationBotService;
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationBotService,
        { provide: ConversationRulesService, useValue: mockRulesService },
        { provide: IntegrationsService, useValue: mockIntegrationsService },
        { provide: ReplyBuilderService, useValue: mockReplyBuilder },
      ],
    }).compile();
    service = module.get<ConversationBotService>(ConversationBotService);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('handleDm', () => {
    it('should do nothing when senderId equals pageId (loop prevention)', async () => {
      await service.handleDm('PAGE1', 'PAGE1', 'quero');
      expect(mockIntegrationsService.findByPageId).not.toHaveBeenCalled();
    });

    it('should do nothing when text is undefined', async () => {
      await service.handleDm('PAGE1', 'USER1', undefined);
      expect(mockIntegrationsService.findByPageId).not.toHaveBeenCalled();
    });

    it('should send keyword rule reply when keyword matches', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      const rule = { reply: { text: 'Oi!' } };
      mockRulesService.findKeywordRule.mockResolvedValue(rule);
      mockReplyBuilder.send.mockResolvedValue(undefined);
      await service.handleDm('PAGE1', 'USER1', 'quero comprar');
      expect(mockReplyBuilder.send).toHaveBeenCalledWith(
        'PAGE1',
        'USER1',
        rule.reply,
      );
      expect(mockRulesService.findDefaultRule).not.toHaveBeenCalled();
    });

    it('should fall back to default rule when no keyword matches', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      mockRulesService.findKeywordRule.mockResolvedValue(null);
      const defaultRule = { reply: { text: 'Olá!' } };
      mockRulesService.findDefaultRule.mockResolvedValue(defaultRule);
      mockReplyBuilder.send.mockResolvedValue(undefined);
      await service.handleDm('PAGE1', 'USER1', 'oi');
      expect(mockReplyBuilder.send).toHaveBeenCalledWith(
        'PAGE1',
        'USER1',
        defaultRule.reply,
      );
    });

    it('should stay silent when no rules match at all', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      mockRulesService.findKeywordRule.mockResolvedValue(null);
      mockRulesService.findDefaultRule.mockResolvedValue(null);
      await service.handleDm('PAGE1', 'USER1', 'oi');
      expect(mockReplyBuilder.send).not.toHaveBeenCalled();
    });

    it('should stay silent when integration is not found', async () => {
      mockIntegrationsService.findByPageId.mockRejectedValue(
        new Error('Not found'),
      );
      await service.handleDm('PAGE1', 'USER1', 'quero');
      expect(mockReplyBuilder.send).not.toHaveBeenCalled();
    });

    it('should log a warning when integration lookup fails', async () => {
      mockIntegrationsService.findByPageId.mockRejectedValue(
        new Error('Not found'),
      );
      await service.handleDm('PAGE1', 'USER1', 'quero');
      expect(warnSpy).toHaveBeenCalledWith(
        'No integration found for pageId PAGE1 (dm): Not found',
      );
    });

    it('should swallow a non-rate-limit send failure (e.g. expired window)', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      const rule = { reply: { text: 'Oi!' } };
      mockRulesService.findKeywordRule.mockResolvedValue(rule);
      mockReplyBuilder.send.mockRejectedValue(new Error('window expired'));
      await expect(
        service.handleDm('PAGE1', 'USER1', 'quero'),
      ).resolves.toBeUndefined();
    });

    it('should rethrow a rate-limit send failure so the job can be retried', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      const rule = { reply: { text: 'Oi!' } };
      mockRulesService.findKeywordRule.mockResolvedValue(rule);
      mockReplyBuilder.send.mockRejectedValue(
        new GraphApiRateLimitException('PAGE1'),
      );
      await expect(service.handleDm('PAGE1', 'USER1', 'quero')).rejects.toThrow(
        GraphApiRateLimitException,
      );
    });
  });

  describe('handleComment', () => {
    it('should send both the private DM reply and the public comment reply when post rule matches', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      const rule = {
        reply: { text: 'DM enviada!' },
        publicReply: 'Te enviamos na DM!',
      };
      mockRulesService.findPostRule.mockResolvedValue(rule);
      mockReplyBuilder.sendCommentReply.mockResolvedValue(undefined);
      mockReplyBuilder.sendPublicCommentReply.mockResolvedValue(undefined);
      await service.handleComment('PAGE1', 'POST123', 'COMMENT1', 'quero');
      expect(mockReplyBuilder.sendCommentReply).toHaveBeenCalledWith(
        'PAGE1',
        'COMMENT1',
        rule.reply,
      );
      expect(mockReplyBuilder.sendPublicCommentReply).toHaveBeenCalledWith(
        'PAGE1',
        'COMMENT1',
        rule.publicReply,
      );
      expect(mockRulesService.findPostRule).toHaveBeenCalledWith(
        'client-1',
        'POST123',
        'quero',
      );
    });

    it('should stay silent when no post rule matches (wrong post or missing keyword)', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      mockRulesService.findPostRule.mockResolvedValue(null);
      await service.handleComment('PAGE1', 'POST123', 'COMMENT1', 'oi');
      expect(mockReplyBuilder.sendCommentReply).not.toHaveBeenCalled();
      expect(mockReplyBuilder.sendPublicCommentReply).not.toHaveBeenCalled();
    });

    it('should stay silent when integration not found', async () => {
      mockIntegrationsService.findByPageId.mockRejectedValue(
        new Error('Not found'),
      );
      await service.handleComment('PAGE1', 'POST123', 'COMMENT1', 'quero');
      expect(mockReplyBuilder.sendCommentReply).not.toHaveBeenCalled();
      expect(mockReplyBuilder.sendPublicCommentReply).not.toHaveBeenCalled();
    });

    it('should log a warning when integration lookup fails', async () => {
      mockIntegrationsService.findByPageId.mockRejectedValue(
        new Error('Not found'),
      );
      await service.handleComment('PAGE1', 'POST123', 'COMMENT1', 'quero');
      expect(warnSpy).toHaveBeenCalledWith(
        'No integration found for pageId PAGE1 (comment): Not found',
      );
    });

    it('should still attempt the public reply even when the private DM send fails', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      const rule = {
        reply: { text: 'DM enviada!' },
        publicReply: 'Te enviamos na DM!',
      };
      mockRulesService.findPostRule.mockResolvedValue(rule);
      mockReplyBuilder.sendCommentReply.mockRejectedValue(
        new Error('window expired'),
      );
      mockReplyBuilder.sendPublicCommentReply.mockResolvedValue(undefined);
      await expect(
        service.handleComment('PAGE1', 'POST123', 'COMMENT1', 'quero'),
      ).resolves.toBeUndefined();
      expect(mockReplyBuilder.sendPublicCommentReply).toHaveBeenCalled();
    });

    it('should still attempt the private DM even when the public reply send fails', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      const rule = {
        reply: { text: 'DM enviada!' },
        publicReply: 'Te enviamos na DM!',
      };
      mockRulesService.findPostRule.mockResolvedValue(rule);
      mockReplyBuilder.sendCommentReply.mockResolvedValue(undefined);
      mockReplyBuilder.sendPublicCommentReply.mockRejectedValue(
        new Error('comment deleted'),
      );
      await expect(
        service.handleComment('PAGE1', 'POST123', 'COMMENT1', 'quero'),
      ).resolves.toBeUndefined();
      expect(mockReplyBuilder.sendCommentReply).toHaveBeenCalled();
    });

    it('should swallow non-rate-limit failures on both sends', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      const rule = {
        reply: { text: 'DM enviada!' },
        publicReply: 'Te enviamos na DM!',
      };
      mockRulesService.findPostRule.mockResolvedValue(rule);
      mockReplyBuilder.sendCommentReply.mockRejectedValue(
        new Error('window expired'),
      );
      mockReplyBuilder.sendPublicCommentReply.mockRejectedValue(
        new Error('comment deleted'),
      );
      await expect(
        service.handleComment('PAGE1', 'POST123', 'COMMENT1', 'quero'),
      ).resolves.toBeUndefined();
    });

    it('should rethrow when the private DM send hits a rate limit, after both sends complete', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      const rule = {
        reply: { text: 'DM enviada!' },
        publicReply: 'Te enviamos na DM!',
      };
      mockRulesService.findPostRule.mockResolvedValue(rule);
      mockReplyBuilder.sendCommentReply.mockRejectedValue(
        new GraphApiRateLimitException('PAGE1'),
      );
      mockReplyBuilder.sendPublicCommentReply.mockResolvedValue(undefined);
      await expect(
        service.handleComment('PAGE1', 'POST123', 'COMMENT1', 'quero'),
      ).rejects.toThrow(GraphApiRateLimitException);
      expect(mockReplyBuilder.sendPublicCommentReply).toHaveBeenCalled();
    });

    it('should rethrow when the public reply send hits a rate limit', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      const rule = {
        reply: { text: 'DM enviada!' },
        publicReply: 'Te enviamos na DM!',
      };
      mockRulesService.findPostRule.mockResolvedValue(rule);
      mockReplyBuilder.sendCommentReply.mockResolvedValue(undefined);
      mockReplyBuilder.sendPublicCommentReply.mockRejectedValue(
        new GraphApiRateLimitException('PAGE1'),
      );
      await expect(
        service.handleComment('PAGE1', 'POST123', 'COMMENT1', 'quero'),
      ).rejects.toThrow(GraphApiRateLimitException);
    });
  });

  describe('handleIcebreaker', () => {
    it('should send the matched rule reply', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      const rule = {
        reply: {
          text: 'Oi!',
          buttonText: 'Entrar',
          buttonUrl: 'https://chat.whatsapp.com/X',
        },
      };
      mockRulesService.findIcebreakerRule.mockResolvedValue(rule);
      mockReplyBuilder.send.mockResolvedValue(undefined);
      await service.handleIcebreaker('PAGE1', 'USER1', 'PAYLOAD_1');
      expect(mockRulesService.findIcebreakerRule).toHaveBeenCalledWith(
        'client-1',
        'PAYLOAD_1',
      );
      expect(mockReplyBuilder.send).toHaveBeenCalledWith(
        'PAGE1',
        'USER1',
        rule.reply,
      );
    });

    it('should stay silent when no rule matches the payload', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      mockRulesService.findIcebreakerRule.mockResolvedValue(null);
      await service.handleIcebreaker('PAGE1', 'USER1', 'UNKNOWN_PAYLOAD');
      expect(mockReplyBuilder.send).not.toHaveBeenCalled();
    });

    it('should stay silent when the integration is not found', async () => {
      mockIntegrationsService.findByPageId.mockRejectedValue(
        new Error('Not found'),
      );
      await service.handleIcebreaker('PAGE1', 'USER1', 'P1');
      expect(mockReplyBuilder.send).not.toHaveBeenCalled();
    });

    it('should rethrow a rate-limit send failure so the job can be retried', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      mockRulesService.findIcebreakerRule.mockResolvedValue({
        reply: { text: 'Oi' },
      });
      mockReplyBuilder.send.mockRejectedValue(
        new GraphApiRateLimitException('PAGE1'),
      );
      await expect(
        service.handleIcebreaker('PAGE1', 'USER1', 'P1'),
      ).rejects.toThrow(GraphApiRateLimitException);
    });
  });
});
