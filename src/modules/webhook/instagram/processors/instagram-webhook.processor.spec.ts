import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { InstagramWebhookProcessor } from './instagram-webhook.processor.js';
import { ConversationBotService } from '../conversation-bot.service.js';
import {
  InstagramCommentJobPayload,
  InstagramDmJobPayload,
} from '../types/instagram-webhook-job.type.js';

const mockBotService = {
  handleDm: jest.fn().mockResolvedValue(undefined),
  handleComment: jest.fn().mockResolvedValue(undefined),
};

function makeJob<T>(name: string, data: T): Job<T> {
  return { name, data } as Job<T>;
}

describe('InstagramWebhookProcessor', () => {
  let processor: InstagramWebhookProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstagramWebhookProcessor,
        { provide: ConversationBotService, useValue: mockBotService },
      ],
    }).compile();
    processor = module.get<InstagramWebhookProcessor>(
      InstagramWebhookProcessor,
    );
  });

  it('should call botService.handleDm for a dm job', async () => {
    const job = makeJob<InstagramDmJobPayload>('dm', {
      pageId: 'PAGE1',
      senderId: 'USER1',
      text: 'oi',
    });
    await processor.process(job);
    expect(mockBotService.handleDm).toHaveBeenCalledWith(
      'PAGE1',
      'USER1',
      'oi',
    );
    expect(mockBotService.handleComment).not.toHaveBeenCalled();
  });

  it('should call botService.handleComment for a comment job', async () => {
    const job = makeJob<InstagramCommentJobPayload>('comment', {
      pageId: 'PAGE1',
      postId: 'POST1',
      commentId: 'COMMENT1',
    });
    await processor.process(job);
    expect(mockBotService.handleComment).toHaveBeenCalledWith(
      'PAGE1',
      'POST1',
      'COMMENT1',
    );
    expect(mockBotService.handleDm).not.toHaveBeenCalled();
  });

  it('should do nothing for an unknown job name', async () => {
    const job = makeJob('unknown', {});
    await processor.process(job as Job<InstagramDmJobPayload>);
    expect(mockBotService.handleDm).not.toHaveBeenCalled();
    expect(mockBotService.handleComment).not.toHaveBeenCalled();
  });
});
