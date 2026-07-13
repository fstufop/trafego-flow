import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';

@Entity('whatsapp_sessions')
export class WhatsAppSessionEntity extends BaseEntity {
  @Column({ name: 'phone_number', unique: true })
  phoneNumber: string;

  @Column({ name: 'is_connected', default: false })
  isConnected: boolean;

  @Column({ name: 'last_connected_at', type: 'timestamptz', nullable: true })
  lastConnectedAt: Date | null;
}
