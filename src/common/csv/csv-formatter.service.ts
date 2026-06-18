import { Injectable } from '@nestjs/common';
import {
  BREAKDOWN_COLUMNS,
  COLUMN_META,
  ColumnType,
  MetaInsightsColumn,
} from '../../modules/campaign-reports/enums/insights-column.enum.js';
import { MetaAction, MetaInsights } from '../../modules/campaign-reports/interfaces/meta-campaign.interface.js';

const ACTION_TYPE_MAP: Partial<Record<MetaInsightsColumn, string>> = {
  [MetaInsightsColumn.LINK_CLICKS]:        'link_click',
  [MetaInsightsColumn.LANDING_PAGE_VIEWS]: 'landing_page_view',
  [MetaInsightsColumn.LEADS]:              'lead',
  [MetaInsightsColumn.PURCHASES]:          'purchase',
  [MetaInsightsColumn.MESSAGING_CONVERSATIONS_STARTED]: 'onsite_conversion.messaging_conversation_started_7d',
};

const VIDEO_FIELD_MAP: Partial<Record<MetaInsightsColumn, keyof MetaInsights>> = {
  [MetaInsightsColumn.VIDEO_PLAYS]: 'video_play_actions',
  [MetaInsightsColumn.VIDEO_P25]:   'video_p25_watched_actions',
  [MetaInsightsColumn.VIDEO_P50]:   'video_p50_watched_actions',
  [MetaInsightsColumn.VIDEO_P75]:   'video_p75_watched_actions',
  [MetaInsightsColumn.VIDEO_P100]:  'video_p100_watched_actions',
};

const UTF8_BOM = '﻿';

@Injectable()
export class CsvFormatterService {
  format(rows: MetaInsights[], columns: MetaInsightsColumn[]): string {
    const header = columns.map(col => this.escapeCsvField(COLUMN_META[col].label)).join(',');
    const dataLines = rows.map(row =>
      columns.map(col => this.formatCell(row, col)).join(','),
    );
    return UTF8_BOM + [header, ...dataLines].join('\r\n');
  }

  private formatCell(row: MetaInsights, col: MetaInsightsColumn): string {
    const raw = this.extractValue(row, col);
    if (raw === undefined || raw === null || raw === '') return '"-"';
    const { type } = COLUMN_META[col];
    return this.escapeCsvField(this.formatValue(raw, type));
  }

  private extractValue(row: MetaInsights, col: MetaInsightsColumn): string | undefined {
    // breakdown and simple fields
    if (BREAKDOWN_COLUMNS.includes(col) || this.isSimpleField(col)) {
      return row[col as keyof MetaInsights] as string | undefined;
    }

    // actions[] mapped columns
    const actionType = ACTION_TYPE_MAP[col];
    if (actionType) {
      return this.findAction(row.actions, actionType);
    }

    // purchase_roas
    if (col === MetaInsightsColumn.PURCHASE_ROAS) {
      return this.findAction(row.purchase_roas, 'omni_purchase');
    }

    // video metrics
    const videoField = VIDEO_FIELD_MAP[col];
    if (videoField) {
      const actions = row[videoField] as MetaAction[] | undefined;
      return actions?.reduce((sum, a) => sum + Number(a.value), 0).toString();
    }

    return undefined;
  }

  private isSimpleField(col: MetaInsightsColumn): boolean {
    const simple: MetaInsightsColumn[] = [
      MetaInsightsColumn.CAMPAIGN_ID,
      MetaInsightsColumn.CAMPAIGN_NAME,
      MetaInsightsColumn.ADSET_NAME,
      MetaInsightsColumn.AD_NAME,
      MetaInsightsColumn.DATE_START,
      MetaInsightsColumn.DATE_STOP,
      MetaInsightsColumn.IMPRESSIONS,
      MetaInsightsColumn.CLICKS,
      MetaInsightsColumn.REACH,
      MetaInsightsColumn.FREQUENCY,
      MetaInsightsColumn.UNIQUE_CLICKS,
      MetaInsightsColumn.SPEND,
      MetaInsightsColumn.CPM,
      MetaInsightsColumn.CPC,
      MetaInsightsColumn.COST_PER_UNIQUE_CLICK,
      MetaInsightsColumn.CTR,
    ];
    return simple.includes(col);
  }

  private findAction(actions: MetaAction[] | undefined, actionType: string): string | undefined {
    return actions?.find(a => a.action_type === actionType)?.value;
  }

  private formatValue(raw: string, type: ColumnType): string {
    switch (type) {
      case 'monetary':
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(raw));
      case 'percentage':
        return `${Number(raw).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
      case 'count':
        return Math.round(Number(raw)).toLocaleString('pt-BR');
      case 'decimal':
        return Number(raw).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      case 'date':
        // Parse manual para evitar offset de timezone (Meta envia YYYY-MM-DD sem timezone)
        return this.parseDate(raw);
      case 'text':
      default:
        return raw;
    }
  }

  private parseDate(raw: string): string {
    const parts = raw.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return raw;
  }

  private escapeCsvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
