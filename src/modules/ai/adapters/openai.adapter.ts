import { ConfigService } from '@nestjs/config';
import { IAiProvider, AiReportPayload } from '../interfaces/ai-provider.interface.js';
export class OpenAiAdapter implements IAiProvider {
  constructor(_config: ConfigService) {}
  generateReport(_payload: AiReportPayload): Promise<string> {
    return Promise.resolve('');
  }
}
