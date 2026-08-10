import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AdsetAlertSnapshotEntity } from './entities/adset-alert-snapshot.entity.js';
import { AlertJobsService } from '../alert-jobs/alert-jobs.service.js';
import { AlertJobEntity } from '../alert-jobs/entities/alert-job.entity.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { CampaignReportsService } from '../campaign-reports/campaign-reports.service.js';
import { WhatsAppSessionService } from '../whatsapp-session/whatsapp-session.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { MetaAdset } from '../campaign-reports/interfaces/meta-campaign.interface.js';

interface AdsetRow {
  adsetName: string;
  roas: number | null;
  updatedTime: string;
}

interface ClientBucket {
  clientName: string;
  adsets: AdsetRow[];
}

@Injectable()
export class AdsetAlertsService {
  private readonly logger = new Logger(AdsetAlertsService.name);

  constructor(
    @InjectRepository(AdsetAlertSnapshotEntity)
    private readonly snapshotRepo: Repository<AdsetAlertSnapshotEntity>,
    private readonly alertJobsService: AlertJobsService,
    private readonly adAccountsService: AdAccountsService,
    private readonly campaignReportsService: CampaignReportsService,
    private readonly whatsAppSessionService: WhatsAppSessionService,
    private readonly clientsService: ClientsService,
    private readonly configService: ConfigService,
  ) {}

  async triggerAll(): Promise<void> {
    const jobs = await this.alertJobsService.findActive();
    for (const job of jobs) {
      await this.runForJob(job);
    }
  }

  async triggerManual(): Promise<void> {
    await this.triggerAll();
  }

  async runForJob(job: AlertJobEntity): Promise<void> {
    const errors: string[] = [];
    const clientBuckets = new Map<string, ClientBucket>();
    const snapshotIds: string[] = [];
    const today = new Date().toISOString().slice(0, 10);

    const allClients = await this.clientsService.findAll();
    const clients = job.clientId
      ? allClients.filter((c) => c.id === job.clientId)
      : allClients;

    this.logger.debug(`[DIAG] job=${job.id} clientId=${job.clientId} allClients=${allClients.length} filtered=${clients.length}`);

    for (const client of clients) {
      const clientName = client.name ?? client.id;
      const adAccounts = await this.adAccountsService.findAll(client.id);
      const activeAccounts = adAccounts.filter((a) => a.isActive);

      this.logger.debug(`[DIAG] client=${client.id} adAccounts=${adAccounts.length} active=${activeAccounts.length}`);

      for (const account of activeAccounts) {
        let adsets: MetaAdset[] = [];
        try {
          adsets = await this.campaignReportsService.listAdsets(
            account.adAccountId,
          );
        } catch (err) {
          const msg = `${clientName} / ${account.adAccountId}: ${String(err)}`;
          errors.push(msg);
          this.logger.error(
            `Falha ao buscar adsets para ${account.adAccountId}: ${msg}`,
          );
          continue;
        }

        const activeAdsets = adsets.filter(
          (a) => a.effective_status === 'ACTIVE',
        );

        this.logger.debug(`[DIAG] account=${account.adAccountId} adsets=${adsets.length} active=${activeAdsets.length}`);

        for (const adset of activeAdsets) {
          const since = adset.updated_time.slice(0, 10);
          let roas: number | null = null;

          try {
            const insights = await this.campaignReportsService.getAdsetInsights(
              adset.id,
              account.adAccountId,
              since,
              today,
            );
            if (insights) {
              const raw = parseFloat(insights.purchase_roas?.[0]?.value ?? '0');
              roas = raw > 0 ? raw : null;
            }
          } catch (err) {
            const msg = `${clientName} / ${adset.name}: ${String(err)}`;
            errors.push(msg);
            this.logger.error(
              `Falha ao buscar insights do adset ${adset.id}: ${msg}`,
            );
          }

          const saved = await this.snapshotRepo.save(
            this.snapshotRepo.create({
              jobId: job.id,
              clientId: client.id,
              adAccountId: account.adAccountId,
              adsetId: adset.id,
              adsetName: adset.name,
              roas,
              updatedTime: since,
              sentAt: null,
            }),
          );
          snapshotIds.push(saved.id);

          if (!clientBuckets.has(client.id)) {
            clientBuckets.set(client.id, { clientName, adsets: [] });
          }
          clientBuckets
            .get(client.id)!
            .adsets.push({ adsetName: adset.name, roas, updatedTime: since });
        }
      }
    }

    const managersGroupJid =
      this.configService.get<string>('MANAGERS_GROUP_JID');
    if (!managersGroupJid) {
      this.logger.warn(
        'MANAGERS_GROUP_JID não configurado — mensagem não enviada',
      );
      return;
    }

    const message = this.formatMessage(clientBuckets, errors);
    try {
      await this.whatsAppSessionService.sendMessage(managersGroupJid, message);
      if (snapshotIds.length > 0) {
        await this.snapshotRepo.update(
          { id: In(snapshotIds) },
          { sentAt: new Date() },
        );
      }
    } catch (err) {
      this.logger.error(
        `Falha ao enviar mensagem para o grupo de managers: ${String(err)}`,
      );
    }
  }

  formatMessage(
    clientBuckets: Map<string, ClientBucket>,
    errors: string[],
  ): string {
    const lines: string[] = [];

    for (const { clientName, adsets } of clientBuckets.values()) {
      if (!adsets.length) continue;
      lines.push(`*Nome do cliente*: ${clientName}`);
      lines.push('');
      for (const adset of adsets) {
        const roas = adset.roas !== null ? adset.roas.toFixed(2) : '–';
        const date = this.formatDate(adset.updatedTime);
        lines.push(
          `*Conjunto de anúncios*: ${adset.adsetName} | *ROAS*: ${roas} | *Última atualização*: ${date}`,
        );
      }
      lines.push('');
    }

    if (errors.length) {
      lines.push('⚠️ *Erros:*');
      for (const err of errors) {
        lines.push(`- ${err}`);
      }
    }

    return lines.join('\n').trim();
  }

  private formatDate(isoDate: string): string {
    const [year, month, day] = isoDate.slice(0, 10).split('-');
    return `${day}/${month}/${year}`;
  }
}
