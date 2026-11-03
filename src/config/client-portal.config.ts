import { registerAs } from '@nestjs/config';

export default registerAs('clientPortal', () => ({
  defaultPassword: process.env.CLIENT_PORTAL_DEFAULT_PASSWORD,
}));
