import { registerAs } from '@nestjs/config';

export default registerAs('meta', () => ({
  appId: process.env.META_APP_ID,
  appSecret: process.env.META_APP_SECRET,
  systemUserToken: process.env.META_SYSTEM_USER_TOKEN,
  verifyToken: process.env.META_VERIFY_TOKEN,
  graphApiUrl: process.env.META_GRAPH_API_URL ?? 'https://graph.facebook.com',
  graphApiVersion: process.env.META_GRAPH_API_VERSION ?? 'v21.0',
}));
