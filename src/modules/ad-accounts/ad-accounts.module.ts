import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { CryptoModule } from '../../common/crypto/crypto.module.js';
import { AdAccountEntity } from './entities/ad-account.entity.js';
import { AdAccountsController } from './ad-accounts.controller.js';
import { AdAccountsService } from './ad-accounts.service.js';
import { AdAccountsTokenMonitorService } from './ad-accounts-token-monitor.service.js';
import { MetaTokenService } from './meta-token.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([AdAccountEntity]), CryptoModule, ScheduleModule],
  controllers: [AdAccountsController],
  providers: [AdAccountsService, AdAccountsTokenMonitorService, MetaTokenService],
  exports: [AdAccountsService],
})
export class AdAccountsModule {}
