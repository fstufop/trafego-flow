import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoModule } from '../../common/crypto/crypto.module.js';
import { AdAccountEntity } from './entities/ad-account.entity.js';
import { AdAccountsController } from './ad-accounts.controller.js';
import { AdAccountsService } from './ad-accounts.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([AdAccountEntity]), CryptoModule],
  controllers: [AdAccountsController],
  providers: [AdAccountsService],
  exports: [AdAccountsService],
})
export class AdAccountsModule {}
