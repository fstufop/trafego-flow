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

// `JwtPayload` doesn't carry `role` yet (added once `login()`/`createUser()`
// populate it); until then, treat the user on the request as possibly
// carrying one so this guard can be introduced ahead of that wiring.
type UserWithRole = RequestWithUser['user'] & { role?: UserRole };

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
    const user: UserWithRole | undefined = request.user;

    // No authenticated user on the request means this came in via the
    // master API key, which isn't subject to role checks.
    if (!user) {
      return true;
    }

    if (user.role && requiredRoles.includes(user.role)) {
      return true;
    }

    throw new ForbiddenException('Insufficient role for this action');
  }
}
