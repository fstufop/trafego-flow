import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { MediaUploadAuthGuard } from './media-upload-auth.guard.js';

describe('MediaUploadAuthGuard', () => {
  const mockConfig = {
    get: jest.fn().mockReturnValue('master-key'),
  } as unknown as ConfigService;
  const verifyAsync = jest.fn();
  const mockJwtService = { verifyAsync } as unknown as JwtService;

  const guard = new MediaUploadAuthGuard(mockConfig, mockJwtService);

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

  it('allows a token scoped to media-upload', async () => {
    verifyAsync.mockResolvedValue({ sub: 'user-id', scope: 'media-upload' });

    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer upload-token' })),
    ).resolves.toBe(true);
  });

  it('rejects a token scoped to something else', async () => {
    verifyAsync.mockResolvedValue({
      sub: 'user-id',
      scope: 'some-other-scope',
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
