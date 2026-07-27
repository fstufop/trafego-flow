import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithUser } from '../guards/jwt-auth.guard.js';
import { JwtPayload } from '../interfaces/auth-service.interface.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload | undefined =>
    ctx.switchToHttp().getRequest<RequestWithUser>().user,
);
