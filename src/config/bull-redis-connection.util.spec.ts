import { buildBullRedisConnection } from './bull-redis-connection.util.js';

describe('buildBullRedisConnection', () => {
  it('enables TLS for rediss:// URLs (e.g. Upstash)', () => {
    const conn = buildBullRedisConnection('rediss://default:secret@genuine-amoeba-203357.upstash.io:6379');
    expect(conn.tls).toEqual({});
  });

  it('does not set TLS for plain redis:// URLs', () => {
    const conn = buildBullRedisConnection('redis://default:secret@localhost:6379');
    expect(conn.tls).toBeUndefined();
  });

  it('extracts host, port and password correctly', () => {
    const conn = buildBullRedisConnection('rediss://default:my-pass@my-host.example.com:6380');
    expect(conn.host).toBe('my-host.example.com');
    expect(conn.port).toBe(6380);
    expect(conn.password).toBe('my-pass');
  });

  it('defaults port to 6379 when not specified', () => {
    const conn = buildBullRedisConnection('redis://default:secret@localhost');
    expect(conn.port).toBe(6379);
  });

  it('sets maxRetriesPerRequest to null (required by BullMQ)', () => {
    const conn = buildBullRedisConnection('redis://localhost:6379');
    expect(conn.maxRetriesPerRequest).toBeNull();
  });

  it('leaves password undefined when the URL has none', () => {
    const conn = buildBullRedisConnection('redis://localhost:6379');
    expect(conn.password).toBeUndefined();
  });
});
