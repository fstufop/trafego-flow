import { GoogleDriveService } from './google-drive.service.js';

// Mock googleapis before importing the service
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
      })),
    },
    drive: jest.fn().mockReturnValue({
      files: {
        create: jest.fn(),
      },
    }),
  },
}));

jest.mock('fs', () => ({ createReadStream: jest.fn(() => 'stream') }));

import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';

function makeSvc() {
  const config = { get: jest.fn().mockReturnValue('val') } as unknown as ConfigService;
  return new GoogleDriveService(config);
}

describe('GoogleDriveService', () => {
  describe('extractFolderId', () => {
    it('extracts from /folders/<id> URL', () => {
      const svc = makeSvc();
      expect(svc.extractFolderId('https://drive.google.com/drive/folders/1ABC_def-XYZ')).toBe('1ABC_def-XYZ');
    });

    it('extracts from ?id=<id> URL', () => {
      const svc = makeSvc();
      expect(svc.extractFolderId('https://drive.google.com/open?id=1ABC_def-XYZ')).toBe('1ABC_def-XYZ');
    });

    it('throws on unrecognized URL format', () => {
      const svc = makeSvc();
      expect(() => svc.extractFolderId('https://example.com/foo')).toThrow();
    });
  });

  describe('upload', () => {
    it('calls drive.files.create with correct folderId and returns fileId and webViewLink', async () => {
      const svc = makeSvc();
      const driveInstance = google.drive({} as any) as any;
    const mockCreate = (driveInstance.files.create as jest.Mock).mockResolvedValue({
        data: { id: 'file123', webViewLink: 'https://drive.google.com/file/d/file123' },
      });

      const result = await svc.upload(
        'https://drive.google.com/drive/folders/folder456',
        '/tmp/photo.jpg',
        'photo.jpg',
        'image/jpeg',
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({ parents: ['folder456'] }),
        }),
      );
      expect(result).toEqual({ fileId: 'file123', webViewLink: 'https://drive.google.com/file/d/file123' });
    });
  });
});
