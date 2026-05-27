import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey || apiKey !== this.config.get<string>('app.masterApiKey')) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    return true;
  }
}
