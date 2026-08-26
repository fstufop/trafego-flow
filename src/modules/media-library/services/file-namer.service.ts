import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, MoreThanOrEqual } from 'typeorm';
import { MediaIntention } from '../dto/upload-media.dto.js';
import { MediaUploadLog } from '../entities/media-upload-log.entity.js';

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
  constructor(
    @InjectRepository(MediaUploadLog)
    private readonly logsRepo: Repository<MediaUploadLog>,
  ) {}

  async generateName(
    file: { originalname: string },
    intention: MediaIntention,
    productName: string,
    clientId: string,
    date = new Date(),
    startVersion?: number,
  ): Promise<string> {
    const dotIdx = file.originalname.lastIndexOf('.');
    const ext = dotIdx >= 0 ? file.originalname.slice(dotIdx) : '';
    const product = sanitize(productName);
    const dateStr = dateSuffix(date);
    const base = `${intention} - ${mediaType(ext)} - ${product} - ${dateStr}`;

    if (startVersion !== undefined) {
      return `${base} - V${startVersion}${ext}`;
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const count = await this.logsRepo.count({
      where: {
        clientId,
        mediaName: Like(`${base}%`),
        createdAt: MoreThanOrEqual(startOfDay),
      },
    });

    return count === 0 ? `${base}${ext}` : `${base} - V${count + 1}${ext}`;
  }
}
