import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClientPortalAuthGuard } from './client-portal-auth.guard.js';
import { RequestWithUser } from '../../modules/auth/guards/jwt-auth.guard.js';
import { ClientPortalAuthService } from '../../modules/auth/client-portal-auth.service.js';

describe('ClientPortalAuthGuard', () => {
  const mockConfig = {
    get: jest.fn().mockReturnValue('master-key'),
  } as unknown as ConfigService;
  const verifyAsync = jest.fn();
  const mockJwtService = { verifyAsync } as unknown as JwtService;
  const assertAccess = jest.fn();
  const mockClientPortalAuthService = {
    assertAccess,
  } as unknown as ClientPortalAuthService;

  const guard = new ClientPortalAuthGuard(
    mockConfig,
    mockJwtService,
    mockClientPortalAuthService,
  );

  const makeContext = (headers: Record<string, string>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => jest.clearAllMocks());

  it('allows requests with the master API key', async () => {
    await expect(
      guard.canActivate(makeContext({ 'x-api-key': 'master-key' })),
    ).resolves.toBe(true);
  });

  it('allows a normal session token (no scope)', async () => {
    verifyAsync.mockResolvedValue({ sub: 'user-id' });

    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer session-token' })),
    ).resolves.toBe(true);
  });

  it('allows a token scoped to client-portal and exposes clientId on request.user', async () => {
    verifyAsync.mockResolvedValue({
      sub: 'portal-user-id',
      clientId: 'c1',
      scope: 'client-portal',
    });
    assertAccess.mockResolvedValue(undefined);
    const request: RequestWithUser = {
      headers: { authorization: 'Bearer client-token' },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual(expect.objectContaining({ clientId: 'c1' }));
    expect(assertAccess).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'c1' }),
      'c1',
    );
  });

  it('rejects a client-portal token whose portal user has been deactivated', async () => {
    verifyAsync.mockResolvedValue({
      sub: 'portal-user-id',
      clientId: 'c1',
      scope: 'client-portal',
    });
    assertAccess.mockRejectedValue(new ForbiddenException('Access denied'));

    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer client-token' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a client-portal token whose parent Client has been deactivated', async () => {
    verifyAsync.mockResolvedValue({
      sub: 'portal-user-id',
      clientId: 'c1',
      scope: 'client-portal',
    });
    assertAccess.mockRejectedValue(new ForbiddenException('Access denied'));

    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer client-token' })),
    ).rejects.toThrow(ForbiddenException);
    expect(assertAccess).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'c1' }),
      'c1',
    );
  });

  it('does not run the cascade-revocation check for a no-scope token', async () => {
    verifyAsync.mockResolvedValue({ sub: 'user-id' });

    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer session-token' })),
    ).resolves.toBe(true);
    expect(assertAccess).not.toHaveBeenCalled();
  });

  it('rejects a token scoped to something else (e.g. media-upload)', async () => {
    verifyAsync.mockResolvedValue({
      sub: 'user-id',
      scope: 'media-upload',
    });

    await expect(
      guard.canActivate(
        makeContext({ authorization: 'Bearer other-scope-token' }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an invalid Bearer token', async () => {
    verifyAsync.mockRejectedValue(new Error('expired'));

    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer bad-token' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects requests with no credentials', async () => {
    await expect(guard.canActivate(makeContext({}))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
