import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { CryptoModule } from '../../common/crypto/crypto.module.js';
import { InstagramWebhookController } from './instagram/instagram-webhook.controller.js';
import { InstagramWebhookService } from './instagram/instagram-webhook.service.js';
import { InstagramGraphService } from './instagram/instagram-graph.service.js';

@Module({
  imports: [HttpModule, IntegrationsModule, CryptoModule],
  controllers: [InstagramWebhookController],
  providers: [InstagramWebhookService, InstagramGraphService],
  exports: [InstagramGraphService],
})
export class WebhookModule {}
