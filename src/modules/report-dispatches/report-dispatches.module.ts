import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdAccountsModule } from '../ad-accounts/ad-accounts.module.js';
import { CampaignReportsModule } from '../campaign-reports/campaign-reports.module.js';
import { WhatsAppGroupsModule } from '../whatsapp-groups/whatsapp-groups.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { InsightSnapshotsModule } from '../insight-snapshots/insight-snapshots.module.js';
import { ReportDispatchLogEntity } from './entities/report-dispatch-log.entity.js';
import { ReportDispatchesController } from './report-dispatches.controller.js';
import { ReportDispatchesService } from './report-dispatches.service.js';
import { ReportDispatchSchedulerService } from './report-dispatch-scheduler.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReportDispatchLogEntity]),
    WhatsAppGroupsModule,
    AdAccountsModule,
    CampaignReportsModule,
    ClientsModule,
    InsightSnapshotsModule,
  ],
  controllers: [ReportDispatchesController],
  providers: [ReportDispatchesService, ReportDispatchSchedulerService],
})
export class ReportDispatchesModule {}
