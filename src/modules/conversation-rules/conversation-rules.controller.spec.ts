import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConversationRulesController } from './conversation-rules.controller.js';
import { ClientPortalScopeGuard } from '../auth/guards/client-portal-scope.guard.js';

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
