import { Test } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { MediaLibraryService } from './media-library.service.js';
import { AdAccountsService } from '../ad-accounts/ad-accounts.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { FileNamerService } from './services/file-namer.service.js';
import { GoogleDriveService } from './services/google-drive.service.js';
import { MetaMediaService } from './services/meta-media.service.js';
import { MediaIntention } from './dto/upload-media.dto.js';

const mockAdAccount = (clientId = 'client-1') => ({
  id: 'aa-1',
  clientId,
  adAccountId: 'act_123',
  accessToken: 'encrypted',
});

const mockClient = (folderUrl: string | null = 'https://drive.google.com/drive/folders/folder1') => ({
  id: 'client-1',
  googleDriveFolderUrl: folderUrl,
});

const mockFile = (name = 'photo.jpg', mime = 'image/jpeg'): Express.Multer.File =>
  ({ originalname: name, path: `/tmp/${name}`, mimetype: mime } as Express.Multer.File);

describe('MediaLibraryService', () => {
  let svc: MediaLibraryService;
  let adAccounts: jest.Mocked<AdAccountsService>;
  let clients: jest.Mocked<ClientsService>;
  let crypto: jest.Mocked<AesCryptoService>;
  let fileNamer: jest.Mocked<FileNamerService>;
  let drive: jest.Mocked<GoogleDriveService>;
  let meta: jest.Mocked<MetaMediaService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MediaLibraryService,
        { provide: AdAccountsService, useValue: { findByAdAccountId: jest.fn() } },
        { provide: ClientsService, useValue: { findOne: jest.fn() } },
        { provide: AesCryptoService, useValue: { decrypt: jest.fn().mockReturnValue('plain_token') } },
        { provide: FileNamerService, useValue: { generateNames: jest.fn() } },
        { provide: GoogleDriveService, useValue: { upload: jest.fn() } },
        { provide: MetaMediaService, useValue: { upload: jest.fn() } },
      ],
    }).compile();

    svc = module.get(MediaLibraryService);
    adAccounts = module.get(AdAccountsService) as jest.Mocked<AdAccountsService>;
    clients = module.get(ClientsService) as jest.Mocked<ClientsService>;
    crypto = module.get(AesCryptoService) as jest.Mocked<AesCryptoService>;
    fileNamer = module.get(FileNamerService) as jest.Mocked<FileNamerService>;
    drive = module.get(GoogleDriveService) as jest.Mocked<GoogleDriveService>;
    meta = module.get(MetaMediaService) as jest.Mocked<MetaMediaService>;
  });

  const dto = {
    adAccountId: 'act_123',
    clientId: 'client-1',
    intention: MediaIntention.PRD,
    productName: 'Produto',
  };

  it('returns partial result when Drive succeeds but Meta fails', async () => {
    adAccounts.findByAdAccountId.mockResolvedValue(mockAdAccount() as any);
    clients.findOne.mockResolvedValue(mockClient() as any);
    fileNamer.generateNames.mockReturnValue(['PRD - IMG - Produto - Ago 26.jpg']);
    drive.upload.mockResolvedValue({ fileId: 'drv1', webViewLink: 'https://drive.google.com/file/d/drv1' });
    meta.upload.mockRejectedValue(new Error('token expirado'));

    const results = await svc.upload(dto, [mockFile()]);

    expect(results).toHaveLength(1);
    expect(results[0].driveFileId).toBe('drv1');
    expect(results[0].metaAssetId).toBeUndefined();
    expect(results[0].errors).toEqual([{ destination: 'meta', message: 'Error: token expirado' }]);
  });

  it('returns full result when both destinations succeed', async () => {
    adAccounts.findByAdAccountId.mockResolvedValue(mockAdAccount() as any);
    clients.findOne.mockResolvedValue(mockClient() as any);
    fileNamer.generateNames.mockReturnValue(['PRD - IMG - Produto - Ago 26.jpg']);
    drive.upload.mockResolvedValue({ fileId: 'drv1', webViewLink: 'https://drive.google.com/file/d/drv1' });
    meta.upload.mockResolvedValue('hash_abc');

    const results = await svc.upload(dto, [mockFile()]);

    expect(results[0].errors).toHaveLength(0);
    expect(results[0].metaAssetId).toBe('hash_abc');
  });

  it('throws 422 when client has no Google Drive folder configured', async () => {
    adAccounts.findByAdAccountId.mockResolvedValue(mockAdAccount() as any);
    clients.findOne.mockResolvedValue(mockClient(null) as any);

    await expect(svc.upload(dto, [mockFile()])).rejects.toThrow(UnprocessableEntityException);
  });
});
