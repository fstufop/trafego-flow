import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import type { InsightsSummary } from '../../ai/interfaces/ai-provider.interface.js';

@Entity('insight_snapshots')
@Index(['adAccountId', 'weekStartDate'], { unique: true })
export class InsightSnapshotEntity extends BaseEntity {
  @Column({ name: 'ad_account_id' })
  adAccountId: string;

  @Column({ name: 'client_id' })
  clientId: string;

  @Column({ name: 'week_start_date', type: 'date' })
  weekStartDate: Date;

  @Column({ name: 'snapshot_json', type: 'jsonb' })
  snapshotJson: InsightsSummary;
}
