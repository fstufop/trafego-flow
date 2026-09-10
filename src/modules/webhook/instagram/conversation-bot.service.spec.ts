import { Test, TestingModule } from '@nestjs/testing';
import { ConversationBotService } from './conversation-bot.service.js';
import { ConversationRulesService } from '../../conversation-rules/conversation-rules.service.js';
import { IntegrationsService } from '../../integrations/integrations.service.js';
import { ReplyBuilderService } from './reply-builder.service.js';

const mockRulesService = {
  findKeywordRule: jest.fn(),
  findDefaultRule: jest.fn(),
  findPostRule: jest.fn(),
};

const mockIntegrationsService = {
  findByPageId: jest.fn(),
};

const mockReplyBuilder = {
  send: jest.fn(),
};

const activeIntegration = { clientId: 'client-1', isActive: true };

describe('ConversationBotService', () => {
  let service: ConversationBotService;

  beforeEach(async () => {
    jest.clearAllMocks();
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
      expect(mockReplyBuilder.send).toHaveBeenCalledWith('PAGE1', 'USER1', rule.reply);
      expect(mockRulesService.findDefaultRule).not.toHaveBeenCalled();
    });

    it('should fall back to default rule when no keyword matches', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      mockRulesService.findKeywordRule.mockResolvedValue(null);
      const defaultRule = { reply: { text: 'Olá!' } };
      mockRulesService.findDefaultRule.mockResolvedValue(defaultRule);
      mockReplyBuilder.send.mockResolvedValue(undefined);
      await service.handleDm('PAGE1', 'USER1', 'oi');
      expect(mockReplyBuilder.send).toHaveBeenCalledWith('PAGE1', 'USER1', defaultRule.reply);
    });

    it('should stay silent when no rules match at all', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      mockRulesService.findKeywordRule.mockResolvedValue(null);
      mockRulesService.findDefaultRule.mockResolvedValue(null);
      await service.handleDm('PAGE1', 'USER1', 'oi');
      expect(mockReplyBuilder.send).not.toHaveBeenCalled();
    });

    it('should stay silent when integration is not found', async () => {
      mockIntegrationsService.findByPageId.mockRejectedValue(new Error('Not found'));
      await service.handleDm('PAGE1', 'USER1', 'quero');
      expect(mockReplyBuilder.send).not.toHaveBeenCalled();
    });
  });

  describe('handleComment', () => {
    it('should send reply when post rule exists', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      const rule = { reply: { text: 'DM enviada!' } };
      mockRulesService.findPostRule.mockResolvedValue(rule);
      mockReplyBuilder.send.mockResolvedValue(undefined);
      await service.handleComment('PAGE1', 'POST123', 'COMMENTER1');
      expect(mockReplyBuilder.send).toHaveBeenCalledWith('PAGE1', 'COMMENTER1', rule.reply);
    });

    it('should stay silent when no post rule exists', async () => {
      mockIntegrationsService.findByPageId.mockResolvedValue(activeIntegration);
      mockRulesService.findPostRule.mockResolvedValue(null);
      await service.handleComment('PAGE1', 'POST123', 'COMMENTER1');
      expect(mockReplyBuilder.send).not.toHaveBeenCalled();
    });

    it('should stay silent when integration not found', async () => {
      mockIntegrationsService.findByPageId.mockRejectedValue(new Error('Not found'));
      await service.handleComment('PAGE1', 'POST123', 'COMMENTER1');
      expect(mockReplyBuilder.send).not.toHaveBeenCalled();
    });
  });
});
