import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClientPortalAuthController } from './client-portal-auth.controller.js';
import { ClientPortalAuthService } from './client-portal-auth.service.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ClientPortalAuthGuard } from '../../common/guards/client-portal-auth.guard.js';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import { UserRole } from './constants/user-role.constant.js';
import { CLIENT_PORTAL_SCOPE } from './constants/client-portal.constant.js';

describe('ClientPortalAuthController wiring', () => {
  const reflector = new Reflector();

  const adminRoutes = [
    'createAccount',
    'findByClient',
    'setActive',
    'resendInvite',
    'remove',
  ] as const;

  it.each(adminRoutes)(
    '%s runs AuthGuard then RolesGuard and requires ADMIN role',
    (methodName) => {
      const handler = ClientPortalAuthController.prototype[methodName];

      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as
        | unknown[]
        | undefined;
      expect(guards).toEqual([AuthGuard, RolesGuard]);

      const roles = reflector.get<UserRole[]>(ROLES_KEY, handler);
      expect(roles).toEqual([UserRole.ADMIN]);
    },
  );

  it('the public client-portal routes carry no guards', () => {
    for (const methodName of [
      'login',
      'forgotPassword',
      'resetPassword',
    ] as const) {
      const handler = ClientPortalAuthController.prototype[methodName];
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as
        | unknown[]
        | undefined;
      expect(guards ?? []).toEqual([]);
    }
  });

  it('me runs ClientPortalAuthGuard (not AuthGuard)', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- not invoked, only used as a reflection target
    const handler = ClientPortalAuthController.prototype.me;
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as
      | unknown[]
      | undefined;
    expect(guards).toEqual([ClientPortalAuthGuard]);
  });

  // Regression: ClientPortalAuthGuard now runs the cascade-revocation check
  // (assertAccess) for every client-portal-scoped token, not just a new
  // per-route check. Since GET /auth/client-portal/me uses this same guard,
  // it inherits the protection for free — this confirms that concretely by
  // exercising the guard itself (not just the metadata wiring above) with a
  // token whose portal user has been deactivated.
  it('ClientPortalAuthGuard rejects a deactivated client-portal token before /me ever runs', async () => {
    const mockConfig = {
      get: jest.fn().mockReturnValue('master-key'),
    } as unknown as ConfigService;
    const verifyAsync = jest.fn().mockResolvedValue({
      sub: 'u1',
      clientId: 'c1',
      scope: CLIENT_PORTAL_SCOPE,
    });
    const mockJwtService = { verifyAsync } as unknown as JwtService;
    const assertAccess = jest.fn().mockRejectedValue(new ForbiddenException());
    const mockClientPortalAuthService = {
      assertAccess,
    } as unknown as ClientPortalAuthService;

    const guard = new ClientPortalAuthGuard(
      mockConfig,
      mockJwtService,
      mockClientPortalAuthService,
    );
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer deactivated-portal-token' },
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toThrow();
    expect(assertAccess).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'c1' }),
      'c1',
    );
  });

  // Closes a gap flagged by the plan's pre-flight review: a client-portal
  // scoped token must not be able to reach the admin client-portal-users
  // routes. Structurally this already holds because every admin route above
  // runs the shared AuthGuard first, and AuthGuard rejects ANY `scope`
  // claim (not just unknown ones) with a 401 before RolesGuard ever runs.
  it('rejects a client-portal-scoped token on an admin client-portal-users route via AuthGuard', async () => {
    const mockConfig = {
      get: jest.fn().mockReturnValue('master-key'),
    } as unknown as ConfigService;
    const verifyAsync = jest.fn().mockResolvedValue({
      sub: 'user-id',
      clientId: 'client-id',
      scope: CLIENT_PORTAL_SCOPE,
    });
    const mockJwtService = { verifyAsync } as unknown as JwtService;

    const guard = new AuthGuard(mockConfig, mockJwtService);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer client-portal-token' },
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  describe('me()', () => {
    const findById = jest.fn();
    const mockService = {
      findById,
    } as unknown as ClientPortalAuthService;
    const controller = new ClientPortalAuthController(mockService);

    beforeEach(() => jest.clearAllMocks());

    // ClientPortalAuthGuard accepts the master API key without ever setting
    // request.user, so @CurrentUser() yields undefined in that case.
    it('rejects a master-API-key request (no payload) instead of throwing a TypeError', async () => {
      await expect(controller.me(undefined)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(findById).not.toHaveBeenCalled();
    });

    // ClientPortalAuthGuard also accepts a plain no-scope admin session JWT.
    it('rejects a plain admin JWT (no scope) instead of doing a misleading lookup', async () => {
      await expect(
        controller.me({ sub: 'admin-id', email: 'a@b.com', name: 'Admin' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(findById).not.toHaveBeenCalled();
    });

    it('returns clientId/email for a genuine client-portal token', async () => {
      findById.mockResolvedValue({
        clientId: 'c1',
        email: 'client@x.com',
      });

      await expect(
        controller.me({
          sub: 'u1',
          email: 'ignored',
          name: 'ignored',
          clientId: 'c1',
          scope: CLIENT_PORTAL_SCOPE,
        }),
      ).resolves.toEqual({ clientId: 'c1', email: 'client@x.com' });
      expect(findById).toHaveBeenCalledWith('u1');
    });
  });
});
