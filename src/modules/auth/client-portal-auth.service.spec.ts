import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ClientPortalAuthService } from './client-portal-auth.service.js';
import { ClientPortalUserEntity } from './entities/client-portal-user.entity.js';
import { MailService } from '../mail/mail.service.js';

describe('ClientPortalAuthService', () => {
  let service: ClientPortalAuthService;

  const mockRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const mockMailService = {
    send: jest.fn().mockResolvedValue(undefined),
  };
  const mockConfig = {
    get: jest.fn().mockReturnValue('https://portal.example.com'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockMailService.send.mockResolvedValue(undefined);
    mockConfig.get.mockReturnValue('https://portal.example.com');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientPortalAuthService,
        {
          provide: getRepositoryToken(ClientPortalUserEntity),
          useValue: mockRepo,
        },
        { provide: MailService, useValue: mockMailService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<ClientPortalAuthService>(ClientPortalAuthService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('createAccount', () => {
    it('creates the account with a null passwordHash and sends an invite email', async () => {
      mockRepo.create.mockReturnValue({
        id: 'new-id',
        email: 'client@x.com',
        clientId: 'c1',
      });
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.createAccount({
        clientId: 'c1',
        email: 'client@x.com',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'c1',
          email: 'client@x.com',
          passwordHash: null,
        }),
      );
      expect(mockMailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'client@x.com' }),
      );
      expect(result.email).toBe('client@x.com');
    });

    it('throws ConflictException when the email is already registered', async () => {
      mockRepo.save.mockRejectedValue(
        Object.assign(new QueryFailedError('', [], new Error()), {
          code: '23505',
        }),
      );
      await expect(
        service.createAccount({ clientId: 'c1', email: 'dup@x.com' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('resendInvite', () => {
    it('generates a new token and resends the invite email', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'u1',
        email: 'client@x.com',
        isActive: true,
      });
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.resendInvite('u1');

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          passwordResetTokenHash: expect.any(String) as unknown,
        }),
      );
      expect(mockMailService.send).toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown id', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.resendInvite('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByClient', () => {
    it('returns the portal user for that client, or null if none exists', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.findByClient('c1')).resolves.toBeNull();
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { clientId: 'c1' },
      });
    });
  });

  describe('setActive', () => {
    it('flips isActive and persists it', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'u1', isActive: true });
      mockRepo.save.mockImplementation((e) => Promise.resolve(e));
      const result = await service.setActive('u1', false);
      expect(result.isActive).toBe(false);
    });

    it('throws NotFoundException for an unknown id', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.setActive('missing', false)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
