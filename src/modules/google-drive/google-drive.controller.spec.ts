import { ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { GoogleDriveController } from './google-drive.controller.js';
import { GoogleDriveService } from './google-drive.service.js';

describe('GoogleDriveController', () => {
  let controller: GoogleDriveController;
  let driveService: { createFolder: jest.Mock };

  beforeEach(async () => {
    driveService = { createFolder: jest.fn() };
    const module = await Test.createTestingModule({
      controllers: [GoogleDriveController],
      providers: [{ provide: GoogleDriveService, useValue: driveService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: (_ctx: ExecutionContext) => true })
      .compile();

    controller = module.get(GoogleDriveController);
  });

  it('returns folderUrl from GoogleDriveService.createFolder', async () => {
    driveService.createFolder.mockResolvedValue('https://drive.google.com/drive/folders/abc123');

    const result = await controller.createFolder({ name: 'Cliente Teste' });

    expect(driveService.createFolder).toHaveBeenCalledWith('Cliente Teste');
    expect(result).toEqual({ folderUrl: 'https://drive.google.com/drive/folders/abc123' });
  });
});
