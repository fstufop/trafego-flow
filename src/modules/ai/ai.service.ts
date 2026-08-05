import { Inject, Injectable } from '@nestjs/common';
import { AI_PROVIDER_TOKEN } from './ai.tokens.js';
import type { AiReportPayload, IAiProvider } from './interfaces/ai-provider.interface.js';

@Injectable()
export class AiService {
  constructor(@Inject(AI_PROVIDER_TOKEN) private readonly provider: IAiProvider) {}

  generateReport(payload: AiReportPayload): Promise<string> {
    return this.provider.generateReport(payload);
  }
}
