import { Column, Entity } from 'typeorm';
import { Exclude, Expose } from 'class-transformer';
import { BaseEntity } from '../../../common/database/base.entity.js';

@Entity('client_portal_users')
export class ClientPortalUserEntity extends BaseEntity {
  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @Column({ unique: true })
  email: string;

  @Exclude()
  @Column({ name: 'password_hash', type: 'varchar', nullable: true })
  passwordHash: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Exclude()
  @Column({
    name: 'password_reset_token_hash',
    type: 'varchar',
    nullable: true,
  })
  passwordResetTokenHash: string | null;

  @Column({
    name: 'password_reset_expires_at',
    type: 'timestamp',
    nullable: true,
  })
  passwordResetExpiresAt: Date | null;

  @Expose()
  get hasPassword(): boolean {
    return this.passwordHash !== null;
  }
}
