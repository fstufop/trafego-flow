import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RedisConnectionStatusService } from './redis-connection-status.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redisStatus: RedisConnectionStatusService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database', { connection: this.dataSource }),
      () => this.pingRedis(),
    ]);
  }

  private pingRedis(): HealthIndicatorResult {
    return {
      redis: { status: this.redisStatus.isConnected() ? 'up' : 'down' },
    };
  }
}
