import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MetaMediaService } from './meta-media.service.js';
import axios from 'axios';
import * as fs from 'fs';

jest.mock('axios');
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn().mockResolvedValue(Buffer.from('fake-file-content')),
    stat: jest.fn().mockResolvedValue({ size: 1024 }),
    open: jest.fn().mockResolvedValue({
      read: jest.fn().mockImplementation((_buf: Buffer, _off: number, len: number) =>
        Promise.resolve({ bytesRead: len }),
      ),
      close: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

const mockedAxiosPost = axios.post as jest.Mock;
const mockedStat = fs.promises.stat as jest.Mock;
const mockedReadFile = fs.promises.readFile as jest.Mock;

async function makeService(): Promise<MetaMediaService> {
  const module = await Test.createTestingModule({
    providers: [
      MetaMediaService,
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((key: string) => {
            if (key === 'meta.graphApiUrl') return 'https://graph.facebook.com';
            if (key === 'meta.graphApiVersion') return 'v21.0';
            return undefined;
          }),
        },
      },
    ],
  }).compile();
  return module.get(MetaMediaService);
}

describe('MetaMediaService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls /adimages for JPEG and returns hash', async () => {
    mockedStat.mockResolvedValue({ size: 1024 });
    mockedAxiosPost.mockResolvedValue({
      data: { images: { 'photo.jpg': { hash: 'abc123' } } },
    });

    const svc = await makeService();
    const result = await svc.upload('act_123', 'token', '/tmp/photo.jpg', 'photo.jpg', 'image/jpeg');

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining('/act_123/adimages'),
      expect.any(FormData),
    );
    expect(result).toBe('abc123');
  });

  it('calls /advideos single-part for small MP4 and returns video id', async () => {
    mockedStat.mockResolvedValue({ size: 1024 });
    mockedAxiosPost.mockResolvedValue({ data: { id: 'vid_456' } });

    const svc = await makeService();
    const result = await svc.upload('act_123', 'token', '/tmp/clip.mp4', 'clip.mp4', 'video/mp4');

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining('/act_123/advideos'),
      expect.any(FormData),
    );
    expect(result).toBe('vid_456');
  });

  it('uses chunked upload for large video (>100 MB) and returns video_id', async () => {
    mockedStat.mockResolvedValue({ size: 110 * 1024 * 1024 });

    mockedAxiosPost
      .mockResolvedValueOnce({ data: { upload_session_id: 'sess1', video_id: 'vid_chunked', start_offset: '0' } })
      .mockResolvedValueOnce({ data: { start_offset: String(110 * 1024 * 1024) } }) // single chunk covers all
      .mockResolvedValueOnce({ data: {} }); // finish

    const svc = await makeService();
    const result = await svc.upload('act_123', 'token', '/tmp/big.mp4', 'big.mp4', 'video/mp4');

    expect(mockedAxiosPost).toHaveBeenCalledTimes(3); // start + transfer + finish
    expect(result).toBe('vid_chunked');
  });

  it('propagates HTTP error from Meta', async () => {
    mockedStat.mockResolvedValue({ size: 1024 });
    mockedAxiosPost.mockRejectedValue(new Error('401 Unauthorized'));

    const svc = await makeService();
    await expect(
      svc.upload('act_123', 'bad_token', '/tmp/f.jpg', 'f.jpg', 'image/jpeg'),
    ).rejects.toThrow('401 Unauthorized');
  });
});
