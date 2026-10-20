export interface BullRedisConnection {
  host: string;
  port: number;
  password: string | undefined;
  maxRetriesPerRequest: null;
  tls?: Record<string, never>;
}

export function buildBullRedisConnection(redisUrl: string): BullRedisConnection {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
