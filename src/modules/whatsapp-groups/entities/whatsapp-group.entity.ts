import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { ClientEntity } from '../../clients/entities/client.entity.js';

@Entity('whatsapp_groups')
export class WhatsAppGroupEntity extends BaseEntity {
  @Column({ name: 'client_id' })
  clientId: string;

  @ManyToOne(() => ClientEntity)
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ name: 'group_jid' })
  groupJid: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  label: string | null;

  @Column({ default: true })
  isActive: boolean;
}
