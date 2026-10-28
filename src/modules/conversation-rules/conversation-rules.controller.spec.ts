import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConversationRulesController } from './conversation-rules.controller.js';
import { ConversationRulesService } from './conversation-rules.service.js';
import { ClientPortalScopeGuard } from '../auth/guards/client-portal-scope.guard.js';

const mockService = {
  getRecentPosts: jest.fn(),
  getRecentPostsForClient: jest.fn(),
};

describe('ConversationRulesController', () => {
  let controller: ConversationRulesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ConversationRulesController(
      mockService as unknown as ConversationRulesService,
    );
  });

  describe('getPosts', () => {
    it('uses the query pageId for an admin/master-key request (no clientId resolution)', async () => {
      await controller.getPosts({ pageId: 'ig-1', limit: 12 }, undefined);
      expect(mockService.getRecentPosts).toHaveBeenCalledWith(
        'ig-1',
        12,
        undefined,
      );
      expect(mockService.getRecentPostsForClient).not.toHaveBeenCalled();
    });

    it('ignores the query pageId and resolves it from the token for a client-portal request', async () => {
      await controller.getPosts({ pageId: 'attacker-page', limit: 12 }, {
        clientId: 'c1',
        scope: 'client-portal',
      } as any);
      expect(mockService.getRecentPostsForClient).toHaveBeenCalledWith(
        'c1',
        12,
        undefined,
      );
      expect(mockService.getRecentPosts).not.toHaveBeenCalled();
    });

    it('succeeds for a client-portal request that omits pageId entirely', async () => {
      await controller.getPosts({ limit: 12 }, {
        clientId: 'c1',
        scope: 'client-portal',
      } as any);
      expect(mockService.getRecentPostsForClient).toHaveBeenCalledWith(
        'c1',
        12,
        undefined,
      );
      expect(mockService.getRecentPosts).not.toHaveBeenCalled();
    });

    it('rejects an admin/master-key request that omits pageId', () => {
      expect(() =>
        controller.getPosts({ limit: 12 } as any, undefined),
      ).toThrow(BadRequestException);
      expect(mockService.getRecentPosts).not.toHaveBeenCalled();
      expect(mockService.getRecentPostsForClient).not.toHaveBeenCalled();
    });

    it('rejects a client-portal token with no clientId', () => {
      expect(() =>
        controller.getPosts(
          { limit: 12 } as any,
          {
            scope: 'client-portal',
          } as any,
        ),
      ).toThrow(UnauthorizedException);
      expect(mockService.getRecentPosts).not.toHaveBeenCalled();
      expect(mockService.getRecentPostsForClient).not.toHaveBeenCalled();
    });
  });
});

describe('ConversationRulesController guards', () => {
  it.each(['create', 'findAll', 'update', 'remove'] as const)(
    'applies ClientPortalScopeGuard to %s',
    (method) => {
      const target = ConversationRulesController.prototype[method];
      const guards = Reflect.getMetadata(GUARDS_METADATA, target) as
        | unknown[]
        | undefined;

      expect(guards).toContain(ClientPortalScopeGuard);
    },
  );

  it('does not apply ClientPortalScopeGuard to getPosts', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- not invoked, only used as a reflection target
    const { getPosts } = ConversationRulesController.prototype;
    const guards =
      (Reflect.getMetadata(GUARDS_METADATA, getPosts) as
        | unknown[]
        | undefined) ?? [];

    expect(guards).not.toContain(ClientPortalScopeGuard);
  });
});
