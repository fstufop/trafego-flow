import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InsightSnapshotEntity } from './entities/insight-snapshot.entity.js';
import { MetaInsights } from '../campaign-reports/interfaces/meta-campaign.interface.js';

@Injectable()
export class InsightSnapshotsService {
  constructor(
    @InjectRepository(InsightSnapshotEntity)
    private readonly repo: Repository<InsightSnapshotEntity>,
  ) {}

  async saveSnapshot(
    adAccountId: string,
    clientId: string,
    weekStartDate: Date,
    snapshotJson: MetaInsights,
  ): Promise<InsightSnapshotEntity> {
    return this.repo.save(
      this.repo.create({ adAccountId, clientId, weekStartDate, snapshotJson }),
    );
  }

  async findPreviousSnapshot(
    adAccountId: string,
    weekStartDate: Date,
  ): Promise<InsightSnapshotEntity | null> {
    const prevWeek = new Date(weekStartDate);
    prevWeek.setDate(prevWeek.getDate() - 7);
    return this.repo.findOne({ where: { adAccountId, weekStartDate: prevWeek } });
  }
}
