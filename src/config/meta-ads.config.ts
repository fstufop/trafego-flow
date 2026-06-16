import { registerAs } from '@nestjs/config';

export default registerAs('meta-ads', () => ({
  apiVersion: process.env.META_ADS_API_VERSION ?? 'v21.0',
}));
