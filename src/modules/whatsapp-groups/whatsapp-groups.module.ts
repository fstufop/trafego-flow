import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsAppGroupEntity } from './entities/whatsapp-group.entity.js';
import { WhatsAppGroupsController } from './whatsapp-groups.controller.js';
import { WhatsAppGroupsService } from './whatsapp-groups.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([WhatsAppGroupEntity])],
  controllers: [WhatsAppGroupsController],
  providers: [WhatsAppGroupsService],
  exports: [WhatsAppGroupsService],
})
export class WhatsAppGroupsModule {}
