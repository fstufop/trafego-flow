import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { IntegrationsService } from './integrations.service.js';
import { IntegrationEntity, MetaPlatform } from './entities/integration.entity.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';

const mockIntegration: IntegrationEntity = {
  id: 'uuid-int-1',
  clientId: 'uuid-client-1',
  client: {} as never,
  platform: MetaPlatform.INSTAGRAM,
  pageId: 'PAGE123',
  accessToken: 'encrypted-token',
  tokenExpiresAt: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const mockRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  softRemove: jest.fn(),
};

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockCrypto = {
  encrypt: jest.fn().mockReturnValue('encrypted-token'),
  decrypt: jest.fn().mockReturnValue('plaintext-token'),
};

describe('IntegrationsService', () => {
  let service: IntegrationsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        { provide: getRepositoryToken(IntegrationEntity), useValue: mockRepo },
        { provide: CACHE_MANAGER, useValue: mockCache },
        { provide: AesCryptoService, useValue: mockCrypto },
      ],
    }).compile();

    service = module.get<IntegrationsService>(IntegrationsService);
  });

  describe('create', () => {
    it('should encrypt accessToken and save integration', async () => {
      mockRepo.create.mockReturnValue({ ...mockIntegration });
      mockRepo.save.mockResolvedValue(mockIntegration);

      const result = await service.create({
        clientId: 'uuid-client-1',
        platform: MetaPlatform.INSTAGRAM,
        pageId: 'PAGE123',
        accessToken: 'plaintext-token',
      });

      expect(mockCrypto.encrypt).toHaveBeenCalledWith('plaintext-token');
      expect(result).toEqual(mockIntegration);
      expect(mockCache.set).toHaveBeenCalledWith('integration:id:uuid-int-1', mockIntegration);
      expect(mockCache.set).toHaveBeenCalledWith('integration:page:PAGE123', mockIntegration);
    });

    it('should throw ConflictException on duplicate pageId', async () => {
      mockRepo.create.mockReturnValue(mockIntegration);
      const dbError = new QueryFailedError('', [], new Error('duplicate key'));
      (dbError as QueryFailedError & { code: string }).code = '23505';
      mockRepo.save.mockRejectedValue(dbError);

      await expect(
        service.create({ clientId: 'c', platform: MetaPlatform.INSTAGRAM, pageId: 'PAGE123', accessToken: 'tok' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return active integrations filtered by clientId', async () => {
      mockRepo.find.mockResolvedValue([mockIntegration]);
      const result = await service.findAll('uuid-client-1');
      expect(result).toEqual([mockIntegration]);
      expect(mockRepo.find).toHaveBeenCalledWith({ where: { clientId: 'uuid-client-1', isActive: true } });
    });
  });

  describe('findOne', () => {
    it('should return cached integration without hitting repository', async () => {
      mockCache.get.mockResolvedValue(mockIntegration);
      const result = await service.findOne('uuid-int-1');
      expect(result).toEqual(mockIntegration);
      expect(mockRepo.findOne).not.toHaveBeenCalled();
    });

    it('should query repository on cache miss and populate cache', async () => {
      mockCache.get.mockResolvedValue(null);
      mockRepo.findOne.mockResolvedValue(mockIntegration);

      const result = await service.findOne('uuid-int-1');
      expect(result).toEqual(mockIntegration);
      expect(mockCache.set).toHaveBeenCalledWith('integration:id:uuid-int-1', mockIntegration);
    });

    it('should throw NotFoundException when integration does not exist', async () => {
      mockCache.get.mockResolvedValue(null);
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByPageId', () => {
    it('should return cached integration by pageId', async () => {
      mockCache.get.mockResolvedValue(mockIntegration);
      const result = await service.findByPageId('PAGE123');
      expect(result).toEqual(mockIntegration);
      expect(mockRepo.findOne).not.toHaveBeenCalled();
    });

    it('should populate both cache keys on miss', async () => {
      mockCache.get.mockResolvedValue(null);
      mockRepo.findOne.mockResolvedValue(mockIntegration);

      await service.findByPageId('PAGE123');

      expect(mockCache.set).toHaveBeenCalledWith('integration:id:uuid-int-1', mockIntegration);
      expect(mockCache.set).toHaveBeenCalledWith('integration:page:PAGE123', mockIntegration);
    });
  });

  describe('update', () => {
    it('should encrypt new accessToken and invalidate both cache keys', async () => {
      mockCache.get.mockResolvedValue(mockIntegration);
      mockRepo.save.mockResolvedValue({ ...mockIntegration, accessToken: 'new-encrypted' });

      await service.update('uuid-int-1', { accessToken: 'new-plaintext-token' });

      expect(mockCrypto.encrypt).toHaveBeenCalledWith('new-plaintext-token');
      expect(mockCache.del).toHaveBeenCalledWith('integration:id:uuid-int-1');
      expect(mockCache.del).toHaveBeenCalledWith('integration:page:PAGE123');
    });

    it('should not encrypt if accessToken is not in dto', async () => {
      mockCache.get.mockResolvedValue(mockIntegration);
      mockRepo.save.mockResolvedValue({ ...mockIntegration, isActive: false });

      await service.update('uuid-int-1', { isActive: false });

      expect(mockCrypto.encrypt).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should soft remove and invalidate both cache keys', async () => {
      mockCache.get.mockResolvedValue(mockIntegration);
      mockRepo.softRemove.mockResolvedValue(undefined);

      await service.remove('uuid-int-1');

      expect(mockRepo.softRemove).toHaveBeenCalledWith(mockIntegration);
      expect(mockCache.del).toHaveBeenCalledWith('integration:id:uuid-int-1');
      expect(mockCache.del).toHaveBeenCalledWith('integration:page:PAGE123');
    });
  });
});
