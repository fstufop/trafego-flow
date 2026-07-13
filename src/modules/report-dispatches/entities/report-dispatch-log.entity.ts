import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';

export enum DispatchStatus {
  SENT = 'sent',
  FAILED = 'failed',
}

@Entity('report_dispatch_logs')
export class ReportDispatchLogEntity extends BaseEntity {
  @Column({ name: 'client_id' })
  clientId: string;

  @Column({ name: 'group_jid' })
  groupJid: string;

  @Column({ name: 'ad_account_id' })
  adAccountId: string;

  @Column({ name: 'week_start_date', type: 'date' })
  weekStartDate: Date;

  @Column({ type: 'enum', enum: DispatchStatus })
  status: DispatchStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;
}
