import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AdAccountsService } from './ad-accounts.service.js';

@Injectable()
export class AdAccountsTokenMonitorService {
  private readonly logger = new Logger(AdAccountsTokenMonitorService.name);
  private readonly DAYS_AHEAD = 7;

  constructor(private readonly adAccountsService: AdAccountsService) {}

  @Cron('0 8 * * *', { timeZone: 'America/Sao_Paulo' })
  async checkExpiringTokens(): Promise<void> {
    const expiring = await this.adAccountsService.findAllExpiring(this.DAYS_AHEAD);
    for (const account of expiring) {
      const daysLeft = Math.ceil(
        (account.tokenExpiresAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      this.logger.warn(
        `[TOKEN_EXPIRING] adAccountId=${account.adAccountId} clientId=${account.clientId} expiresIn=${daysLeft}d`,
      );
    }
  }
}
