import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoModule } from '../../common/crypto/crypto.module.js';
import { WhatsAppSessionEntity } from './entities/whatsapp-session.entity.js';
import { WhatsAppAuthKeyEntity } from './entities/whatsapp-auth-key.entity.js';
import { WhatsAppSessionController } from './whatsapp-session.controller.js';
import { WhatsAppSessionService } from './whatsapp-session.service.js';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([WhatsAppSessionEntity, WhatsAppAuthKeyEntity]),
    CryptoModule,
  ],
  controllers: [WhatsAppSessionController],
  providers: [WhatsAppSessionService],
  exports: [WhatsAppSessionService],
})
export class WhatsAppSessionModule {}
