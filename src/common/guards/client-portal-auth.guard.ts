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
import { CLIENT_PORTAL_SCOPE } from '../../modules/auth/constants/client-portal.constant.js';

/**
 * Guards client-portal endpoints. Accepts the master API key
 * (machine-to-machine), a normal session JWT (no scope), or a token scoped
 * specifically to client-portal — but rejects any other scope.
 */
@Injectable()
export class ClientPortalAuthGuard implements CanActivate {
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
    if (!token) {
      throw new UnauthorizedException(
        'Provide a valid API key or Bearer token',
      );
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (payload.scope !== undefined && payload.scope !== CLIENT_PORTAL_SCOPE) {
      throw new UnauthorizedException(
        'This token cannot be used for the client portal',
      );
    }

    request.user = payload;
    return true;
  }
}
