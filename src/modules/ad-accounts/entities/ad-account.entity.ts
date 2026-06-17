import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { Exclude } from 'class-transformer';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { ClientEntity } from '../../clients/entities/client.entity.js';

@Entity('ad_accounts')
export class AdAccountEntity extends BaseEntity {
  @Column({ name: 'client_id' })
  clientId: string;

  @ManyToOne(() => ClientEntity)
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ name: 'ad_account_id', unique: true })
  adAccountId: string;

  @Column({ name: 'account_name', type: 'varchar', nullable: true })
  accountName: string | null;

  @Exclude()
  @Column({ name: 'access_token', type: 'text' })
  accessToken: string;

  @Column({ name: 'token_expires_at', type: 'timestamptz', nullable: true })
  tokenExpiresAt: Date | null;

  @Column({ default: true })
  isActive: boolean;
}
