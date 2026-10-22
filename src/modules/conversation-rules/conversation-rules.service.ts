import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';
import { ConversationRuleEntity } from './entities/conversation-rule.entity.js';
import { RuleType } from './enums/rule-type.enum.js';
import { CreateConversationRuleDto } from './dto/create-conversation-rule.dto.js';
import { UpdateConversationRuleDto } from './dto/update-conversation-rule.dto.js';
import { ConversationReply } from './interfaces/conversation-reply.interface.js';
import { InstagramPostsResult } from './interfaces/instagram-post.interface.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { IcebreakerSyncService } from './icebreaker-sync.service.js';

@Injectable()
export class ConversationRulesService {
  private readonly logger = new Logger(ConversationRulesService.name);

  constructor(
    @InjectRepository(ConversationRuleEntity)
    private readonly repo: Repository<ConversationRuleEntity>,
    private readonly integrationsService: IntegrationsService,
    private readonly crypto: AesCryptoService,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly icebreakerSync: IcebreakerSyncService,
  ) {}

  async create(
    dto: CreateConversationRuleDto,
  ): Promise<ConversationRuleEntity> {
    this.assertReplyNotEmpty(dto.reply);
    this.assertNoButtonOnPostComment(dto.type, dto.reply);

    const triggerValue =
      dto.type === RuleType.DEFAULT
        ? null
        : dto.type === RuleType.ICEBREAKER
          ? randomUUID()
          : (dto.triggerValue ?? null);

    const existing = await this.repo.findOne({
      where: {
        clientId: dto.clientId,
        type: dto.type,
        triggerValue: triggerValue === null ? IsNull() : triggerValue,
      },
    });
    if (existing) {
      throw new ConflictException(
        `A rule with type "${dto.type}" and trigger "${triggerValue ?? 'default'}" already exists for this client`,
      );
    }

    const isPostComment = dto.type === RuleType.POST_COMMENT;
    const isIcebreaker = dto.type === RuleType.ICEBREAKER;

    if (isIcebreaker) {
      await this.syncIfIcebreaker(dto.clientId, null, {
        icebreakerQuestion: dto.icebreakerQuestion!,
        triggerValue: triggerValue!,
      });
    }

    return this.repo.save(
      this.repo.create({
        clientId: dto.clientId,
        type: dto.type,
        triggerValue,
        reply: dto.reply,
        commentKeyword: isPostComment ? (dto.commentKeyword ?? null) : null,
        publicReply: isPostComment ? (dto.publicReply ?? null) : null,
        icebreakerQuestion: isIcebreaker
          ? (dto.icebreakerQuestion ?? null)
          : null,
      }),
    );
  }

  findAll(clientId: string): Promise<ConversationRuleEntity[]> {
    return this.repo.find({
      where: { clientId, isActive: true },
      order: { type: 'ASC', triggerValue: 'ASC' },
    });
  }

  async update(
    id: string,
    clientId: string,
    dto: UpdateConversationRuleDto,
  ): Promise<ConversationRuleEntity> {
    if (dto.reply) this.assertReplyNotEmpty(dto.reply);
    const rule = await this.repo.findOne({ where: { id, clientId } });
    if (!rule)
      throw new NotFoundException(`Rule ${id} not found for this client`);
    if (dto.reply) this.assertNoButtonOnPostComment(rule.type, dto.reply);
    if (
      dto.triggerValue !== undefined &&
      (rule.type === RuleType.ICEBREAKER || rule.type === RuleType.DEFAULT)
    ) {
      throw new BadRequestException(
        'triggerValue cannot be changed for this rule type',
      );
    }
    if (rule.type === RuleType.ICEBREAKER) {
      const willBeActive = dto.isActive ?? rule.isActive;
      if (willBeActive) {
        await this.syncIfIcebreaker(rule.clientId, rule.id, {
          icebreakerQuestion:
            dto.icebreakerQuestion ?? rule.icebreakerQuestion!,
          triggerValue: rule.triggerValue!,
        });
      } else {
        await this.syncIfIcebreakerBestEffort(rule.clientId, rule.id);
      }
    }
    return this.repo.save({ ...rule, ...dto });
  }

  async remove(id: string, clientId: string): Promise<void> {
    const rule = await this.repo.findOne({ where: { id, clientId } });
    if (!rule)
      throw new NotFoundException(`Rule ${id} not found for this client`);
    if (rule.type === RuleType.ICEBREAKER) {
      await this.syncIfIcebreakerBestEffort(rule.clientId, rule.id);
    }
    await this.repo.softDelete(id);
  }

  // Removing/deactivating an icebreaker rule must never be blocked by a Meta
  // sync failure (e.g. the client's Instagram integration was disconnected,
  // or its token expired) — a traffic manager must always be able to clean
  // up their own rule list locally, even when we can't currently tell Meta
  // about it.
  private async syncIfIcebreakerBestEffort(
    clientId: string,
    excludeId: string,
  ): Promise<void> {
    await this.syncIfIcebreaker(clientId, excludeId, null).catch(
      (err: Error) => {
        this.logger.warn(
          `Icebreaker sync failed while removing/deactivating a rule for client ${clientId} — proceeding with the local change anyway: ${err.message}`,
        );
      },
    );
  }

  private async syncIfIcebreaker(
    clientId: string,
    excludeId: string | null,
    prospectiveAddition: {
      icebreakerQuestion: string;
      triggerValue: string;
    } | null,
  ): Promise<void> {
    const active = await this.repo.find({
      where: { clientId, type: RuleType.ICEBREAKER, isActive: true },
    });
    const remaining = excludeId
      ? active.filter((r) => r.id !== excludeId)
      : active;
    const prospective = prospectiveAddition
      ? [...remaining, prospectiveAddition]
      : remaining;

    if (prospective.length > 4) {
      throw new ConflictException(
        `Client already has ${remaining.length} active icebreaker rules (max 4)`,
      );
    }

    await this.icebreakerSync.sync(
      clientId,
      prospective.map((r) => ({
        icebreakerQuestion: r.icebreakerQuestion!,
        triggerValue: r.triggerValue!,
      })),
    );
  }

  async findKeywordRule(
    clientId: string,
    text: string,
  ): Promise<ConversationRuleEntity | null> {
    const rules = await this.repo.find({
      where: { clientId, type: RuleType.KEYWORD_DM, isActive: true },
    });
    const lower = text.toLowerCase();
    const matched = rules.filter(
      (r) => r.triggerValue && lower.includes(r.triggerValue.toLowerCase()),
    );
    if (!matched.length) return null;
    return matched.reduce((best, r) =>
      r.triggerValue!.length > best.triggerValue!.length ? r : best,
    );
  }

  findDefaultRule(clientId: string): Promise<ConversationRuleEntity | null> {
    return this.repo.findOne({
      where: { clientId, type: RuleType.DEFAULT, isActive: true },
    });
  }

  findIcebreakerRule(
    clientId: string,
    payload: string,
  ): Promise<ConversationRuleEntity | null> {
    return this.repo.findOne({
      where: {
        clientId,
        type: RuleType.ICEBREAKER,
        triggerValue: payload,
        isActive: true,
      },
    });
  }

  async findPostRule(
    clientId: string,
    postId: string,
    text: string,
  ): Promise<ConversationRuleEntity | null> {
    const rule = await this.repo.findOne({
      where: {
        clientId,
        type: RuleType.POST_COMMENT,
        triggerValue: postId,
        isActive: true,
      },
    });
    if (!rule?.commentKeyword) return null;
    return text.toLowerCase().includes(rule.commentKeyword.toLowerCase())
      ? rule
      : null;
  }

  async getRecentPosts(
    pageId: string,
    limit = 12,
    after?: string,
  ): Promise<InstagramPostsResult> {
    const integration = await this.integrationsService.findByPageId(pageId);
    const token = this.crypto.decrypt(integration.accessToken);
    const base = `${this.config.get<string>('meta.graphApiUrl')}/${this.config.get<string>('meta.graphApiVersion')}`;
    const resp = await firstValueFrom(
      this.httpService.get(`${base}/${pageId}/media`, {
        params: {
          fields: 'id,caption,timestamp,permalink',
          access_token: token,
          limit,
          ...(after && { after }),
        },
      }),
    ).catch((err: { response?: { data?: unknown } }) => {
      this.logger.error(
        `Graph API error fetching posts for pageId ${pageId}: ${JSON.stringify(err?.response?.data)}`,
      );
      throw err;
    });

    const body = resp.data as {
      data?: InstagramPostsResult['data'];
      paging?: { cursors?: { before?: string; after?: string }; next?: string };
    };

    return {
      data: body.data ?? [],
      paging:
        body.paging?.next && body.paging.cursors
          ? { cursors: body.paging.cursors }
          : null,
    };
  }

  private assertReplyNotEmpty(reply: ConversationReply): void {
    if (!reply.text && !reply.quickReplies?.length && !reply.buttonUrl) {
      throw new BadRequestException(
        'reply must have at least one of: text, quickReplies, buttonUrl',
      );
    }
    if ((reply.buttonText || reply.buttonUrl) && !reply.text) {
      throw new BadRequestException(
        'reply.text is required when buttonText/buttonUrl is set',
      );
    }
  }

  private assertNoButtonOnPostComment(
    type: RuleType,
    reply: ConversationReply,
  ): void {
    if (
      type === RuleType.POST_COMMENT &&
      (reply.buttonText || reply.buttonUrl)
    ) {
      throw new BadRequestException(
        'buttonText/buttonUrl is not supported for post_comment rules — comment private replies only support text',
      );
    }
  }
}
