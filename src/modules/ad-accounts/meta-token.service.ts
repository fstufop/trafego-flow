import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface TokenValidationResult {
  valid: boolean;
  appId: string | null;
  type: string | null;
  expiresAt: string | null;
  scopes: string[];
  userId: string | null;
}

@Injectable()
export class MetaTokenService {
  private readonly logger = new Logger(MetaTokenService.name);
  private readonly debugUrl: string;

  constructor(config: ConfigService) {
    const base = config.get<string>('meta.graphApiUrl') ?? 'https://graph.facebook.com';
    const version = config.get<string>('meta.graphApiVersion') ?? 'v21.0';
    this.debugUrl = `${base}/${version}/debug_token`;
  }

  async validate(accessToken: string): Promise<TokenValidationResult> {
    try {
      // The token authenticates itself — no app secret needed
      const response = await axios.get(this.debugUrl, {
        params: { input_token: accessToken, access_token: accessToken },
      });
      const d = response.data.data as Record<string, unknown>;
      return {
        valid: (d.is_valid as boolean) ?? false,
        appId: (d.app_id as string) ?? null,
        type: (d.type as string) ?? null,
        expiresAt: d.expires_at ? new Date((d.expires_at as number) * 1000).toISOString() : null,
        scopes: (d.scopes as string[]) ?? [],
        userId: (d.user_id as string) ?? null,
      };
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        this.logger.error(
          `Meta debug_token HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`,
        );
        const body = err.response.data as Record<string, unknown>;
        const d = (body?.data ?? {}) as Record<string, unknown>;
        return {
          valid: false,
          appId: (d.app_id as string) ?? null,
          type: (d.type as string) ?? null,
          expiresAt: null,
          scopes: [],
          userId: null,
        };
      }
      this.logger.error(`Meta debug_token failed: ${String(err)}`);
      throw err;
    }
  }
}
