import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import { UserRole } from './constants/user-role.constant.js';

describe('AuthController wiring', () => {
  const reflector = new Reflector();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- not invoked, only used as a reflection target
  const createUser = AuthController.prototype.createUser;

  it('createUser runs AuthGuard then RolesGuard and requires ADMIN role', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, createUser) as
      | unknown[]
      | undefined;

    expect(guards).toEqual([AuthGuard, RolesGuard]);

    const roles = reflector.get<UserRole[]>(ROLES_KEY, createUser);

    expect(roles).toEqual([UserRole.ADMIN]);
  });
});
