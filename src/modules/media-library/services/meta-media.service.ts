import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';

const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime']);

// Meta single-part upload limit for videos (~100 MB); above this, use chunked upload
const VIDEO_CHUNKED_THRESHOLD_BYTES = 100 * 1024 * 1024;
const CHUNK_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per chunk

@Injectable()
export class MetaMediaService {
  private readonly graphUrl: string;

  constructor(config: ConfigService) {
    const base = config.get<string>('meta.graphApiUrl') ?? 'https://graph.facebook.com';
    const version = config.get<string>('meta.graphApiVersion') ?? 'v21.0';
    this.graphUrl = `${base}/${version}`;
  }

  async upload(
    adAccountId: string,
    accessToken: string,
    filePath: string,
    fileName: string,
    mimeType: string,
  ): Promise<string> {
    if (VIDEO_MIME.has(mimeType)) {
      return this.uploadVideo(adAccountId, accessToken, filePath, fileName, mimeType);
    }
    return this.uploadImage(adAccountId, accessToken, filePath, fileName, mimeType);
  }

  private async uploadImage(
    adAccountId: string,
    accessToken: string,
    filePath: string,
    fileName: string,
    mimeType: string,
  ): Promise<string> {
    const url = `${this.graphUrl}/${adAccountId}/adimages`;
    const fileBuffer = await fs.promises.readFile(filePath);
    const blob = new Blob([fileBuffer], { type: mimeType });

    const form = new FormData();
    form.append('access_token', accessToken);
    form.append('filename', blob, fileName);

    const response = await axios.post(url, form);
    const images = response.data.images as Record<string, { hash: string }>;
    return Object.values(images)[0].hash;
  }

  private async uploadVideo(
    adAccountId: string,
    accessToken: string,
    filePath: string,
    fileName: string,
    mimeType: string,
  ): Promise<string> {
    const stat = await fs.promises.stat(filePath);
    const fileSize = stat.size;

    if (fileSize <= VIDEO_CHUNKED_THRESHOLD_BYTES) {
      return this.uploadVideoSinglePart(adAccountId, accessToken, filePath, fileName, mimeType);
    }
    return this.uploadVideoChunked(adAccountId, accessToken, filePath, fileName, fileSize);
  }

  private async uploadVideoSinglePart(
    adAccountId: string,
    accessToken: string,
    filePath: string,
    fileName: string,
    mimeType: string,
  ): Promise<string> {
    const url = `${this.graphUrl}/${adAccountId}/advideos`;
    const fileBuffer = await fs.promises.readFile(filePath);
    const blob = new Blob([fileBuffer], { type: mimeType });

    const form = new FormData();
    form.append('access_token', accessToken);
    form.append('source', blob, fileName);

    const response = await axios.post(url, form);
    return response.data.id as string;
  }

  private async uploadVideoChunked(
    adAccountId: string,
    accessToken: string,
    filePath: string,
    fileName: string,
    fileSize: number,
  ): Promise<string> {
    const baseUrl = `${this.graphUrl}/${adAccountId}/advideos`;

    // Phase 1: start upload session
    const startForm = new FormData();
    startForm.append('access_token', accessToken);
    startForm.append('upload_phase', 'start');
    startForm.append('file_size', String(fileSize));
    const startRes = await axios.post(baseUrl, startForm);
    const { upload_session_id: sessionId, video_id: videoId, start_offset: startOffsetStr } = startRes.data;

    // Phase 2: transfer chunks
    const fileHandle = await fs.promises.open(filePath, 'r');
    try {
      let startOffset = parseInt(startOffsetStr, 10);

      while (startOffset < fileSize) {
        const chunkSize = Math.min(CHUNK_SIZE_BYTES, fileSize - startOffset);
        const chunk = Buffer.alloc(chunkSize);
        await fileHandle.read(chunk, 0, chunkSize, startOffset);

        const chunkForm = new FormData();
        chunkForm.append('access_token', accessToken);
        chunkForm.append('upload_phase', 'transfer');
        chunkForm.append('upload_session_id', sessionId);
        chunkForm.append('start_offset', String(startOffset));
        chunkForm.append('video_file_chunk', new Blob([chunk]), fileName);

        const transferRes = await axios.post(baseUrl, chunkForm);
        startOffset = parseInt(transferRes.data.start_offset, 10);
      }
    } finally {
      await fileHandle.close();
    }

    // Phase 3: finish
    const finishForm = new FormData();
    finishForm.append('access_token', accessToken);
    finishForm.append('upload_phase', 'finish');
    finishForm.append('upload_session_id', sessionId);
    finishForm.append('title', fileName);
    await axios.post(baseUrl, finishForm);

    return videoId as string;
  }
}
