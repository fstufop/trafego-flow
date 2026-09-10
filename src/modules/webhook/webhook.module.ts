import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { CryptoModule } from '../../common/crypto/crypto.module.js';
import { ConversationRulesModule } from '../conversation-rules/conversation-rules.module.js';
import { InstagramWebhookController } from './instagram/instagram-webhook.controller.js';
import { InstagramWebhookService } from './instagram/instagram-webhook.service.js';
import { InstagramGraphService } from './instagram/instagram-graph.service.js';
import { ReplyBuilderService } from './instagram/reply-builder.service.js';
import { ConversationBotService } from './instagram/conversation-bot.service.js';

@Module({
  imports: [HttpModule, IntegrationsModule, CryptoModule, ConversationRulesModule],
  controllers: [InstagramWebhookController],
  providers: [
    InstagramWebhookService,
    InstagramGraphService,
    ReplyBuilderService,
    ConversationBotService,
  ],
  exports: [InstagramGraphService],
})
export class WebhookModule {}
