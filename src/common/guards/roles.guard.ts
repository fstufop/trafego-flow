import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestWithUser } from '../../modules/auth/guards/jwt-auth.guard.js';
import { UserRole } from '../../modules/auth/constants/user-role.constant.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

// Must run after a guard (e.g. AuthGuard) that sets `request.user` or
// `request.authMethod` — never register this as a global APP_GUARD.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    if (!requiredRoles?.length) {
      return true;
    }

    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    // No authenticated user on the request is only safe to bypass when a
    // prior guard explicitly marked it as authenticated via the master API
    // key. Any other "no user" case (e.g. no auth guard ran at all) fails
    // closed instead of silently opening the route up.
    if (!user) {
      if (request.authMethod === 'api-key') {
        return true;
      }
      throw new ForbiddenException('Insufficient role for this action');
    }

    if (user.role && requiredRoles.includes(user.role)) {
      return true;
    }

    throw new ForbiddenException('Insufficient role for this action');
  }
}
