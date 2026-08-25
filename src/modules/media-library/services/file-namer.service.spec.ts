import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileNamerService } from './file-namer.service.js';
import { MediaUploadLog } from '../entities/media-upload-log.entity.js';
import { MediaIntention } from '../dto/upload-media.dto.js';

const DATE = new Date(2026, 7, 1); // August 2026

function makeModule(countReturn: number) {
  return Test.createTestingModule({
    providers: [
      FileNamerService,
      {
        provide: getRepositoryToken(MediaUploadLog),
        useValue: { count: jest.fn().mockResolvedValue(countReturn) },
      },
    ],
  }).compile();
}

describe('FileNamerService.generateName', () => {
  it('generates name without version when no existing logs today', async () => {
    const module = await makeModule(0);
    const svc = module.get(FileNamerService);
    const name = await svc.generateName({ originalname: 'photo.jpg' }, MediaIntention.PRD, 'Produto X', 'client-1', DATE);
    expect(name).toBe('PRD - IMG - Produto X - Ago 26.jpg');
  });

  it('adds -V2 when one existing log found today', async () => {
    const module = await makeModule(1);
    const svc = module.get(FileNamerService);
    const name = await svc.generateName({ originalname: 'photo.jpg' }, MediaIntention.PRD, 'Produto X', 'client-1', DATE);
    expect(name).toBe('PRD - IMG - Produto X - Ago 26 - V2.jpg');
  });

  it('adds -V3 when two existing logs found today', async () => {
    const module = await makeModule(2);
    const svc = module.get(FileNamerService);
    const name = await svc.generateName({ originalname: 'photo.jpg' }, MediaIntention.PRD, 'Produto X', 'client-1', DATE);
    expect(name).toBe('PRD - IMG - Produto X - Ago 26 - V3.jpg');
  });

  it('uses startVersion as absolute version, ignoring DB count', async () => {
    const module = await makeModule(0);
    const svc = module.get(FileNamerService);
    const name = await svc.generateName({ originalname: 'photo.jpg' }, MediaIntention.PRD, 'Produto X', 'client-1', DATE, 5);
    expect(name).toBe('PRD - IMG - Produto X - Ago 26 - V5.jpg');
  });

  it('detects .mov as VID', async () => {
    const module = await makeModule(0);
    const svc = module.get(FileNamerService);
    const name = await svc.generateName({ originalname: 'video.mov' }, MediaIntention.PRD, 'Prod', 'client-1', DATE);
    expect(name).toContain('VID');
  });

  it('strips accents and special chars from product name', async () => {
    const module = await makeModule(0);
    const svc = module.get(FileNamerService);
    const name = await svc.generateName({ originalname: 'f.jpg' }, MediaIntention.PRD, 'Ação & Reação!', 'client-1', DATE);
    expect(name).toBe('PRD - IMG - Acao  Reacao - Ago 26.jpg');
  });

  it('queries DB with correct clientId and base name prefix', async () => {
    const module = await makeModule(0);
    const svc = module.get(FileNamerService);
    const repo = module.get<Repository<MediaUploadLog>>(getRepositoryToken(MediaUploadLog));
    await svc.generateName({ originalname: 'photo.jpg' }, MediaIntention.PRD, 'Nike', 'client-42', DATE);
    expect(repo.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client-42',
        }),
      }),
    );
  });
});
