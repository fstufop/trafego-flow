import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdsetAlertSnapshotEntity } from './entities/adset-alert-snapshot.entity.js';
import { AdsetAlertsService } from './adset-alerts.service.js';
import { AdsetAlertSchedulerService } from './adset-alert-scheduler.service.js';
import { AdsetAlertsController } from './adset-alerts.controller.js';
import { AlertJobsModule } from '../alert-jobs/alert-jobs.module.js';
import { AdAccountsModule } from '../ad-accounts/ad-accounts.module.js';
import { CampaignReportsModule } from '../campaign-reports/campaign-reports.module.js';
import { ClientsModule } from '../clients/clients.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdsetAlertSnapshotEntity]),
    AlertJobsModule,
    AdAccountsModule,
    CampaignReportsModule,
    ClientsModule,
  ],
  controllers: [AdsetAlertsController],
  providers: [AdsetAlertsService, AdsetAlertSchedulerService],
})
export class AdsetAlertsModule {}
