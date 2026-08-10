import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { AlertJobType } from '../enums/alert-job-type.enum.js';
import { AlertJobStatus } from '../enums/alert-job-status.enum.js';

@Entity('alert_jobs')
export class AlertJobEntity extends BaseEntity {
  @Column({ type: 'enum', enum: AlertJobType })
  type: AlertJobType;

  @Column({ type: 'enum', enum: AlertJobStatus, default: AlertJobStatus.ACTIVE })
  status: AlertJobStatus;

  @Column({ name: 'client_id', type: 'varchar', nullable: true })
  clientId: string | null;

  @Column({ type: 'text', array: true, default: '{}' })
  fields: string[];
}
