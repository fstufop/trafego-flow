import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InsightSnapshotEntity } from './entities/insight-snapshot.entity.js';
import { InsightsSummary } from '../ai/interfaces/ai-provider.interface.js';

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
    snapshotJson: InsightsSummary,
  ): Promise<InsightSnapshotEntity> {
    await this.repo.upsert(
      { adAccountId, clientId, weekStartDate, snapshotJson },
      { conflictPaths: ['adAccountId', 'weekStartDate'], skipUpdateIfNoValuesChanged: true },
    );
    return this.repo.findOne({ where: { adAccountId, weekStartDate } }) as Promise<InsightSnapshotEntity>;
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
