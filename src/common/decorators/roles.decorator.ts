import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../modules/auth/constants/user-role.constant.js';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
