import { Test, TestingModule } from '@nestjs/testing';
import { ReplyBuilderService } from './reply-builder.service.js';
import { InstagramGraphService } from './instagram-graph.service.js';

const mockGraph = {
  sendTextMessage: jest.fn(),
  sendQuickReplies: jest.fn(),
  sendCommentPrivateReply: jest.fn(),
  replyToComment: jest.fn(),
  sendButtonTemplate: jest.fn(),
};

describe('ReplyBuilderService', () => {
  let service: ReplyBuilderService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReplyBuilderService,
        { provide: InstagramGraphService, useValue: mockGraph },
      ],
    }).compile();
    service = module.get<ReplyBuilderService>(ReplyBuilderService);
  });

  it('should call sendTextMessage when reply has only text', async () => {
    await service.send('PAGE1', 'USER1', { text: 'Olá!' });
    expect(mockGraph.sendTextMessage).toHaveBeenCalledWith(
      'PAGE1',
      'USER1',
      'Olá!',
    );
    expect(mockGraph.sendQuickReplies).not.toHaveBeenCalled();
  });

  it('should call sendQuickReplies when reply has text and quickReplies', async () => {
    await service.send('PAGE1', 'USER1', {
      text: 'Escolha:',
      quickReplies: ['Sim', 'Não'],
    });
    expect(mockGraph.sendQuickReplies).toHaveBeenCalledWith(
      'PAGE1',
      'USER1',
      'Escolha:',
      ['Sim', 'Não'],
    );
    expect(mockGraph.sendTextMessage).not.toHaveBeenCalled();
  });

  it('should call sendButtonTemplate when reply has text, buttonText and buttonUrl', async () => {
    await service.send('PAGE1', 'USER1', {
      text: 'Clique:',
      buttonText: 'Entrar no grupo',
      buttonUrl: 'https://chat.whatsapp.com/X',
    });
    expect(mockGraph.sendButtonTemplate).toHaveBeenCalledWith(
      'PAGE1',
      'USER1',
      'Clique:',
      'Entrar no grupo',
      'https://chat.whatsapp.com/X',
    );
    expect(mockGraph.sendTextMessage).not.toHaveBeenCalled();
    expect(mockGraph.sendQuickReplies).not.toHaveBeenCalled();
  });

  it('should prefer the button over quickReplies when both are present', async () => {
    await service.send('PAGE1', 'USER1', {
      text: 'Opções:',
      quickReplies: ['Ver preços'],
      buttonText: 'Entrar',
      buttonUrl: 'https://chat.whatsapp.com/X',
    });
    expect(mockGraph.sendButtonTemplate).toHaveBeenCalledWith(
      'PAGE1',
      'USER1',
      'Opções:',
      'Entrar',
      'https://chat.whatsapp.com/X',
    );
    expect(mockGraph.sendQuickReplies).not.toHaveBeenCalled();
  });

  describe('sendCommentReply', () => {
    it('should send a private reply to the comment via comment_id', async () => {
      await service.sendCommentReply('PAGE1', 'COMMENT1', {
        text: 'Te chamei no privado!',
      });
      expect(mockGraph.sendCommentPrivateReply).toHaveBeenCalledWith(
        'PAGE1',
        'COMMENT1',
        'Te chamei no privado!',
      );
    });

    it('should ignore buttonText/buttonUrl since comment private replies only support text', async () => {
      await service.sendCommentReply('PAGE1', 'COMMENT1', {
        text: 'Oi',
        buttonText: 'Entrar',
        buttonUrl: 'https://chat.whatsapp.com/X',
      });
      expect(mockGraph.sendCommentPrivateReply).toHaveBeenCalledWith(
        'PAGE1',
        'COMMENT1',
        'Oi',
      );
    });

    it('should ignore quickReplies since private comment replies do not support them', async () => {
      await service.sendCommentReply('PAGE1', 'COMMENT1', {
        text: 'Oi',
        quickReplies: ['A', 'B'],
      });
      expect(mockGraph.sendCommentPrivateReply).toHaveBeenCalledWith(
        'PAGE1',
        'COMMENT1',
        'Oi',
      );
    });
  });

  describe('sendPublicCommentReply', () => {
    it('should reply publicly to the comment via replyToComment', async () => {
      await service.sendPublicCommentReply(
        'PAGE1',
        'COMMENT1',
        'Te enviamos na DM!',
      );
      expect(mockGraph.replyToComment).toHaveBeenCalledWith(
        'PAGE1',
        'COMMENT1',
        'Te enviamos na DM!',
      );
    });
  });
});
