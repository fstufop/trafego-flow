import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ConversationReplyDto } from './create-conversation-rule.dto.js';

describe('ConversationReplyDto', () => {
  it('should reject a non-string text even when no button is set', async () => {
    const dto = plainToInstance(ConversationReplyDto, { text: 12345 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'text')).toBe(true);
  });

  it('should reject text longer than 2000 chars even when no button is set', async () => {
    const dto = plainToInstance(ConversationReplyDto, {
      text: 'x'.repeat(2001),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'text')).toBe(true);
  });

  it('should accept a reply with only quickReplies and no text', async () => {
    const dto = plainToInstance(ConversationReplyDto, {
      quickReplies: ['Sim'],
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'text')).toBe(false);
  });

  it('should accept a reply with buttonText/buttonUrl and text (DTO no longer gates text behind the button condition)', async () => {
    const dto = plainToInstance(ConversationReplyDto, {
      text: 'Clique:',
      buttonText: 'Entrar',
      buttonUrl: 'https://chat.whatsapp.com/X',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
