import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import { IAiProvider, AiReportPayload } from '../interfaces/ai-provider.interface.js';
import { buildSystemPrompt, buildUserMessage } from '../utils/prompt-builder.js';

export class GeminiAdapter implements IAiProvider {
  private readonly genAI: GoogleGenerativeAI;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.genAI = new GoogleGenerativeAI(config.get<string>('GEMINI_API_KEY') ?? '');
    this.model = config.get<string>('AI_MODEL', 'gemini-1.5-flash');
  }

  async generateReport(payload: AiReportPayload): Promise<string> {
    const model = this.genAI.getGenerativeModel({ model: this.model });
    const result = await model.generateContent([
      buildSystemPrompt(payload.clientProfile, payload.clientContext),
      buildUserMessage(payload),
    ]);
    return result.response.text();
  }
}
