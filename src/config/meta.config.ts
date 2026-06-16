import { registerAs } from '@nestjs/config';

export default registerAs('meta', () => ({
  appSecret: process.env.META_APP_SECRET,
  verifyToken: process.env.META_VERIFY_TOKEN,
  graphApiUrl: process.env.META_GRAPH_API_URL ?? 'https://graph.facebook.com',
  graphApiVersion: process.env.META_GRAPH_API_VERSION ?? 'v21.0',
}));
