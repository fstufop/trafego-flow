import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as fs from 'fs';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { FileNamerService } from './services/file-namer.service.js';
import { GoogleDriveService } from './services/google-drive.service.js';
import { UploadMediaDto } from './dto/upload-media.dto.js';
import { MediaUploadLog } from './entities/media-upload-log.entity.js';
import { MediaUploadStatus } from './enums/media-upload-status.enum.js';
import { MetaUploadJobPayload } from './types/meta-upload-job.type.js';
import { PaginatedLogs, UploadInitiatedResult } from './types/upload-result.type.js';

@Injectable()
export class MediaLibraryService {
  constructor(
    private readonly adAccounts: AdAccountsService,
    private readonly clients: ClientsService,
    private readonly crypto: AesCryptoService,
    private readonly fileNamer: FileNamerService,
    private readonly drive: GoogleDriveService,
    @InjectRepository(MediaUploadLog)
    private readonly logsRepo: Repository<MediaUploadLog>,
    @InjectQueue('media-upload')
    private readonly queue: Queue,
  ) {}

  async upload(dto: UploadMediaDto, file: Express.Multer.File): Promise<UploadInitiatedResult> {
    const [adAccount, client] = await Promise.all([
      this.adAccounts.findByAdAccountId(dto.adAccountId),
      this.clients.findOne(dto.clientId),
    ]);

    if (!client.googleDriveFolderUrl) {
      throw new UnprocessableEntityException(
        `Client ${dto.clientId} has no Google Drive folder configured`,
      );
    }

    const mediaName = await this.fileNamer.generateName(
      file,
      dto.intention,
      dto.productName,
      dto.clientId,
      new Date(),
      dto.startVersion,
    );

    const { fileId: driveFileId, webViewLink: driveUrl } = await this.drive.upload(
      client.googleDriveFolderUrl,
      file.path,
      mediaName,
      file.mimetype,
    );

    fs.unlink(file.path, () => {});

    const log = await this.logsRepo.save({
      clientId: dto.clientId,
      adAccountId: dto.adAccountId,
      mediaName,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      status: MediaUploadStatus.PROCESSING,
      driveFileId,
      driveUrl,
      metaAssetId: null,
      errorMessage: null,
      attemptCount: 0,
    });

    const payload: MetaUploadJobPayload = {
      logId: log.id,
      driveFileId,
      adAccountId: dto.adAccountId,
      encryptedAccessToken: adAccount.accessToken,
      mimeType: file.mimetype,
      mediaName,
    };

    await this.queue.add('meta-upload', payload, { attempts: 1 });

    return { logId: log.id, mediaName, driveUrl, status: MediaUploadStatus.PROCESSING };
  }

  async getLogs(clientId: string, page: number, limit: number): Promise<PaginatedLogs> {
    const [data, total] = await this.logsRepo.findAndCount({
      where: { clientId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  async retryOne(logId: string): Promise<{ logId: string; status: MediaUploadStatus }> {
    const log = await this.logsRepo.findOneOrFail({ where: { id: logId } });

    if (log.status !== MediaUploadStatus.FAILED) {
      throw new BadRequestException(`Log ${logId} is not in FAILED status`);
    }

    const adAccount = await this.adAccounts.findByAdAccountId(log.adAccountId);

    await this.logsRepo.update(logId, {
      status: MediaUploadStatus.PROCESSING,
      errorMessage: null,
      attemptCount: log.attemptCount + 1,
    });

    const payload: MetaUploadJobPayload = {
      logId: log.id,
      driveFileId: log.driveFileId,
      adAccountId: log.adAccountId,
      encryptedAccessToken: adAccount.accessToken,
      mimeType: log.mimeType,
      mediaName: log.mediaName,
    };

    await this.queue.add('meta-upload', payload, { attempts: 1 });

    return { logId, status: MediaUploadStatus.PROCESSING };
  }

  async retryFailed(clientId: string): Promise<{ retried: number }> {
    const failedLogs = await this.logsRepo.find({
      where: { clientId, status: MediaUploadStatus.FAILED },
    });

    if (failedLogs.length === 0) return { retried: 0 };

    await Promise.all(failedLogs.map(log => this.retryOne(log.id)));
    return { retried: failedLogs.length };
  }
}
