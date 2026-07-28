import { Column, Entity, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { ClientBillingEntity } from './client-billing.entity.js';

@Entity('clients')
export class ClientEntity extends BaseEntity {
  @Column({ length: 200 })
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ length: 20, nullable: true })
  phone: string | null;

  @Column({ name: 'whatsapp_group_code', length: 200, nullable: true })
  whatsappGroupCode: string | null;

  @Column({ name: 'google_drive_folder_url', type: 'text', nullable: true })
  googleDriveFolderUrl: string | null;

  @OneToOne(() => ClientBillingEntity, (billing) => billing.client, { eager: false })
  billing: ClientBillingEntity;
}
