import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
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

  @ValidateIf((o) => !!o.buttonUrl || !!o.buttonText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  buttonText?: string;

  @ValidateIf((o) => !!o.buttonText || !!o.buttonUrl)
  @IsUrl({ protocols: ['https'] })
  buttonUrl?: string;
}

export class CreateConversationRuleDto {
  @IsUUID()
  clientId: string;

  @IsEnum(RuleType)
  type: RuleType;

  @ValidateIf(
    (o) => o.type !== RuleType.DEFAULT && o.type !== RuleType.ICEBREAKER,
  )
  @IsString()
  triggerValue?: string;

  @ValidateNested()
  @Type(() => ConversationReplyDto)
  reply: ConversationReplyDto;

  @ValidateIf((o) => o.type === RuleType.POST_COMMENT)
  @IsString()
  commentKeyword?: string;

  @ValidateIf((o) => o.type === RuleType.POST_COMMENT)
  @IsString()
  publicReply?: string;

  @ValidateIf((o) => o.type === RuleType.ICEBREAKER)
  @IsString()
  @MaxLength(80)
  icebreakerQuestion?: string;
}
