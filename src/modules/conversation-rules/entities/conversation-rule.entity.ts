import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { ClientEntity } from '../../clients/entities/client.entity.js';
import { RuleType } from '../enums/rule-type.enum.js';

export interface ConversationReply {
  text?: string;
  quickReplies?: string[];
  waLink?: string;
}

@Entity('conversation_rules')
export class ConversationRuleEntity extends BaseEntity {
  @Column({ name: 'client_id' })
  clientId: string;

  @ManyToOne(() => ClientEntity)
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ type: 'enum', enum: RuleType })
  type: RuleType;

  @Column({ name: 'trigger_value', type: 'varchar', nullable: true })
  triggerValue: string | null;

  @Column({ type: 'jsonb' })
  reply: ConversationReply;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
