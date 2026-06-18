import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AdAccountsModule } from '../ad-accounts/ad-accounts.module.js';
import { CryptoModule } from '../../common/crypto/crypto.module.js';
import { CsvModule } from '../../common/csv/csv.module.js';
import { CampaignReportsController } from './campaign-reports.controller.js';
import { CampaignReportsService } from './campaign-reports.service.js';
import { MetaAdsService } from './meta-ads.service.js';

@Module({
  imports: [HttpModule, AdAccountsModule, CryptoModule, CsvModule],
  controllers: [CampaignReportsController],
  providers: [CampaignReportsService, MetaAdsService],
})
export class CampaignReportsModule {}
