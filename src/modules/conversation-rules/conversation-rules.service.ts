import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ConversationRuleEntity } from './entities/conversation-rule.entity.js';
import { RuleType } from './enums/rule-type.enum.js';
import { CreateConversationRuleDto } from './dto/create-conversation-rule.dto.js';
import { UpdateConversationRuleDto } from './dto/update-conversation-rule.dto.js';
import { ConversationReply } from './interfaces/conversation-reply.interface.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';

@Injectable()
export class ConversationRulesService {
  constructor(
    @InjectRepository(ConversationRuleEntity)
    private readonly repo: Repository<ConversationRuleEntity>,
    private readonly integrationsService: IntegrationsService,
    private readonly crypto: AesCryptoService,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateConversationRuleDto): Promise<ConversationRuleEntity> {
    this.assertReplyNotEmpty(dto.reply);

    const triggerValue = dto.type === RuleType.DEFAULT ? null : (dto.triggerValue ?? null);

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

    return this.repo.save(
      this.repo.create({ clientId: dto.clientId, type: dto.type, triggerValue, reply: dto.reply }),
    );
  }

  findAll(clientId: string): Promise<ConversationRuleEntity[]> {
    return this.repo.find({
      where: { clientId, isActive: true },
      order: { type: 'ASC', triggerValue: 'ASC' },
    });
  }

  async update(id: string, clientId: string, dto: UpdateConversationRuleDto): Promise<ConversationRuleEntity> {
    if (dto.reply) this.assertReplyNotEmpty(dto.reply);
    const rule = await this.repo.findOne({ where: { id, clientId } });
    if (!rule) throw new NotFoundException(`Rule ${id} not found for this client`);
    return this.repo.save({ ...rule, ...dto });
  }

  async remove(id: string, clientId: string): Promise<void> {
    const rule = await this.repo.findOne({ where: { id, clientId } });
    if (!rule) throw new NotFoundException(`Rule ${id} not found for this client`);
    await this.repo.softDelete(id);
  }

  async findKeywordRule(clientId: string, text: string): Promise<ConversationRuleEntity | null> {
    const rules = await this.repo.find({
      where: { clientId, type: RuleType.KEYWORD_DM, isActive: true },
    });
    const lower = text.toLowerCase();
    const matched = rules.filter(r => r.triggerValue && lower.includes(r.triggerValue.toLowerCase()));
    if (!matched.length) return null;
    return matched.reduce((best, r) => r.triggerValue!.length > best.triggerValue!.length ? r : best);
  }

  findDefaultRule(clientId: string): Promise<ConversationRuleEntity | null> {
    return this.repo.findOne({ where: { clientId, type: RuleType.DEFAULT, isActive: true } });
  }

  findPostRule(clientId: string, postId: string): Promise<ConversationRuleEntity | null> {
    return this.repo.findOne({
      where: { clientId, type: RuleType.POST_COMMENT, triggerValue: postId, isActive: true },
    });
  }

  async getRecentPosts(
    pageId: string,
  ): Promise<Array<{ id: string; caption: string | null; timestamp: string; permalink: string }>> {
    const integration = await this.integrationsService.findByPageId(pageId);
    const token = this.crypto.decrypt(integration.accessToken);
    const base = `${this.config.get<string>('meta.graphApiUrl')}/${this.config.get<string>('meta.graphApiVersion')}`;
    const resp = await firstValueFrom(
      this.httpService.get(`${base}/me/media`, {
        params: { fields: 'id,caption,timestamp,permalink', access_token: token },
      }),
    );
    return (resp.data as { data?: Array<{ id: string; caption: string | null; timestamp: string; permalink: string }> }).data ?? [];
  }

  private assertReplyNotEmpty(reply: ConversationReply): void {
    if (!reply.text && !reply.quickReplies?.length && !reply.waLink) {
      throw new BadRequestException('reply must have at least one of: text, quickReplies, waLink');
    }
  }
}
