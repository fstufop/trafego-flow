import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RuleType } from '../enums/rule-type.enum.js';

export class ConversationReplyDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(13)
  @IsString({ each: true })
  @MaxLength(13, { each: true })
  quickReplies?: string[];

  @IsOptional()
  @IsUrl()
  waLink?: string;
}

export class CreateConversationRuleDto {
  @IsUUID()
  clientId: string;

  @IsEnum(RuleType)
  type: RuleType;

  @ValidateIf(o => o.type !== RuleType.DEFAULT)
  @IsString()
  triggerValue?: string;

  @ValidateNested()
  @Type(() => ConversationReplyDto)
  reply: ConversationReplyDto;
}
