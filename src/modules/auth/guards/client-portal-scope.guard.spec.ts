import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ClientPortalScopeGuard } from './client-portal-scope.guard.js';
import { ClientPortalAuthService } from '../client-portal-auth.service.js';

describe('ClientPortalScopeGuard', () => {
  const assertAccess = jest.fn();
  const mockClientPortalAuthService = {
    assertAccess,
  } as unknown as ClientPortalAuthService;
  const guard = new ClientPortalScopeGuard(mockClientPortalAuthService);

  const makeContext = (
    user: unknown,
    query: Record<string, unknown> = {},
    body: Record<string, unknown> = {},
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user, query, body }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves clientId from the query string', async () => {
    assertAccess.mockResolvedValue(undefined);
    await guard.canActivate(
      makeContext(
        { scope: 'client-portal', clientId: 'c1' },
        { clientId: 'c1' },
      ),
    );
    expect(assertAccess).toHaveBeenCalledWith(expect.anything(), 'c1');
  });

  it('falls back to the body when there is no query clientId', async () => {
    assertAccess.mockResolvedValue(undefined);
    await guard.canActivate(
      makeContext(
        { scope: 'client-portal', clientId: 'c1' },
        {},
        { clientId: 'c1' },
      ),
    );
    expect(assertAccess).toHaveBeenCalledWith(expect.anything(), 'c1');
  });

  it('propagates ForbiddenException from assertAccess', async () => {
    assertAccess.mockRejectedValue(new ForbiddenException());
    await expect(
      guard.canActivate(makeContext({ scope: 'client-portal' }, {})),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows the request through without calling assertAccess when request.user is undefined (master API key)', async () => {
    await expect(
      guard.canActivate(makeContext(undefined, { clientId: 'c1' })),
    ).resolves.toBe(true);
    expect(assertAccess).not.toHaveBeenCalled();
  });

  it('rejects with ForbiddenException when query and body clientId disagree, without calling assertAccess', async () => {
    await expect(
      guard.canActivate(
        makeContext(
          { scope: 'client-portal', clientId: 'c1' },
          { clientId: 'c1' },
          { clientId: 'c2' },
        ),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(assertAccess).not.toHaveBeenCalled();
  });
});
