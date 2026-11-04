import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { Exclude, Expose } from 'class-transformer';
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

  @Expose()
  get hasAccessToken(): boolean {
    return !!this.accessToken;
  }

  @Exclude()
  @Column({ name: 'app_secret', type: 'text', nullable: true })
  appSecret: string | null;

  @Expose()
  get hasAppSecret(): boolean {
    return !!this.appSecret;
  }

  @Column({ name: 'token_expires_at', type: 'timestamptz', nullable: true })
  tokenExpiresAt: Date | null;

  @Column({ default: true })
  isActive: boolean;
}
