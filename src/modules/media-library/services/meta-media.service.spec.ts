import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MetaMediaService } from './meta-media.service.js';
import axios from 'axios';

jest.mock('axios');
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn().mockResolvedValue(Buffer.from('fake-file-content')),
  },
}));

const mockedAxiosPost = axios.post as jest.Mock;

describe('MetaMediaService', () => {
  let svc: MetaMediaService;

  beforeEach(async () => {
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

    svc = module.get(MetaMediaService);
  });

  it('calls /adimages for JPEG and returns hash', async () => {
    mockedAxiosPost.mockResolvedValue({
      data: { images: { 'photo.jpg': { hash: 'abc123', url: 'https://example.com' } } },
    });

    const result = await svc.upload('act_123', 'token', '/tmp/photo.jpg', 'photo.jpg', 'image/jpeg');

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining('/act_123/adimages'),
      expect.any(FormData),
    );
    expect(result).toBe('abc123');
  });

  it('calls /advideos for MP4 and returns video id', async () => {
    mockedAxiosPost.mockResolvedValue({ data: { id: 'vid_456' } });

    const result = await svc.upload('act_123', 'token', '/tmp/clip.mp4', 'clip.mp4', 'video/mp4');

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining('/act_123/advideos'),
      expect.any(FormData),
    );
    expect(result).toBe('vid_456');
  });

  it('propagates HTTP error from Meta', async () => {
    mockedAxiosPost.mockRejectedValue(new Error('401 Unauthorized'));

    await expect(
      svc.upload('act_123', 'bad_token', '/tmp/f.jpg', 'f.jpg', 'image/jpeg'),
    ).rejects.toThrow('401 Unauthorized');
  });
});
