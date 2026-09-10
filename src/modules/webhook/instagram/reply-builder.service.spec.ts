import { Test, TestingModule } from '@nestjs/testing';
import { ReplyBuilderService } from './reply-builder.service.js';
import { InstagramGraphService } from './instagram-graph.service.js';

const mockGraph = {
  sendTextMessage: jest.fn(),
  sendQuickReplies: jest.fn(),
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
    expect(mockGraph.sendTextMessage).toHaveBeenCalledWith('PAGE1', 'USER1', 'Olá!');
    expect(mockGraph.sendQuickReplies).not.toHaveBeenCalled();
  });

  it('should call sendQuickReplies when reply has text and quickReplies', async () => {
    await service.send('PAGE1', 'USER1', { text: 'Escolha:', quickReplies: ['Sim', 'Não'] });
    expect(mockGraph.sendQuickReplies).toHaveBeenCalledWith('PAGE1', 'USER1', 'Escolha:', ['Sim', 'Não']);
    expect(mockGraph.sendTextMessage).not.toHaveBeenCalled();
  });

  it('should append waLink to text with newline when reply has text and waLink', async () => {
    await service.send('PAGE1', 'USER1', { text: 'Fale conosco:', waLink: 'https://wa.me/5511999' });
    expect(mockGraph.sendTextMessage).toHaveBeenCalledWith('PAGE1', 'USER1', 'Fale conosco:\nhttps://wa.me/5511999');
  });

  it('should append waLink to text in sendQuickReplies when all three fields present', async () => {
    await service.send('PAGE1', 'USER1', {
      text: 'Opções:',
      quickReplies: ['Ver preços'],
      waLink: 'https://wa.me/5511999',
    });
    expect(mockGraph.sendQuickReplies).toHaveBeenCalledWith(
      'PAGE1', 'USER1', 'Opções:\nhttps://wa.me/5511999', ['Ver preços'],
    );
  });
});
