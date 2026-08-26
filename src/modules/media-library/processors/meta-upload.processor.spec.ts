import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import * as os from 'os';
import * as fs from 'fs';

// Mock googleapis to prevent module-load errors when google-drive.service.ts is imported
jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: jest.fn().mockImplementation(() => ({ setCredentials: jest.fn() })) },
    drive: jest.fn().mockReturnValue({ files: { create: jest.fn(), get: jest.fn() } }),
  },
}));

import { MetaUploadProcessor } from './meta-upload.processor.js';
import { MediaUploadLog } from '../entities/media-upload-log.entity.js';
import { MediaUploadStatus } from '../enums/media-upload-status.enum.js';
import { MetaMediaService } from '../services/meta-media.service.js';
import { GoogleDriveService } from '../services/google-drive.service.js';
import { AesCryptoService } from '../../../common/crypto/aes.service.js';
import { MetaUploadJobPayload } from '../types/meta-upload-job.type.js';

jest.mock('fs', () => ({ unlink: jest.fn((_path, cb) => cb(null)) }));

function makeJob(data: MetaUploadJobPayload): Job<MetaUploadJobPayload> {
  return { data, id: 'job-1', opts: {} } as unknown as Job<MetaUploadJobPayload>;
}

const PAYLOAD: MetaUploadJobPayload = {
  logId: 'log-uuid',
  driveFileId: 'drive-file-id',
  adAccountId: 'act_123',
  encryptedAccessToken: 'enc_token',
  mimeType: 'video/mp4',
  mediaName: 'PRD - VID - Nike - Ago 26 - V1.mp4',
};

describe('MetaUploadProcessor', () => {
  let processor: MetaUploadProcessor;
  let logsRepo: { update: jest.Mock };
  let meta: jest.Mocked<MetaMediaService>;
  let drive: jest.Mocked<GoogleDriveService>;
  let crypto: jest.Mocked<AesCryptoService>;

  beforeEach(async () => {
    logsRepo = { update: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        MetaUploadProcessor,
        { provide: getRepositoryToken(MediaUploadLog), useValue: logsRepo },
        { provide: MetaMediaService, useValue: { upload: jest.fn() } },
        { provide: GoogleDriveService, useValue: { download: jest.fn() } },
        { provide: AesCryptoService, useValue: { decrypt: jest.fn().mockReturnValue('plain_token') } },
      ],
    }).compile();

    processor = module.get(MetaUploadProcessor);
    meta = module.get(MetaMediaService) as jest.Mocked<MetaMediaService>;
    drive = module.get(GoogleDriveService) as jest.Mocked<GoogleDriveService>;
    crypto = module.get(AesCryptoService) as jest.Mocked<AesCryptoService>;
  });

  afterEach(() => jest.clearAllMocks());

  it('downloads from Drive, uploads to Meta, and marks log SUCCESS', async () => {
    drive.download.mockResolvedValue(undefined);
    meta.upload.mockResolvedValue('meta-asset-id');

    await processor.process(makeJob(PAYLOAD));

    expect(crypto.decrypt).toHaveBeenCalledWith('enc_token');
    expect(drive.download).toHaveBeenCalledWith('drive-file-id', expect.stringContaining(os.tmpdir()));
    expect(meta.upload).toHaveBeenCalledWith(
      'act_123',
      'plain_token',
      expect.any(String),
      'PRD - VID - Nike - Ago 26 - V1.mp4',
      'video/mp4',
    );
    expect(logsRepo.update).toHaveBeenCalledWith('log-uuid', {
      status: MediaUploadStatus.SUCCESS,
      metaAssetId: 'meta-asset-id',
      errorMessage: null,
    });
  });

  it('marks log FAILED when Meta upload throws, without rethrowing', async () => {
    drive.download.mockResolvedValue(undefined);
    meta.upload.mockRejectedValue(new Error('token expirado'));

    await expect(processor.process(makeJob(PAYLOAD))).resolves.toBeUndefined();

    expect(logsRepo.update).toHaveBeenCalledWith('log-uuid', {
      status: MediaUploadStatus.FAILED,
      errorMessage: expect.stringContaining('token expirado'),
    });
  });

  it('marks log FAILED when Drive download throws, without rethrowing', async () => {
    drive.download.mockRejectedValue(new Error('Drive API error'));

    await expect(processor.process(makeJob(PAYLOAD))).resolves.toBeUndefined();

    expect(logsRepo.update).toHaveBeenCalledWith('log-uuid', {
      status: MediaUploadStatus.FAILED,
      errorMessage: expect.stringContaining('Drive API error'),
    });
  });

  it('always unlinks the temp file even on failure', async () => {
    drive.download.mockResolvedValue(undefined);
    meta.upload.mockRejectedValue(new Error('error'));

    await processor.process(makeJob(PAYLOAD));

    expect(fs.unlink).toHaveBeenCalled();
  });
});
