import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientEntity } from './entities/client.entity.js';
import { ClientBillingEntity } from './entities/client-billing.entity.js';
import { ClientBillingInstallmentEntity } from './entities/client-billing-installment.entity.js';
import { ClientsController } from './clients.controller.js';
import { ClientsService } from './clients.service.js';
import { ClientBillingService } from './billing/client-billing.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ClientEntity, ClientBillingEntity, ClientBillingInstallmentEntity]),
  ],
  controllers: [ClientsController],
  providers: [ClientsService, ClientBillingService],
  exports: [ClientsService, ClientBillingService],
})
export class ClientsModule {}
