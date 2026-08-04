import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { MetaInsights } from '../../campaign-reports/interfaces/meta-campaign.interface.js';

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
  snapshotJson: MetaInsights;
}
