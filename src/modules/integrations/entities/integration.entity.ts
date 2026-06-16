import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { Exclude } from 'class-transformer';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { ClientEntity } from '../../clients/entities/client.entity.js';

export enum MetaPlatform {
  INSTAGRAM = 'instagram',
  WHATSAPP = 'whatsapp',
}

@Entity('integrations')
export class IntegrationEntity extends BaseEntity {
  @Column({ name: 'client_id' })
  clientId: string;

  @ManyToOne(() => ClientEntity)
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ type: 'enum', enum: MetaPlatform })
  platform: MetaPlatform;

  @Column({ name: 'page_id', unique: true })
  pageId: string;

  @Exclude()
  @Column({ name: 'access_token', type: 'text' })
  accessToken: string;

  @Column({ name: 'token_expires_at', type: 'timestamptz', nullable: true })
  tokenExpiresAt: Date | null;

  @Column({ default: true })
  isActive: boolean;
}
