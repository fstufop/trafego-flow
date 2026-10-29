import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from '../interfaces/auth-service.interface.js';

export interface RequestWithUser {
  headers: Record<string, string | undefined>;
  user?: JwtPayload;
  /**
   * Set by AuthGuard when the request was authenticated via the master
   * API key (no user attached). RolesGuard relies on this marker.
   */
  authMethod?: 'api-key';
}

export function extractBearerToken(request: {
  headers: Record<string, string | undefined>;
}): string | null {
  const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
  return scheme === 'Bearer' && token ? token : null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    const token = extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (payload.scope !== undefined) {
      throw new UnauthorizedException(
        'This token cannot be used for this endpoint',
      );
    }

    request.user = payload;
    return true;
  }
}
