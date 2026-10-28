import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard.js';

describe('AuthGuard', () => {
  const mockConfig = {
    get: jest.fn().mockReturnValue('master-key'),
  } as unknown as ConfigService;
  const verifyAsync = jest.fn();
  const mockJwtService = { verifyAsync } as unknown as JwtService;

  const guard = new AuthGuard(mockConfig, mockJwtService);

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

  it('allows requests with a valid Bearer token', async () => {
    verifyAsync.mockResolvedValue({ sub: 'user-id' });

    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer valid-token' })),
    ).resolves.toBe(true);
    expect(verifyAsync).toHaveBeenCalledWith('valid-token');
  });

  it('rejects an invalid Bearer token', async () => {
    verifyAsync.mockRejectedValue(new Error('expired'));

    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer bad-token' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a wrong API key without falling back', async () => {
    await expect(
      guard.canActivate(makeContext({ 'x-api-key': 'wrong-key' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects requests with no credentials', async () => {
    await expect(guard.canActivate(makeContext({}))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token carrying a scope claim (e.g. an upload-scoped token)', async () => {
    verifyAsync.mockResolvedValue({ sub: 'user-id', scope: 'media-upload' });

    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer scoped-token' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('allows a token with the client-portal scope and exposes clientId', async () => {
    verifyAsync.mockResolvedValue({
      sub: 'portal-user-id',
      clientId: 'client-id',
      scope: 'client-portal',
    });
    const ctx = makeContext({ authorization: 'Bearer client-token' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('still rejects a token with an unrecognized scope (e.g. media-upload)', async () => {
    verifyAsync.mockResolvedValue({ sub: 'user-id', scope: 'media-upload' });
    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer scoped-token' })),
    ).rejects.toThrow(UnauthorizedException);
  });
});
