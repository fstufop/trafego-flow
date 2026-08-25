import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MediaUploadLog } from '../entities/media-upload-log.entity.js';
import { MediaUploadStatus } from '../enums/media-upload-status.enum.js';
import { MetaUploadJobPayload } from '../types/meta-upload-job.type.js';
import { MetaMediaService } from '../services/meta-media.service.js';
import { GoogleDriveService } from '../services/google-drive.service.js';
import { AesCryptoService } from '../../../common/crypto/aes.service.js';

@Processor('media-upload')
export class MetaUploadProcessor extends WorkerHost {
  constructor(
    @InjectRepository(MediaUploadLog)
    private readonly logsRepo: Repository<MediaUploadLog>,
    private readonly meta: MetaMediaService,
    private readonly drive: GoogleDriveService,
    private readonly crypto: AesCryptoService,
  ) {
    super();
  }

  async process(job: Job<MetaUploadJobPayload>): Promise<void> {
    const { logId, driveFileId, adAccountId, encryptedAccessToken, mimeType, mediaName } = job.data;
    const accessToken = this.crypto.decrypt(encryptedAccessToken);
    const tempPath = path.join(os.tmpdir(), `meta-upload-${job.id}`);

    try {
      await this.drive.download(driveFileId, tempPath);
      const metaAssetId = await this.meta.upload(adAccountId, accessToken, tempPath, mediaName, mimeType);
      await this.logsRepo.update(logId, {
        status: MediaUploadStatus.SUCCESS,
        metaAssetId,
        errorMessage: null,
      });
    } catch (err) {
      await this.logsRepo.update(logId, {
        status: MediaUploadStatus.FAILED,
        errorMessage: String(err),
      });
    } finally {
      fs.unlink(tempPath, () => {});
    }
  }
}
