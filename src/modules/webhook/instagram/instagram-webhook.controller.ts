import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InstagramWebhookService } from './instagram-webhook.service.js';
import { InstagramWebhookPayload } from './interfaces/instagram-webhook-event.interface.js';

@ApiTags('webhook')
@Controller('webhook/instagram')
export class InstagramWebhookController {
  constructor(private readonly webhookService: InstagramWebhookService) {}

  @Get()
  @ApiOperation({ summary: 'Instagram webhook verification endpoint (Meta hub challenge)' })
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    return this.webhookService.verifyWebhook(mode, token, challenge);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive Instagram webhook events' })
  handleEvent(
    @Body() payload: object,
    @Req() req: object,
    @Headers('x-hub-signature-256') signature: string,
  ): Promise<void> {
    const webhookPayload = payload as InstagramWebhookPayload;
    const rawBody = (req as { rawBody: Buffer }).rawBody;
    return this.webhookService.handleEvent(webhookPayload, rawBody, signature);
  }
}
