import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertJobEntity } from './entities/alert-job.entity.js';
import { AlertJobsService } from './alert-jobs.service.js';
import { AlertJobsController } from './alert-jobs.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([AlertJobEntity])],
  controllers: [AlertJobsController],
  providers: [AlertJobsService],
  exports: [AlertJobsService],
})
export class AlertJobsModule {}
