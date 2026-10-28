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

  const makeContext = (user?: { role: UserRole }): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
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

  it('allows when request.user is undefined (master API key path)', () => {
    getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expect(guard.canActivate(makeContext(undefined))).toBe(true);
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
