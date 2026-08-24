import { Injectable } from '@nestjs/common';
import { MediaIntention } from '../dto/upload-media.dto.js';

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);

const PT_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function mediaType(ext: string): 'VID' | 'IMG' {
  return VIDEO_EXTS.has(ext.toLowerCase()) ? 'VID' : 'IMG';
}

function sanitize(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim();
}

function dateSuffix(date: Date): string {
  return `${PT_MONTHS[date.getMonth()]} ${String(date.getFullYear()).slice(-2)}`;
}

@Injectable()
export class FileNamerService {
  generateNames(
    files: { originalname: string }[],
    intention: MediaIntention,
    productName: string,
    date = new Date(),
  ): string[] {
    const product = sanitize(productName);
    const dateStr = dateSuffix(date);

    // First pass: compute base name and count duplicates
    const entries = files.map((file) => {
      const dotIdx = file.originalname.lastIndexOf('.');
      const ext = dotIdx >= 0 ? file.originalname.slice(dotIdx) : '';
      const base = `${intention} - ${mediaType(ext)} - ${product} - ${dateStr}`;
      return { base, ext };
    });

    const baseCounts = new Map<string, number>();
    for (const { base } of entries) {
      baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
    }

    // Second pass: assign versions only when base appears more than once
    const baseVersions = new Map<string, number>();
    return entries.map(({ base, ext }) => {
      if (baseCounts.get(base)! > 1) {
        const v = (baseVersions.get(base) ?? 0) + 1;
        baseVersions.set(base, v);
        return `${base} - V${v}${ext}`;
      }
      return `${base}${ext}`;
    });
  }
}
