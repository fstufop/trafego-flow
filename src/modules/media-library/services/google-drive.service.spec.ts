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
        get: jest.fn(),
      },
    }),
  },
}));

jest.mock('fs', () => ({
  createReadStream: jest.fn(() => 'stream'),
  createWriteStream: jest.fn(),
}));

import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { PassThrough } from 'stream';

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

  describe('download', () => {
    it('fetches file from Drive via alt=media and pipes to destPath', async () => {
      const svc = makeSvc();
      const driveInstance = google.drive({} as any) as any;

      const readable = new PassThrough();
      const writable = new PassThrough();

      (driveInstance.files.get as jest.Mock).mockResolvedValue({ data: readable });
      (fs.createWriteStream as jest.Mock).mockReturnValue(writable);

      const downloadPromise = svc.download('file-abc', '/tmp/output.mp4');
      readable.end();
      await downloadPromise;

      expect(driveInstance.files.get).toHaveBeenCalledWith(
        { fileId: 'file-abc', alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' },
      );
      expect(fs.createWriteStream).toHaveBeenCalledWith('/tmp/output.mp4');
    });

    it('rejects when the stream emits an error', async () => {
      const svc = makeSvc();
      const driveInstance = google.drive({} as any) as any;

      const readable = new PassThrough();
      const writable = new PassThrough();

      (driveInstance.files.get as jest.Mock).mockResolvedValue({ data: readable });
      (fs.createWriteStream as jest.Mock).mockReturnValue(writable);

      const downloadPromise = svc.download('file-abc', '/tmp/output.mp4');
      writable.emit('error', new Error('disk full'));

      await expect(downloadPromise).rejects.toThrow('disk full');
    });
  });
});
