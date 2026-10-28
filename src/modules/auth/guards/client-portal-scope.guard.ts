import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ClientPortalAuthService } from '../client-portal-auth.service.js';
import { RequestWithUser } from './jwt-auth.guard.js';

interface RequestWithClientId extends RequestWithUser {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

/**
 * Reusable ownership check: confirms the authenticated principal (set on
 * `request.user` by a prior auth guard) may only touch the `clientId` it
 * is scoped to. Must run after a guard that sets `request.user`
 * (e.g. ClientPortalAuthGuard, AuthGuard).
 */
@Injectable()
export class ClientPortalScopeGuard implements CanActivate {
  constructor(
    private readonly clientPortalAuthService: ClientPortalAuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<RequestWithClientId>();
    const user = request.user;

    const clientId =
      (request.query?.clientId as string | undefined) ??
      (request.body?.clientId as string | undefined);

    await this.clientPortalAuthService.assertAccess(user!, clientId);

    return true;
  }
}
