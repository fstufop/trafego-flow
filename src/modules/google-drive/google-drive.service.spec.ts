import { GoogleDriveService } from './google-drive.service.js';

// Mock googleapis before importing the service
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockReturnValue({
        setCredentials: jest.fn(),
        request: jest.fn(),
      }),
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
  const config = {
    get: jest.fn().mockReturnValue('val'),
  } as unknown as ConfigService;
  return new GoogleDriveService(config);
}

describe('GoogleDriveService', () => {
  describe('extractFolderId', () => {
    it('extracts from /folders/<id> URL', () => {
      const svc = makeSvc();
      expect(
        svc.extractFolderId(
          'https://drive.google.com/drive/folders/1ABC_def-XYZ',
        ),
      ).toBe('1ABC_def-XYZ');
    });

    it('extracts from ?id=<id> URL', () => {
      const svc = makeSvc();
      expect(
        svc.extractFolderId('https://drive.google.com/open?id=1ABC_def-XYZ'),
      ).toBe('1ABC_def-XYZ');
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
      const mockCreate = (
        driveInstance.files.create as jest.Mock
      ).mockResolvedValue({
        data: {
          id: 'file123',
          webViewLink: 'https://drive.google.com/file/d/file123',
        },
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
      expect(result).toEqual({
        fileId: 'file123',
        webViewLink: 'https://drive.google.com/file/d/file123',
      });
    });
  });

  describe('createResumableUploadSession', () => {
    it('posts metadata to the Drive resumable endpoint and returns the Location header as the session URL', async () => {
      const svc = makeSvc();
      const authInstance = google.auth.OAuth2({} as any) as any;
      // google-auth-library's `request()` returns response.headers as a native
      // Fetch API Headers object (requires .get(), not bracket access) — see
      // the real shape confirmed against the live Drive API before this fix.
      (authInstance.request as jest.Mock).mockResolvedValue({
        headers: new Headers({
          location:
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=XYZ',
        }),
      });

      const url = await svc.createResumableUploadSession(
        'https://drive.google.com/drive/folders/folder456',
        'video.mp4',
        'video/mp4',
      );

      expect(authInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: expect.stringContaining('uploadType=resumable'),
          data: expect.objectContaining({
            name: 'video.mp4',
            parents: ['folder456'],
            mimeType: 'video/mp4',
          }),
          headers: expect.objectContaining({
            'X-Upload-Content-Type': 'video/mp4',
            Origin: 'val',
          }),
        }),
      );
      // Without `fields=id,webViewLink` on the initiation URL, Drive's final
      // completion response (after the browser PUTs the bytes) omits
      // webViewLink entirely — confirmed against the live API.
      const initiationUrl = (authInstance.request as jest.Mock).mock.calls.at(-1)[0].url as string;
      expect(initiationUrl).toContain('fields=id,webViewLink');
      expect(url).toBe(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=XYZ',
      );
    });

    it('omits the Origin header when no dashboard origin is configured', async () => {
      const config = {
        get: jest.fn().mockReturnValue(undefined),
      } as unknown as ConfigService;
      const svc = new GoogleDriveService(config);
      const authInstance = google.auth.OAuth2({} as any) as any;
      (authInstance.request as jest.Mock).mockResolvedValue({
        headers: new Headers({ location: 'https://example.com/session' }),
      });

      await svc.createResumableUploadSession(
        'https://drive.google.com/drive/folders/folder456',
        'video.mp4',
        'video/mp4',
      );

      const calls = (authInstance.request as jest.Mock).mock.calls;
      const call = calls[calls.length - 1][0];
      expect(call.headers).not.toHaveProperty('Origin');
    });

    it('throws when Drive does not return a Location header', async () => {
      const svc = makeSvc();
      const authInstance = google.auth.OAuth2({} as any) as any;
      (authInstance.request as jest.Mock).mockResolvedValue({
        headers: new Headers(),
      });

      await expect(
        svc.createResumableUploadSession(
          'https://drive.google.com/drive/folders/folder456',
          'video.mp4',
          'video/mp4',
        ),
      ).rejects.toThrow();
    });

    it('propagates the error when the Drive request itself fails', async () => {
      const svc = makeSvc();
      const authInstance = google.auth.OAuth2({} as any) as any;
      (authInstance.request as jest.Mock).mockRejectedValue(
        new Error('network down'),
      );

      await expect(
        svc.createResumableUploadSession(
          'https://drive.google.com/drive/folders/folder456',
          'video.mp4',
          'video/mp4',
        ),
      ).rejects.toThrow('network down');
    });
  });

  describe('getFileSize', () => {
    it('fetches the file size field and returns it as a number', async () => {
      const svc = makeSvc();
      const driveInstance = google.drive({} as any) as any;
      (driveInstance.files.get as jest.Mock).mockResolvedValue({
        data: { size: '104857600' },
      });

      const size = await svc.getFileSize('file-abc');

      expect(driveInstance.files.get).toHaveBeenCalledWith({
        fileId: 'file-abc',
        fields: 'size',
        supportsAllDrives: true,
      });
      expect(size).toBe(104857600);
    });
  });

  describe('createFolder', () => {
    it('creates a folder under driveRootFolderId and returns its webViewLink', async () => {
      const svc = makeSvc();
      const driveInstance = google.drive({} as any) as any;
      (driveInstance.files.create as jest.Mock).mockResolvedValue({
        data: {
          webViewLink: 'https://drive.google.com/drive/folders/newFolder123',
        },
      });

      const url = await svc.createFolder('Cliente ABC');

      expect(driveInstance.files.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            name: 'Cliente ABC',
            mimeType: 'application/vnd.google-apps.folder',
            parents: ['val'],
          }),
        }),
      );
      expect(url).toBe('https://drive.google.com/drive/folders/newFolder123');
    });
  });

  describe('download', () => {
    it('fetches file from Drive via alt=media and pipes to destPath', async () => {
      const svc = makeSvc();
      const driveInstance = google.drive({} as any) as any;

      const readable = new PassThrough();
      const writable = new PassThrough();

      (driveInstance.files.get as jest.Mock).mockResolvedValue({
        data: readable,
      });
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

      (driveInstance.files.get as jest.Mock).mockResolvedValue({
        data: readable,
      });
      (fs.createWriteStream as jest.Mock).mockReturnValue(writable);

      const downloadPromise = svc.download('file-abc', '/tmp/output.mp4');
      // Emit after microtasks so the Promise callback has wired up the error listener
      await Promise.resolve();
      writable.emit('error', new Error('disk full'));

      await expect(downloadPromise).rejects.toThrow('disk full');
    });

    it('rejects when source stream emits an error', async () => {
      const svc = makeSvc();
      const driveInstance = google.drive({} as any) as any;

      const mockSource = new PassThrough();
      const mockDest = new PassThrough();

      (driveInstance.files.get as jest.Mock).mockResolvedValue({
        data: mockSource,
      });
      (fs.createWriteStream as jest.Mock).mockReturnValue(mockDest);

      const promise = svc.download('file-id', '/tmp/test-output');
      // Emit after microtasks so the Promise callback has wired up the error listener
      await Promise.resolve();
      mockSource.emit('error', new Error('network failure'));
      await expect(promise).rejects.toThrow('network failure');
    });
  });
});
