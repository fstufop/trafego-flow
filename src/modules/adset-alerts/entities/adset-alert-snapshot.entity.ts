import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';

@Entity('adset_alert_snapshots')
export class AdsetAlertSnapshotEntity extends BaseEntity {
  @Column({ name: 'job_id' })
  jobId: string;

  @Column({ name: 'client_id' })
  clientId: string;

  @Column({ name: 'ad_account_id' })
  adAccountId: string;

  @Column({ name: 'adset_id' })
  adsetId: string;

  @Column({ name: 'adset_name' })
  adsetName: string;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  roas: number | null;

  @Column({ name: 'updated_time', type: 'date' })
  updatedTime: string;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;
}
