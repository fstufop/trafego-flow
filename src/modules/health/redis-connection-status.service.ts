import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { buildBullRedisConnection } from '../../config/bull-redis-connection.util.js';
import { IRedisConnectionStatusService } from './interfaces/redis-connection-status-service.interface.js';

@Injectable()
export class RedisConnectionStatusService
  implements IRedisConnectionStatusService, OnModuleDestroy
{
  private readonly logger = new Logger(RedisConnectionStatusService.name);
  private readonly client: Redis;
  private connected = false;

  constructor(config: ConfigService) {
    this.client = new Redis(
      buildBullRedisConnection(config.get<string>('redis.url')!),
    );

    this.client.on('ready', () => {
      this.connected = true;
    });
    this.client.on('error', (err: Error) => {
      this.connected = false;
      this.logger.warn(`Redis connection status check failed: ${err.message}`);
    });
    this.client.on('close', () => {
      this.connected = false;
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
