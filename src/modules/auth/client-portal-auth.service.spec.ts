import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { ClientPortalAuthService } from './client-portal-auth.service.js';
import { ClientPortalUserEntity } from './entities/client-portal-user.entity.js';
import { MailService } from '../mail/mail.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { JwtService } from '@nestjs/jwt';

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
  const mockClientsService = {
    findOne: jest.fn(),
  };
  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('signed-token'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockMailService.send.mockResolvedValue(undefined);
    mockConfig.get.mockReturnValue('https://portal.example.com');
    mockJwtService.signAsync.mockResolvedValue('signed-token');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientPortalAuthService,
        {
          provide: getRepositoryToken(ClientPortalUserEntity),
          useValue: mockRepo,
        },
        { provide: MailService, useValue: mockMailService },
        { provide: ConfigService, useValue: mockConfig },
        { provide: ClientsService, useValue: mockClientsService },
        { provide: JwtService, useValue: mockJwtService },
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

  describe('login', () => {
    it('rejects when passwordHash is null (invite never accepted)', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        passwordHash: null,
        isActive: true,
        clientId: 'c1',
      });
      await expect(
        service.login({ email: 'a@b.com', password: 'x' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when the parent Client is inactive', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        passwordHash: await bcrypt.hash('pw', 4),
        isActive: true,
        clientId: 'c1',
      });
      mockClientsService.findOne.mockResolvedValue({
        id: 'c1',
        isActive: false,
      });
      await expect(
        service.login({ email: 'a@b.com', password: 'pw' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns a client-portal-scoped token for valid, active credentials', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        passwordHash: await bcrypt.hash('pw', 4),
        isActive: true,
        clientId: 'c1',
      });
      mockClientsService.findOne.mockResolvedValue({
        id: 'c1',
        isActive: true,
      });

      const result = await service.login({ email: 'a@b.com', password: 'pw' });

      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'u1',
          clientId: 'c1',
          scope: 'client-portal',
        }),
      );
      expect(result.accessToken).toBe('signed-token');
    });

    it('rejects with UnauthorizedException (not the underlying NotFoundException) when the parent Client was soft-deleted', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        passwordHash: await bcrypt.hash('pw', 4),
        isActive: true,
        clientId: 'c1',
      });
      mockClientsService.findOne.mockRejectedValue(
        new NotFoundException('Client c1 not found'),
      );

      await expect(
        service.login({ email: 'a@b.com', password: 'pw' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('resetPassword', () => {
    it('sets the password and clears the token when the token is valid and unexpired', async () => {
      const tokenHash = crypto
        .createHash('sha256')
        .update('plain-token')
        .digest('hex');
      mockRepo.findOne.mockResolvedValue({
        id: 'u1',
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: new Date(Date.now() + 1000),
      });

      await service.resetPassword({
        token: 'plain-token',
        password: 'new-password',
      });

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
        }),
      );
    });

    it('rejects an expired token', async () => {
      const tokenHash = crypto
        .createHash('sha256')
        .update('plain-token')
        .digest('hex');
      mockRepo.findOne.mockResolvedValue({
        id: 'u1',
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: new Date(Date.now() - 1000),
      });
      await expect(
        service.resetPassword({
          token: 'plain-token',
          password: 'new-password',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an unknown token', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(
        service.resetPassword({ token: 'nope', password: 'new-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('forgotPassword', () => {
    it('resolves silently (no email sent) when the address is unknown', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(
        service.forgotPassword({ email: 'unknown@x.com' }),
      ).resolves.toBeUndefined();
      expect(mockMailService.send).not.toHaveBeenCalled();
    });

    it('resolves silently even when the reset email fails to send for a known address', async () => {
      const user = { id: 'u1', email: 'known@x.com', clientId: 'c1' };
      mockRepo.findOne.mockResolvedValue(user);
      mockRepo.save.mockResolvedValue(user);
      mockMailService.send.mockRejectedValue(new Error('mailgun down'));

      await expect(
        service.forgotPassword({ email: 'known@x.com' }),
      ).resolves.toBeUndefined();
    });

    it('resolves silently even when persisting the reset token fails for a known address', async () => {
      const user = { id: 'u1', email: 'known@x.com', clientId: 'c1' };
      mockRepo.findOne.mockResolvedValue(user);
      mockRepo.save.mockRejectedValue(new Error('db down'));

      await expect(
        service.forgotPassword({ email: 'known@x.com' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertAccess', () => {
    it('passes through silently for a non-client-portal payload (admin token)', async () => {
      await expect(
        service.assertAccess(
          { sub: 'admin', email: 'a', name: 'A' },
          'any-client-id',
        ),
      ).resolves.toBeUndefined();
    });

    it('throws when targetClientId does not match the token clientId', async () => {
      await expect(
        service.assertAccess(
          {
            sub: 'u1',
            email: 'a',
            name: 'A',
            clientId: 'c1',
            scope: 'client-portal',
          },
          'c2',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws when targetClientId is undefined (no clientId resolvable on the request)', async () => {
      await expect(
        service.assertAccess(
          {
            sub: 'u1',
            email: 'a',
            name: 'A',
            clientId: 'c1',
            scope: 'client-portal',
          },
          undefined,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws when the portal user itself is inactive', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'u1', isActive: false });
      await expect(
        service.assertAccess(
          {
            sub: 'u1',
            email: 'a',
            name: 'A',
            clientId: 'c1',
            scope: 'client-portal',
          },
          'c1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws when the parent Client is inactive', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'u1', isActive: true });
      mockClientsService.findOne.mockResolvedValue({
        id: 'c1',
        isActive: false,
      });
      await expect(
        service.assertAccess(
          {
            sub: 'u1',
            email: 'a',
            name: 'A',
            clientId: 'c1',
            scope: 'client-portal',
          },
          'c1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('resolves when everything matches and is active', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'u1', isActive: true });
      mockClientsService.findOne.mockResolvedValue({
        id: 'c1',
        isActive: true,
      });
      await expect(
        service.assertAccess(
          {
            sub: 'u1',
            email: 'a',
            name: 'A',
            clientId: 'c1',
            scope: 'client-portal',
          },
          'c1',
        ),
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenException (not the underlying NotFoundException) when the parent Client was soft-deleted', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'u1', isActive: true });
      mockClientsService.findOne.mockRejectedValue(
        new NotFoundException('Client c1 not found'),
      );
      await expect(
        service.assertAccess(
          {
            sub: 'u1',
            email: 'a',
            name: 'A',
            clientId: 'c1',
            scope: 'client-portal',
          },
          'c1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
