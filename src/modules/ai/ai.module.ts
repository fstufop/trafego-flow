import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiService } from './ai.service.js';
import { AI_PROVIDER_TOKEN } from './ai.tokens.js';
import { IAiProvider } from './interfaces/ai-provider.interface.js';
import { OpenAiAdapter } from './adapters/openai.adapter.js';
import { GeminiAdapter } from './adapters/gemini.adapter.js';

@Module({})
export class AiModule {
  static forRootAsync(): DynamicModule {
    return {
      module: AiModule,
      global: true,
      imports: [ConfigModule],
      providers: [
        {
          provide: AI_PROVIDER_TOKEN,
          useFactory: (config: ConfigService): IAiProvider => {
            const providerName = config.get<string>('AI_PROVIDER', 'openai');
            if (providerName === 'gemini') return new GeminiAdapter(config);
            return new OpenAiAdapter(config);
          },
          inject: [ConfigService],
        },
        AiService,
      ],
      exports: [AiService],
    };
  }
}
