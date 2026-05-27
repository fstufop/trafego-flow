import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => ({
  url: process.env.REDIS_URL,
  cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS ?? '3600', 10),
}));
