import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { splitAndAggregateCampaigns } from '../ai/utils/campaign-splitter.js';
import { ClientProfileType } from '../clients/enums/client-profile-type.enum.js';
import { CampaignReportsService } from '../campaign-reports/campaign-reports.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { WhatsAppGroupsService } from '../whatsapp-groups/whatsapp-groups.service.js';
import { WhatsAppSessionService } from '../whatsapp-session/whatsapp-session.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { AiService } from '../ai/ai.service.js';
import { InsightSnapshotsService } from '../insight-snapshots/insight-snapshots.service.js';
import { MetaInsightsLevel } from '../campaign-reports/dto/get-insights-query.dto.js';
import { PaginatedResult, MetaInsights } from '../campaign-reports/interfaces/meta-campaign.interface.js';
import { InsightsSummary, AiReportPayload } from '../ai/interfaces/ai-provider.interface.js';
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
    private readonly clientsService: ClientsService,
    private readonly aiService: AiService,
    private readonly insightSnapshotsService: InsightSnapshotsService,
    private readonly configService: ConfigService,
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

    let rawInsights: InsightsSummary | null = null;
    let acquisition: InsightsSummary | null = null;
    let sales: InsightsSummary | null = null;

    try {
      const result = await this.campaignReportsService.getInsights(account.adAccountId, {
        adAccountId: account.adAccountId,
        level: MetaInsightsLevel.ACCOUNT,
        since,
        until,
      } as any);
      const rows = (result as PaginatedResult<MetaInsights>).data ?? [];
      const split = splitAndAggregateCampaigns(rows);
      rawInsights = split.total;
      acquisition = split.acquisition;
      sales = split.sales;
    } catch (err) {
      this.logger.error(`Erro ao buscar insights para conta ${account.adAccountId}`, err);
    }

    let text: string;

    if (rawInsights) {
      try {
        await this.insightSnapshotsService.saveSnapshot(
          account.adAccountId,
          clientId,
          weekStart,
          rawInsights as any,
        );
      } catch (err) {
        this.logger.error(`Erro ao salvar snapshot para conta ${account.adAccountId}`, err);
      }

      const previousSnapshot = await this.insightSnapshotsService.findPreviousSnapshot(
        account.adAccountId,
        weekStart,
      ).catch((err) => {
        this.logger.error(`Erro ao buscar snapshot anterior para conta ${account.adAccountId}`, err);
        return null;
      });

      const current = rawInsights;
      const previous = previousSnapshot ? (previousSnapshot.snapshotJson as unknown as InsightsSummary) : null;
      const deltas = this.computeDeltas(current, previous);

      let clientContext: string | null = null;
      let clientProfile: ClientProfileType = ClientProfileType.SITE_SALES;
      try {
        const client = await this.clientsService.findOne(clientId);
        clientContext = client.aiStrategyContext ?? null;
        clientProfile = client.profileType ?? ClientProfileType.SITE_SALES;
      } catch {
        // cliente não encontrado; continua sem contexto
      }

      const payload: AiReportPayload = {
        period: { since, until, weekNumber: this.getISOWeekNumber(weekStart) },
        current,
        previous,
        deltas,
        acquisition,
        sales,
        clientProfile,
        clientContext,
      };

      try {
        const aiText = await this.aiService.generateReport(payload);
        if (aiText && aiText.trim().length > 0) {
          text = aiText;
        } else {
          this.logger.warn(`IA retornou saída vazia para ${account.adAccountId}, usando fallback estático`);
          text = this.formatReportText(account.accountName ?? account.adAccountId, since, until, rawInsights);
        }
      } catch (err) {
        this.logger.error(`Falha na geração IA para conta ${account.adAccountId}`, err);
        text = this.formatReportText(account.accountName ?? account.adAccountId, since, until, rawInsights);
      }
    } else {
      text = this.formatErrorText(account.accountName ?? account.adAccountId, since, until);
    }

    let dispatched = 0;
    let failed = 0;

    for (const group of groups) {
      await this.sendToGroup(clientId, account.adAccountId, group.groupJid, weekStart, text, since, until);
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
    since: string,
    until: string,
  ): Promise<void> {
    try {
      await this.whatsAppSessionService.sendMessage(groupJid, text);
      await this.logRepo.save(
        this.logRepo.create({
          clientId, groupJid, adAccountId,
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
          clientId, groupJid, adAccountId,
          weekStartDate: weekStart,
          status: DispatchStatus.FAILED,
          errorMessage,
          sentAt: null,
        }),
      );
      await this.sendManagerAlert(clientId, adAccountId, since, until, errorMessage);
    }
  }

  private async sendManagerAlert(
    clientId: string,
    adAccountId: string,
    since: string,
    until: string,
    errorMessage: string,
  ): Promise<void> {
    const managerGroupJid = this.configService.get<string>('MANAGERS_GROUP_JID');
    if (!managerGroupJid) return;
    const text =
      `⚠️ Falha no dispatch — ${clientId} / ${adAccountId}\n` +
      `Semana: ${since} a ${until}\n` +
      `Erro: ${errorMessage}`;
    try {
      await this.whatsAppSessionService.sendMessage(managerGroupJid, text);
    } catch (alertErr) {
      this.logger.error('Falha ao enviar alerta para gestores', alertErr);
    }
  }

  private toInsightsSummary(insights: MetaInsights): InsightsSummary {
    const findAction = (type: string) =>
      parseInt(insights.actions?.find(a => a.action_type === type)?.value ?? '0', 10);

    return {
      spend: parseFloat(insights.spend ?? '0'),
      reach: parseInt(insights.reach ?? '0', 10),
      impressions: parseInt(insights.impressions ?? '0', 10),
      clicks: parseInt(insights.clicks ?? '0', 10),
      ctr: parseFloat(insights.ctr ?? '0'),
      cpm: parseFloat(insights.cpm ?? '0'),
      purchases: findAction('purchase'),
      addToCart: findAction('add_to_cart'),
      pageViews: findAction('landing_page_view'),
      contentViews: findAction('view_content'),
      checkoutInitiated: findAction('initiate_checkout'),
      messagesStarted: findAction('messaging_conversation_started_7d'),
      liveViews: findAction('video_play'),
    };
  }

  private computeDeltas(
    current: InsightsSummary,
    previous: InsightsSummary | null,
  ): Record<string, number | null> {
    if (!previous) return {};
    const keys: (keyof InsightsSummary)[] = [
      'spend', 'reach', 'impressions', 'clicks', 'ctr', 'cpm',
      'purchases', 'addToCart', 'pageViews',
      'contentViews', 'checkoutInitiated', 'messagesStarted', 'liveViews',
    ];
    return Object.fromEntries(
      keys.map(key => [
        key,
        previous[key] > 0 ? (current[key] - previous[key]) / previous[key] : null,
      ]),
    );
  }

  private getISOWeekNumber(date: Date): number {
    // Work in UTC to avoid local-timezone shifts when the input is a UTC date string
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  private async getLastLogStatus(clientId: string, groupJid: string, weekStart: Date): Promise<DispatchStatus> {
    const log = await this.logRepo.findOne({
      where: { clientId, groupJid, weekStartDate: weekStart },
      order: { createdAt: 'DESC' },
    });
    return log?.status ?? DispatchStatus.FAILED;
  }

  private formatReportText(accountName: string, since: string, until: string, insights: InsightsSummary): string {
    const spend = insights.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const impressions = insights.impressions.toLocaleString('pt-BR');
    const clicks = insights.clicks.toLocaleString('pt-BR');
    const ctr = insights.ctr.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const cpm = insights.cpm.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
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
