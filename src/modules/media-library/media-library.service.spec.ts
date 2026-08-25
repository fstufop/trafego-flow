import { Test } from '@nestjs/testing';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { MediaLibraryService } from './media-library.service.js';
import { MediaUploadLog } from './entities/media-upload-log.entity.js';
import { MediaUploadStatus } from './enums/media-upload-status.enum.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { FileNamerService } from './services/file-namer.service.js';
import { GoogleDriveService } from './services/google-drive.service.js';
import { MediaIntention } from './dto/upload-media.dto.js';

const MOCK_AD_ACCOUNT = { id: 'aa-1', clientId: 'client-1', adAccountId: 'act_123', accessToken: 'enc_tok' };
const MOCK_CLIENT = { id: 'client-1', googleDriveFolderUrl: 'https://drive.google.com/drive/folders/folder1' };
const MOCK_FILE = { originalname: 'video.mp4', path: '/tmp/video.mp4', mimetype: 'video/mp4' } as Express.Multer.File;
const DTO = { adAccountId: 'act_123', clientId: 'client-1', intention: MediaIntention.PRD, productName: 'Nike' };

describe('MediaLibraryService', () => {
  let svc: MediaLibraryService;
  let adAccounts: jest.Mocked<AdAccountsService>;
  let clients: jest.Mocked<ClientsService>;
  let drive: jest.Mocked<GoogleDriveService>;
  let fileNamer: jest.Mocked<FileNamerService>;
  let logsRepo: { save: jest.Mock; findAndCount: jest.Mock; find: jest.Mock; update: jest.Mock; findOneOrFail: jest.Mock };
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    logsRepo = {
      save: jest.fn(),
      findAndCount: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
      findOneOrFail: jest.fn(),
    };
    queue = { add: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        MediaLibraryService,
        { provide: AdAccountsService, useValue: { findByAdAccountId: jest.fn() } },
        { provide: ClientsService, useValue: { findOne: jest.fn() } },
        { provide: AesCryptoService, useValue: { decrypt: jest.fn() } },
        { provide: FileNamerService, useValue: { generateName: jest.fn() } },
        { provide: GoogleDriveService, useValue: { upload: jest.fn() } },
        { provide: getRepositoryToken(MediaUploadLog), useValue: logsRepo },
        { provide: getQueueToken('media-upload'), useValue: queue },
      ],
    }).compile();

    svc = module.get(MediaLibraryService);
    adAccounts = module.get(AdAccountsService) as jest.Mocked<AdAccountsService>;
    clients = module.get(ClientsService) as jest.Mocked<ClientsService>;
    drive = module.get(GoogleDriveService) as jest.Mocked<GoogleDriveService>;
    fileNamer = module.get(FileNamerService) as jest.Mocked<FileNamerService>;
  });

  afterEach(() => jest.clearAllMocks());

  describe('upload', () => {
    beforeEach(() => {
      adAccounts.findByAdAccountId.mockResolvedValue(MOCK_AD_ACCOUNT as any);
      clients.findOne.mockResolvedValue(MOCK_CLIENT as any);
      fileNamer.generateName.mockResolvedValue('PRD - VID - Nike - Ago 26 - V1.mp4');
      drive.upload.mockResolvedValue({ fileId: 'drv-1', webViewLink: 'https://drive.google.com/file/d/drv-1' });
      logsRepo.save.mockResolvedValue({ id: 'log-uuid', status: MediaUploadStatus.PROCESSING });
    });

    it('returns logId, mediaName, driveUrl and status PROCESSING', async () => {
      const result = await svc.upload(DTO, MOCK_FILE);
      expect(result).toEqual({
        logId: 'log-uuid',
        mediaName: 'PRD - VID - Nike - Ago 26 - V1.mp4',
        driveUrl: 'https://drive.google.com/file/d/drv-1',
        status: MediaUploadStatus.PROCESSING,
      });
    });

    it('enqueues a meta-upload job with driveFileId and encryptedAccessToken', async () => {
      await svc.upload(DTO, MOCK_FILE);
      expect(queue.add).toHaveBeenCalledWith(
        'meta-upload',
        expect.objectContaining({
          driveFileId: 'drv-1',
          encryptedAccessToken: 'enc_tok',
          adAccountId: 'act_123',
        }),
        { attempts: 1 },
      );
    });

    it('throws 422 when client has no Drive folder', async () => {
      clients.findOne.mockResolvedValue({ ...MOCK_CLIENT, googleDriveFolderUrl: null } as any);
      await expect(svc.upload(DTO, MOCK_FILE)).rejects.toThrow(UnprocessableEntityException);
    });

    it('propagates Drive upload error without creating a log', async () => {
      drive.upload.mockRejectedValue(new Error('quota exceeded'));
      await expect(svc.upload(DTO, MOCK_FILE)).rejects.toThrow('quota exceeded');
      expect(logsRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getLogs', () => {
    it('returns paginated logs ordered by createdAt DESC', async () => {
      const mockLog = { id: 'log-1', status: MediaUploadStatus.SUCCESS };
      logsRepo.findAndCount.mockResolvedValue([[mockLog], 1]);
      const result = await svc.getLogs('client-1', 1, 20);
      expect(result).toEqual({ data: [mockLog], total: 1, page: 1, limit: 20 });
    });
  });

  describe('retryOne', () => {
    it('throws 400 when log status is not FAILED', async () => {
      logsRepo.findOneOrFail.mockResolvedValue({ id: 'log-1', status: MediaUploadStatus.PROCESSING });
      await expect(svc.retryOne('log-1')).rejects.toThrow(BadRequestException);
    });

    it('updates log to PROCESSING, increments attemptCount, and enqueues job', async () => {
      const failedLog = {
        id: 'log-1',
        status: MediaUploadStatus.FAILED,
        attemptCount: 1,
        adAccountId: 'act_123',
        driveFileId: 'drv-1',
        mimeType: 'video/mp4',
        mediaName: 'PRD - VID - Nike - Ago 26.mp4',
      };
      logsRepo.findOneOrFail.mockResolvedValue(failedLog);
      adAccounts.findByAdAccountId.mockResolvedValue(MOCK_AD_ACCOUNT as any);
      logsRepo.update.mockResolvedValue(undefined);

      const result = await svc.retryOne('log-1');

      expect(logsRepo.update).toHaveBeenCalledWith('log-1', {
        status: MediaUploadStatus.PROCESSING,
        errorMessage: null,
        attemptCount: 2,
      });
      expect(queue.add).toHaveBeenCalledWith(
        'meta-upload',
        expect.objectContaining({ logId: 'log-1', driveFileId: 'drv-1' }),
        { attempts: 1 },
      );
      expect(result).toEqual({ logId: 'log-1', status: MediaUploadStatus.PROCESSING });
    });
  });

  describe('retryFailed', () => {
    it('returns retried: 0 when no failed logs exist', async () => {
      logsRepo.find.mockResolvedValue([]);
      const result = await svc.retryFailed('client-1');
      expect(result).toEqual({ retried: 0 });
    });

    it('retries all failed logs and returns count', async () => {
      const failedLogs = [
        { id: 'log-1', status: MediaUploadStatus.FAILED, attemptCount: 0, adAccountId: 'act_123', driveFileId: 'drv-1', mimeType: 'video/mp4', mediaName: 'PRD - VID - Nike - Ago 26 - V1.mp4' },
        { id: 'log-2', status: MediaUploadStatus.FAILED, attemptCount: 0, adAccountId: 'act_123', driveFileId: 'drv-2', mimeType: 'image/jpeg', mediaName: 'PRD - IMG - Nike - Ago 26.jpg' },
      ];
      logsRepo.find.mockResolvedValue(failedLogs);
      logsRepo.findOneOrFail.mockImplementation(({ where: { id } }) =>
        Promise.resolve(failedLogs.find(l => l.id === id) as any),
      );
      adAccounts.findByAdAccountId.mockResolvedValue(MOCK_AD_ACCOUNT as any);
      logsRepo.update.mockResolvedValue(undefined);

      const result = await svc.retryFailed('client-1');
      expect(result).toEqual({ retried: 2 });
      expect(queue.add).toHaveBeenCalledTimes(2);
    });

    it('returns partial count when some logs were already retried concurrently', async () => {
      const failedLogs = [
        { id: 'log-1', status: MediaUploadStatus.FAILED, attemptCount: 0, adAccountId: 'act_123', driveFileId: 'drv-1', mimeType: 'video/mp4', mediaName: 'PRD - VID - Nike.mp4' },
        { id: 'log-2', status: MediaUploadStatus.FAILED, attemptCount: 0, adAccountId: 'act_123', driveFileId: 'drv-2', mimeType: 'image/jpeg', mediaName: 'PRD - IMG - Nike.jpg' },
      ];
      logsRepo.find.mockResolvedValue(failedLogs);
      // log-1 was already retried concurrently — now PROCESSING
      logsRepo.findOneOrFail.mockImplementationOnce(() =>
        Promise.resolve({ ...failedLogs[0], status: MediaUploadStatus.PROCESSING }),
      );
      logsRepo.findOneOrFail.mockImplementationOnce(() =>
        Promise.resolve(failedLogs[1] as any),
      );
      adAccounts.findByAdAccountId.mockResolvedValue(MOCK_AD_ACCOUNT as any);
      logsRepo.update.mockResolvedValue(undefined);

      const result = await svc.retryFailed('client-1');
      expect(result).toEqual({ retried: 1 });
    });
  });
});
