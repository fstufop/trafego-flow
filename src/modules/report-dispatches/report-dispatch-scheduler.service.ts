import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReportDispatchesService } from './report-dispatches.service.js';

@Injectable()
export class ReportDispatchSchedulerService {
  private readonly logger = new Logger(ReportDispatchSchedulerService.name);

  constructor(private readonly reportDispatchesService: ReportDispatchesService) {}

  @Cron('0 8 * * 1', { timeZone: 'America/Sao_Paulo' })
  async handleWeeklyCron(): Promise<void> {
    this.logger.log('Cron semanal disparado — iniciando envio de relatórios');
    await this.reportDispatchesService.triggerAll();
  }
}
