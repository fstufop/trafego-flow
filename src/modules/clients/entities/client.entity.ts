import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { ClientBillingEntity } from './client-billing.entity.js';
import { ClientProfileType } from '../enums/client-profile-type.enum.js';

@Entity('clients')
export class ClientEntity extends BaseEntity {
  @Column({ length: 200 })
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ name: 'whatsapp_group_code', type: 'varchar', length: 200, nullable: true })
  whatsappGroupCode: string | null;

  @Column({ name: 'google_drive_folder_url', type: 'text', nullable: true })
  googleDriveFolderUrl: string | null;

  @Column({ name: 'ai_strategy_context', type: 'text', nullable: true })
  aiStrategyContext: string | null;

  @Column({ type: 'enum', enum: ClientProfileType, nullable: true, name: 'profile_type' })
  profileType: ClientProfileType | null;

  @OneToMany(() => ClientBillingEntity, (billing) => billing.client)
  billings: ClientBillingEntity[];
}
