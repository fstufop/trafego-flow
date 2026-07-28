import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CampaignReportsService } from '../campaign-reports/campaign-reports.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { WhatsAppGroupsService } from '../whatsapp-groups/whatsapp-groups.service.js';
import { WhatsAppSessionService } from '../whatsapp-session/whatsapp-session.service.js';
import { MetaInsightsLevel } from '../campaign-reports/dto/get-insights-query.dto.js';
import { PaginatedResult, MetaInsights } from '../campaign-reports/interfaces/meta-campaign.interface.js';
import { ReportDispatchLogEntity, DispatchStatus } from './entities/report-dispatch-log.entity.js';
import { IReportDispatchesService } from './interfaces/report-dispatches-service.interface.js';
import { TriggerDispatchDto } from './dto/trigger-dispatch.dto.js';

@Injectable()
export class ReportDispatchesService implements IReportDispatchesService {
  private readonly logger = new Logger(ReportDispatchesService.name);

  constructor(
    @InjectRepository(ReportDispatchLogEntity)
    private readonly logRepo: Repository<ReportDispatchLogEntity>,
    private readonly campaignReportsService: CampaignReportsService,
    private readonly adAccountsService: AdAccountsService,
    private readonly whatsAppGroupsService: WhatsAppGroupsService,
    private readonly whatsAppSessionService: WhatsAppSessionService,
  ) {}

  async triggerForClient(dto: TriggerDispatchDto): Promise<{ dispatched: number; failed: number }> {
    const weekStart = dto.weekStartDate ? new Date(dto.weekStartDate) : this.getLastMonday();
    const groupsByClient = await this.whatsAppGroupsService.findAllActiveGroupedByClientId();

    let dispatched = 0;
    let failed = 0;

    const clientIds = dto.clientId ? [dto.clientId] : Array.from(groupsByClient.keys());

    for (const clientId of clientIds) {
      const groups = groupsByClient.get(clientId);
      if (!groups?.length) continue;

      const adAccounts = await this.adAccountsService.findAll(clientId);
      const activeAccounts = adAccounts.filter(a => a.isActive);

      for (const account of activeAccounts) {
        const result = await this.buildAndSend(clientId, account, groups, weekStart);
        dispatched += result.dispatched;
        failed += result.failed;
      }
    }

    return { dispatched, failed };
  }

  async triggerAll(): Promise<void> {
    this.logger.log('Iniciando envio semanal de relatórios');
    const weekStart = this.getLastMonday();
    const groupsByClient = await this.whatsAppGroupsService.findAllActiveGroupedByClientId();

    for (const [clientId, groups] of groupsByClient.entries()) {
      if (!groups.length) continue;

      const adAccounts = await this.adAccountsService.findAll(clientId);
      const activeAccounts = adAccounts.filter(a => a.isActive);

      for (const account of activeAccounts) {
        await this.buildAndSend(clientId, account, groups, weekStart);
      }
    }

    this.logger.log('Envio semanal de relatórios concluído');
  }

  async findLogs(clientId?: string): Promise<ReportDispatchLogEntity[]> {
    return this.logRepo.find({
      where: clientId ? { clientId } : {},
      order: { createdAt: 'DESC' },
    });
  }

  private async buildAndSend(
    clientId: string,
    account: { adAccountId: string; accountName: string | null },
    groups: Array<{ groupJid: string }>,
    weekStart: Date,
  ): Promise<{ dispatched: number; failed: number }> {
    const since = this.formatDate(weekStart);
    const until = this.formatDate(new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000));

    let insights: MetaInsights | null = null;

    try {
      const result = await this.campaignReportsService.getInsights(account.adAccountId, {
        adAccountId: account.adAccountId,
        level: MetaInsightsLevel.ACCOUNT,
        since,
        until,
      } as any);

      const rows = (result as PaginatedResult<MetaInsights>).data ?? [];
      insights = this.aggregateInsights(rows);
    } catch (err) {
      this.logger.error(`Erro ao buscar insights para conta ${account.adAccountId}`, err);
    }

    const text = insights
      ? this.formatReportText(account.accountName ?? account.adAccountId, since, until, insights)
      : this.formatErrorText(account.accountName ?? account.adAccountId, since, until);

    let dispatched = 0;
    let failed = 0;

    for (const group of groups) {
      await this.sendToGroup(clientId, account.adAccountId, group.groupJid, weekStart, text);

      const status = await this.getLastLogStatus(clientId, group.groupJid, weekStart);
      if (status === DispatchStatus.SENT) dispatched++;
      else failed++;

      await this.randomDelay();
    }

    return { dispatched, failed };
  }

  private async sendToGroup(
    clientId: string,
    adAccountId: string,
    groupJid: string,
    weekStart: Date,
    text: string,
  ): Promise<void> {
    try {
      await this.whatsAppSessionService.sendMessage(groupJid, text);
      await this.logRepo.save(
        this.logRepo.create({
          clientId,
          groupJid,
          adAccountId,
          weekStartDate: weekStart,
          status: DispatchStatus.SENT,
          errorMessage: null,
          sentAt: new Date(),
        }),
      );
    } catch (err: any) {
      const errorMessage = err?.message ?? String(err);
      this.logger.error(`Falha ao enviar para ${groupJid}: ${errorMessage}`);
      await this.logRepo.save(
        this.logRepo.create({
          clientId,
          groupJid,
          adAccountId,
          weekStartDate: weekStart,
          status: DispatchStatus.FAILED,
          errorMessage,
          sentAt: null,
        }),
      );
    }
  }

  private async getLastLogStatus(
    clientId: string,
    groupJid: string,
    weekStart: Date,
  ): Promise<DispatchStatus> {
    const log = await this.logRepo.findOne({
      where: { clientId, groupJid, weekStartDate: weekStart },
      order: { createdAt: 'DESC' },
    });
    return log?.status ?? DispatchStatus.FAILED;
  }

  private aggregateInsights(rows: MetaInsights[]): MetaInsights {
    const base: MetaInsights = {
      impressions: '0',
      clicks: '0',
      spend: '0',
      reach: '0',
      cpm: '0',
      cpc: '0',
      ctr: '0',
      date_start: rows[0]?.date_start ?? '',
      date_stop: rows[rows.length - 1]?.date_stop ?? '',
    };

    if (!rows.length) return base;

    let spend = 0;
    let impressions = 0;
    let clicks = 0;

    for (const row of rows) {
      spend += parseFloat(row.spend ?? '0');
      impressions += parseInt(row.impressions ?? '0', 10);
      clicks += parseInt(row.clicks ?? '0', 10);
    }

    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;

    return {
      ...base,
      spend: spend.toFixed(2),
      impressions: String(impressions),
      clicks: String(clicks),
      ctr: ctr.toFixed(2),
      cpm: cpm.toFixed(2),
    };
  }

  private formatReportText(
    accountName: string,
    since: string,
    until: string,
    insights: MetaInsights,
  ): string {
    const spend = parseFloat(insights.spend).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const impressions = parseInt(insights.impressions).toLocaleString('pt-BR');
    const clicks = parseInt(insights.clicks).toLocaleString('pt-BR');
    const ctr = parseFloat(insights.ctr).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const cpm = parseFloat(insights.cpm).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

    const [sinceDay, sinceMonth] = since.split('-').slice(1).reverse();
    const [untilDay, untilMonth, untilYear] = until.split('-').reverse();

    return [
      `📊 *Relatório Semanal*`,
      `📅 Semana: ${sinceDay}/${sinceMonth} a ${untilDay}/${untilMonth}/${untilYear}`,
      `💼 Conta: ${accountName}`,
      ``,
      `💰 Investimento: R$ ${spend}`,
      `👁 Impressões: ${impressions}`,
      `🖱 Cliques: ${clicks}`,
      `📈 CTR: ${ctr}%`,
      `💵 CPM: R$ ${cpm}`,
      ``,
      `_Enviado automaticamente por TráfegoFlow_`,
    ].join('\n');
  }

  private formatErrorText(accountName: string, since: string, until: string): string {
    return [
      `📊 *Relatório Semanal*`,
      `💼 Conta: ${accountName}`,
      `📅 Período: ${since} a ${until}`,
      ``,
      `⚠️ Não foi possível carregar os dados desta semana. Por favor, verifique manualmente.`,
      ``,
      `_Enviado automaticamente por TráfegoFlow_`,
    ].join('\n');
  }

  private getLastMonday(): Date {
    const now = new Date();
    const day = now.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - diff - 7);
    monday.setUTCHours(0, 0, 0, 0);
    return monday;
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private randomDelay(): Promise<void> {
    const ms = 5_000 + Math.random() * 10_000;
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
