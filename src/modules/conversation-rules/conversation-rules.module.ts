import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConversationRuleEntity } from './entities/conversation-rule.entity.js';
import { ConversationRulesService } from './conversation-rules.service.js';
import { ConversationRulesController } from './conversation-rules.controller.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { CryptoModule } from '../../common/crypto/crypto.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConversationRuleEntity]),
    IntegrationsModule,
    CryptoModule,
    HttpModule,
  ],
  controllers: [ConversationRulesController],
  providers: [ConversationRulesService],
  exports: [ConversationRulesService],
})
export class ConversationRulesModule {}
