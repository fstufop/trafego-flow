import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard.js';

describe('JwtAuthGuard', () => {
  const verifyAsync = jest.fn();
  const mockJwtService = { verifyAsync } as unknown as JwtService;

  const guard = new JwtAuthGuard(mockJwtService);

  const makeContext = (headers: Record<string, string>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => jest.clearAllMocks());

  it('allows requests with a valid Bearer token', async () => {
    verifyAsync.mockResolvedValue({ sub: 'user-id' });

    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer valid-token' })),
    ).resolves.toBe(true);
  });

  it('rejects an invalid Bearer token', async () => {
    verifyAsync.mockRejectedValue(new Error('expired'));

    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer bad-token' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects requests with no Authorization header', async () => {
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
});
