import { FileNamerService } from './file-namer.service.js';
import { MediaIntention } from '../dto/upload-media.dto.js';

describe('FileNamerService', () => {
  const svc = new FileNamerService();
  const date = new Date(2026, 7, 1); // August 2026

  it('formats PRD image correctly', () => {
    const [name] = svc.generateNames([{ originalname: 'photo.jpg' }], MediaIntention.PRD, 'Produto X', date);
    expect(name).toBe('PRD - IMG - Produto X - Ago 26.jpg');
  });

  it('formats CAP video correctly', () => {
    const [name] = svc.generateNames([{ originalname: 'clip.mp4' }], MediaIntention.CAP, 'Oferta', date);
    expect(name).toBe('CAP - VID - Oferta - Ago 26.mp4');
  });

  it('detects .mov as VID', () => {
    const [name] = svc.generateNames([{ originalname: 'video.mov' }], MediaIntention.PRD, 'Prod', date);
    expect(name).toContain('VID');
  });

  it('detects .png as IMG', () => {
    const [name] = svc.generateNames([{ originalname: 'banner.png' }], MediaIntention.PRD, 'Prod', date);
    expect(name).toContain('IMG');
  });

  it('adds V1/V2 versioning when multiple files share the same base', () => {
    const names = svc.generateNames(
      [{ originalname: 'a.jpg' }, { originalname: 'b.jpg' }],
      MediaIntention.PRD,
      'Produto',
      date,
    );
    expect(names[0]).toBe('PRD - IMG - Produto - Ago 26 - V1.jpg');
    expect(names[1]).toBe('PRD - IMG - Produto - Ago 26 - V2.jpg');
  });

  it('does not add version when only one file has a given base', () => {
    const names = svc.generateNames(
      [{ originalname: 'photo.jpg' }, { originalname: 'clip.mp4' }],
      MediaIntention.PRD,
      'Produto',
      date,
    );
    expect(names[0]).toBe('PRD - IMG - Produto - Ago 26.jpg');
    expect(names[1]).toBe('PRD - VID - Produto - Ago 26.mp4');
  });

  it('strips accents and special characters from product name', () => {
    const [name] = svc.generateNames([{ originalname: 'f.jpg' }], MediaIntention.PRD, 'Ação & Reação!', date);
    expect(name).toBe('PRD - IMG - Acao  Reacao - Ago 26.jpg');
  });
});
