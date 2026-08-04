import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';

@Entity('clients')
export class ClientEntity extends BaseEntity {
  @Column({ length: 200 })
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ name: 'ai_strategy_context', type: 'text', nullable: true })
  aiStrategyContext: string | null;
}
