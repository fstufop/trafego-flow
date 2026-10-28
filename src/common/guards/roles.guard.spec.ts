import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';
import { UserRole } from '../../modules/auth/constants/user-role.constant.js';

describe('RolesGuard', () => {
  const getAllAndOverride = jest.fn();
  const mockReflector = {
    getAllAndOverride,
  } as unknown as Reflector;

  const guard = new RolesGuard(mockReflector);

  const makeContext = (
    user?: { role?: UserRole },
    authMethod?: 'api-key',
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user, authMethod }) }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as unknown as ExecutionContext;

  beforeEach(() => jest.clearAllMocks());

  it('allows when no @Roles() metadata is present', () => {
    getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(makeContext({ role: UserRole.MEMBER }))).toBe(
      true,
    );
  });

  it('allows when request.user is undefined and authMethod is api-key (master API key path)', () => {
    getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expect(guard.canActivate(makeContext(undefined, 'api-key'))).toBe(true);
  });

  it('throws ForbiddenException when request.user is undefined and there is no api-key marker (fail closed)', () => {
    getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when request.user is set but its role is undefined', () => {
    getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expect(() => guard.canActivate(makeContext({ role: undefined }))).toThrow(
      ForbiddenException,
    );
  });

  it('allows when request.user.role is in the required roles', () => {
    getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expect(guard.canActivate(makeContext({ role: UserRole.ADMIN }))).toBe(true);
  });

  it('throws ForbiddenException when request.user.role is not in the required roles', () => {
    getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expect(() =>
      guard.canActivate(makeContext({ role: UserRole.MEMBER })),
    ).toThrow(ForbiddenException);
  });
});
