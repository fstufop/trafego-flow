import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import axios from 'axios';

function formatError(err: unknown): string {
  if (axios.isAxiosError(err) && err.response) {
    const metaMsg = err.response.data?.error?.message;
    const metaCode = err.response.data?.error?.code;
    if (metaMsg) return `Meta API ${err.response.status}: ${metaMsg}${metaCode ? ` (code ${metaCode})` : ''}`;
    return `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`;
  }
  return String(err);
}
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { FileNamerService } from './services/file-namer.service.js';
import { GoogleDriveService } from './services/google-drive.service.js';
import { MetaMediaService } from './services/meta-media.service.js';
import { UploadMediaDto } from './dto/upload-media.dto.js';
import { UploadResult } from './types/upload-result.type.js';

@Injectable()
export class MediaLibraryService {
  constructor(
    private readonly adAccounts: AdAccountsService,
    private readonly clients: ClientsService,
    private readonly crypto: AesCryptoService,
    private readonly fileNamer: FileNamerService,
    private readonly drive: GoogleDriveService,
    private readonly meta: MetaMediaService,
  ) {}

  async upload(dto: UploadMediaDto, files: Express.Multer.File[]): Promise<UploadResult[]> {
    const [adAccount, client] = await Promise.all([
      this.adAccounts.findByAdAccountId(dto.adAccountId),
      this.clients.findOne(dto.clientId),
    ]);

    if (!client.googleDriveFolderUrl) {
      throw new UnprocessableEntityException(
        `Client ${dto.clientId} has no Google Drive folder configured`,
      );
    }

    const accessToken = this.crypto.decrypt(adAccount.accessToken);
    const fileNames = this.fileNamer.generateNames(files, dto.intention, dto.productName);

    return Promise.all(
      files.map(async (file, i) => {
        const fileName = fileNames[i];
        const result: UploadResult = { fileName, errors: [] };

        const [driveSettled, metaSettled] = await Promise.allSettled([
          this.drive.upload(client.googleDriveFolderUrl!, file.path, fileName, file.mimetype),
          this.meta.upload(dto.adAccountId, accessToken, file.path, fileName, file.mimetype),
        ]);

        if (driveSettled.status === 'fulfilled') {
          result.driveFileId = driveSettled.value.fileId;
          result.driveUrl = driveSettled.value.webViewLink;
        } else {
          result.errors.push({ destination: 'drive', message: formatError(driveSettled.reason) });
        }

        if (metaSettled.status === 'fulfilled') {
          result.metaAssetId = metaSettled.value;
        } else {
          result.errors.push({ destination: 'meta', message: formatError(metaSettled.reason) });
        }

        return result;
      }),
    );
  }
}
