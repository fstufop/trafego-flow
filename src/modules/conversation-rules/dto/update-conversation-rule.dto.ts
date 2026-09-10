import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ConversationReplyDto } from './create-conversation-rule.dto.js';

export class UpdateConversationRuleDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  triggerValue?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConversationReplyDto)
  reply?: ConversationReplyDto;
}
