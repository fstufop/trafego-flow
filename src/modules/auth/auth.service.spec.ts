import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service.js';
import { UserEntity } from './entities/user.entity.js';
import { UserRole } from './constants/user-role.constant.js';

describe('AuthService', () => {
  let service: AuthService;

  const mockRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('signed-token'),
  };
  const mockConfig = {
    get: jest.fn().mockReturnValue('1d'),
  };

  const makeUser = async (
    role: UserRole = UserRole.MEMBER,
  ): Promise<UserEntity> =>
    Object.assign(new UserEntity(), {
      id: 'user-uuid',
      name: 'Test User',
      email: 'user@test.com',
      passwordHash: await bcrypt.hash('correct-password', 4),
      isActive: true,
      role,
    });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(UserEntity), useValue: mockRepo },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('login', () => {
    it('returns an access token and the user for valid credentials', async () => {
      const user = await makeUser();
      mockRepo.findOne.mockResolvedValue(user);

      const result = await service.login({
        email: user.email,
        password: 'correct-password',
      });

      expect(result.accessToken).toBe('signed-token');
      expect(result.tokenType).toBe('Bearer');
      expect(result.user).toBe(user);
      expect(mockJwtService.signAsync).toHaveBeenCalledWith({
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      });
    });

    it('login() includes the user role in the JWT payload', async () => {
      const user = await makeUser(UserRole.MEMBER);
      mockRepo.findOne.mockResolvedValue(user);

      await service.login({
        email: user.email,
        password: 'correct-password',
      });

      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.MEMBER }),
      );
    });

    it('throws UnauthorizedException for wrong password', async () => {
      mockRepo.findOne.mockResolvedValue(await makeUser());

      await expect(
        service.login({ email: 'user@test.com', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for unknown email', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@test.com', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('createUser', () => {
    it('hashes the password and saves the user', async () => {
      mockRepo.create.mockImplementation((data: Partial<UserEntity>) => data);
      mockRepo.save.mockImplementation((data: UserEntity) =>
        Promise.resolve(data),
      );

      const result = await service.createUser({
        name: 'New User',
        email: 'new@test.com',
        password: 'plain-password',
        role: UserRole.MEMBER,
      });

      expect(result.passwordHash).toBeDefined();
      expect(result.passwordHash).not.toBe('plain-password');
      await expect(
        bcrypt.compare('plain-password', result.passwordHash),
      ).resolves.toBe(true);
    });

    it('createUser() persists the role from the DTO', async () => {
      mockRepo.create.mockImplementation((data: Partial<UserEntity>) => data);
      mockRepo.save.mockImplementation((data: UserEntity) =>
        Promise.resolve(data),
      );

      await service.createUser({
        name: 'New Admin',
        email: 'admin@test.com',
        password: 'plain-password',
        role: UserRole.ADMIN,
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.ADMIN }),
      );
    });

    it('throws ConflictException on duplicate email', async () => {
      mockRepo.create.mockImplementation((data: Partial<UserEntity>) => data);
      const err = new QueryFailedError('INSERT', [], new Error('duplicate'));
      (err as QueryFailedError & { code: string }).code = '23505';
      mockRepo.save.mockRejectedValue(err);

      await expect(
        service.createUser({
          name: 'Dup',
          email: 'dup@test.com',
          password: 'plain-password',
          role: UserRole.MEMBER,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('issueUploadToken', () => {
    it('signs a short-lived, scoped token for the given user', async () => {
      const result = await service.issueUploadToken({
        sub: 'user-uuid',
        email: 'user@test.com',
        name: 'Test User',
      });

      expect(result.accessToken).toBe('signed-token');
      expect(result.tokenType).toBe('Bearer');
      expect(result.expiresIn).toBe('5m');
      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        {
          sub: 'user-uuid',
          email: 'user@test.com',
          name: 'Test User',
          scope: 'media-upload',
        },
        { expiresIn: '5m' },
      );
    });

    it('does not carry over a scope already present on the current user payload', async () => {
      await service.issueUploadToken({
        sub: 'user-uuid',
        email: 'user@test.com',
        name: 'Test User',
        scope: 'some-other-scope',
      });

      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'media-upload' }),
        { expiresIn: '5m' },
      );
    });
  });

  describe('findById', () => {
    it('returns the active user', async () => {
      const user = await makeUser();
      mockRepo.findOne.mockResolvedValue(user);

      await expect(service.findById(user.id)).resolves.toBe(user);
    });

    it('throws UnauthorizedException when user is missing or inactive', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('missing-id')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
