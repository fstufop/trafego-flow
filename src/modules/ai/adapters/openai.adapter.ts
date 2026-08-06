import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { IAiProvider, AiReportPayload } from '../interfaces/ai-provider.interface.js';
import { buildSystemPrompt, buildUserMessage } from '../utils/prompt-builder.js';

export class OpenAiAdapter implements IAiProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.client = new OpenAI({ apiKey: config.get<string>('OPENAI_API_KEY') });
    this.model = config.get<string>('AI_MODEL', 'gpt-4o-mini');
  }

  async generateReport(payload: AiReportPayload): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: buildSystemPrompt(payload.clientProfile, payload.clientContext) },
        { role: 'user', content: buildUserMessage(payload) },
      ],
    });
    return response.choices[0]?.message?.content ?? '';
  }
}
