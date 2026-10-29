import { MODULE_METADATA } from '@nestjs/common/constants';
import { AuthModule } from './auth.module.js';
import { ClientPortalAuthService } from './client-portal-auth.service.js';
import { ClientPortalScopeGuard } from './guards/client-portal-scope.guard.js';

describe('AuthModule exports', () => {
  // `ClientPortalScopeGuard` is injected by class reference (`@UseGuards(ClientPortalScopeGuard)`)
  // in consuming modules such as ConversationRulesModule. Nest instantiates a
  // class-referenced guard inside the CONSUMING module's injector context, so
  // every one of the guard's own constructor dependencies — here,
  // `ClientPortalAuthService` — must *also* be exported by AuthModule, not just
  // the guard itself. Exporting only the guard compiles fine but fails at
  // Nest bootstrap with "can't resolve dependencies of ClientPortalScopeGuard
  // (?). Please make sure that the argument ClientPortalAuthService at index
  // [0] is available in the ConversationRulesModule context."
  it('exports both ClientPortalScopeGuard and its ClientPortalAuthService dependency', () => {
    const exportsMetadata = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      AuthModule,
    ) as unknown[];

    expect(exportsMetadata).toContain(ClientPortalScopeGuard);
    expect(exportsMetadata).toContain(ClientPortalAuthService);
  });
});
