import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InsightSnapshotEntity } from './entities/insight-snapshot.entity.js';
import { InsightSnapshotsService } from './insight-snapshots.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([InsightSnapshotEntity])],
  providers: [InsightSnapshotsService],
  exports: [InsightSnapshotsService],
})
export class InsightSnapshotsModule {}
