import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);
  private readonly drive;

  constructor(private readonly config: ConfigService) {
    const auth = new google.auth.OAuth2(
      config.get<string>('google.clientId'),
      config.get<string>('google.clientSecret'),
    );
    auth.setCredentials({ refresh_token: config.get<string>('google.refreshToken') });
    this.drive = google.drive({ version: 'v3', auth });
  }

  extractFolderId(folderUrl: string): string {
    // Accepts both /folders/<id> and ?id=<id> formats
    const folderMatch = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) return folderMatch[1];
    const idMatch = folderUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch) return idMatch[1];
    throw new Error(`Cannot extract folderId from URL: ${folderUrl}`);
  }

  async upload(
    folderUrl: string,
    filePath: string,
    fileName: string,
    mimeType: string,
  ): Promise<{ fileId: string; webViewLink: string }> {
    const folderId = this.extractFolderId(folderUrl);

    const response = await this.drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
        mimeType,
      },
      media: {
        mimeType,
        body: fs.createReadStream(filePath),
      },
      fields: 'id,webViewLink',
      supportsAllDrives: true,
    });

    return {
      fileId: response.data.id!,
      webViewLink: response.data.webViewLink!,
    };
  }

  async download(fileId: string, destPath: string): Promise<void> {
    const dest = fs.createWriteStream(destPath);
    return new Promise<void>(async (resolve, reject) => {
      dest.on('error', reject);
      try {
        const response = await this.drive.files.get(
          { fileId, alt: 'media', supportsAllDrives: true },
          { responseType: 'stream' },
        );
        (response.data as NodeJS.ReadableStream).pipe(dest).on('finish', resolve);
      } catch (err) {
        reject(err);
      }
    });
  }
}
