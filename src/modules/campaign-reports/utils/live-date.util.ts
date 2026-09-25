export const LIVE_DATE_PATTERN = /(\d{2})_(\d{2})_(\d{2})/;
export const ACQUISITION_PATTERN = /(^|_)CAP[T]?(?:_|$)/i;

export interface ParsedLiveCampaign {
  campaignId: string;
  campaignName: string;
  liveDate: Date;
  liveDateStr: string; // 'DD_MM_AA'
  isAcquisition: boolean;
}

export function parseLiveCampaigns(
  campaigns: { id: string; name: string }[],
): ParsedLiveCampaign[] {
  return campaigns
    .map((c) => {
      const match = LIVE_DATE_PATTERN.exec(c.name);
      if (!match) return null;
      const [, dd, mm, yy] = match;
      const day = parseInt(dd, 10);
      const month = parseInt(mm, 10);
      const year = 2000 + parseInt(yy, 10);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      const liveDate = new Date(year, month - 1, day);
      if (isNaN(liveDate.getTime())) return null;
      return {
        campaignId: c.id,
        campaignName: c.name,
        liveDate,
        liveDateStr: `${dd}_${mm}_${yy}`,
        isAcquisition: ACQUISITION_PATTERN.test(c.name),
      };
    })
    .filter((c): c is ParsedLiveCampaign => c !== null);
}

export function getLatestLiveDates(
  parsed: ParsedLiveCampaign[],
  count: number,
): Date[] {
  const seen = new Map<string, Date>();
  for (const c of parsed) {
    if (!seen.has(c.liveDateStr)) seen.set(c.liveDateStr, c.liveDate);
  }
  return [...seen.values()]
    .sort((a, b) => b.getTime() - a.getTime())
    .slice(0, count);
}

export function formatDisplayDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

export function formatIsoDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${yyyy}-${mm}-${dd}`;
}
