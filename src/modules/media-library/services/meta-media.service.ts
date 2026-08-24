import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';

const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime']);

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
    const isVideo = VIDEO_MIME.has(mimeType);
    const endpoint = isVideo ? 'advideos' : 'adimages';
    const url = `${this.graphUrl}/${adAccountId}/${endpoint}`;

    const fileBuffer = await fs.promises.readFile(filePath);
    const blob = new Blob([fileBuffer], { type: mimeType });

    const form = new FormData();
    form.append('access_token', accessToken);
    form.append(isVideo ? 'source' : 'filename', blob, fileName);

    const response = await axios.post(url, form);

    if (isVideo) {
      return response.data.id as string;
    }

    // adimages response: { images: { <filename>: { hash, url } } }
    const images = response.data.images as Record<string, { hash: string }>;
    const entry = Object.values(images)[0];
    return entry.hash;
  }
}
