import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { InstagramGraphService } from '../webhook/instagram/instagram-graph.service.js';
import { MetaPlatform } from '../integrations/entities/integration.entity.js';

@Injectable()
export class IcebreakerSyncService {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly graph: InstagramGraphService,
  ) {}

  async sync(
    clientId: string,
    activeRules: Array<{ icebreakerQuestion: string; triggerValue: string }>,
  ): Promise<void> {
    const integrations = await this.integrationsService.findAll(clientId);
    const integration = integrations.find(
      (i) => i.platform === MetaPlatform.INSTAGRAM,
    );
    if (!integration) {
      throw new BadRequestException(
        'Client has no active Instagram integration to sync icebreakers to',
      );
    }

    await this.graph
      .setIceBreakers(
        integration.pageId,
        activeRules.map((r) => ({
          question: r.icebreakerQuestion,
          payload: r.triggerValue,
        })),
      )
      .catch((err: unknown) => {
        if (err instanceof HttpException) throw err;
        const metaMessage = (
          err as { response?: { data?: { error?: { message?: string } } } }
        )?.response?.data?.error?.message;
        if (metaMessage) throw new BadGatewayException(metaMessage);
        throw err;
      });
  }
}
