import { registerAs } from '@nestjs/config';

export default registerAs('mailgun', () => ({
  apiKey: process.env.MAILGUN_API_KEY,
  domain: process.env.MAILGUN_DOMAIN,
  from: process.env.MAILGUN_FROM,
  portalUrl: process.env.CLIENT_PORTAL_URL,
}));
