import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AdsetAlertsService } from './adset-alerts.service.js';

@Injectable()
export class AdsetAlertSchedulerService {
  private readonly logger = new Logger(AdsetAlertSchedulerService.name);

  constructor(private readonly adsetAlertsService: AdsetAlertsService) {}

  @Cron('30 7 * * *', { timeZone: 'America/Sao_Paulo' })
  async handleDailyCron(): Promise<void> {
    const delayMs = Math.floor(Math.random() * 30 * 60 * 1000);
    this.logger.log(
      `Alerta de adsets agendado — delay de ${Math.round(delayMs / 60000)} min`,
    );
    await this.delay(delayMs);
    this.logger.log('Iniciando alerta diário de adsets');
    await this.adsetAlertsService.triggerAll();
    this.logger.log('Alerta diário de adsets concluído');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
