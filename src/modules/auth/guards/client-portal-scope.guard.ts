import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
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

    // No `request.user` means this request was authenticated via the
    // master API key (a fully-trusted machine credential) — neither
    // AuthGuard nor ClientPortalAuthGuard populate `request.user` on that
    // path. Per the plan's global constraint, master-key behavior must
    // stay unrestricted, so skip the ownership check entirely rather than
    // calling assertAccess with an undefined payload.
    if (!user) {
      return true;
    }

    const queryClientId = request.query?.clientId as string | undefined;
    const bodyClientId = request.body?.clientId as string | undefined;

    // If both the query string and the body carry a clientId and they
    // disagree, never silently prefer one — that would let a request pass
    // ownership validation against one client while actually operating on
    // another. Reject outright instead.
    if (
      queryClientId !== undefined &&
      bodyClientId !== undefined &&
      queryClientId !== bodyClientId
    ) {
      throw new ForbiddenException('clientId in query and body must match');
    }

    const clientId = queryClientId ?? bodyClientId;

    await this.clientPortalAuthService.assertAccess(user, clientId);

    return true;
  }
}
