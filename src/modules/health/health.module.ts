import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller.js';
import { DatabaseKeepaliveService } from './database-keepalive.service.js';
import { RedisConnectionStatusService } from './redis-connection-status.service.js';

@Module({
  imports: [TerminusModule, TypeOrmModule],
  controllers: [HealthController],
  providers: [DatabaseKeepaliveService, RedisConnectionStatusService],
})
export class HealthModule {}
