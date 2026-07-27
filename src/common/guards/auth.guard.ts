import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  extractBearerToken,
  RequestWithUser,
} from '../../modules/auth/guards/jwt-auth.guard.js';
import { JwtPayload } from '../../modules/auth/interfaces/auth-service.interface.js';

/**
 * Accepts either the master API key (machine-to-machine) or a user JWT (frontend).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();

    const apiKey = request.headers['x-api-key'];
    if (apiKey && apiKey === this.config.get<string>('app.masterApiKey')) {
      return true;
    }

    const token = extractBearerToken(request);
    if (token) {
      try {
        request.user = await this.jwtService.verifyAsync<JwtPayload>(token);
        return true;
      } catch {
        throw new UnauthorizedException('Invalid or expired token');
      }
    }

    throw new UnauthorizedException('Provide a valid API key or Bearer token');
  }
}
