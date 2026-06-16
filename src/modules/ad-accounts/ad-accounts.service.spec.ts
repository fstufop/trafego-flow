import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AdAccountsService } from './ad-accounts.service.js';
import { AdAccountEntity } from './entities/ad-account.entity.js';
import { AesCryptoService } from '../../common/crypto/aes.service.js';

const mockAccount: AdAccountEntity = {
  id: 'uuid-acc-1',
  clientId: 'uuid-client-1',
  client: {} as never,
  adAccountId: 'act_123456789',
  accountName: 'Conta Principal',
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

describe('AdAccountsService', () => {
  let service: AdAccountsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdAccountsService,
        { provide: getRepositoryToken(AdAccountEntity), useValue: mockRepo },
        { provide: CACHE_MANAGER, useValue: mockCache },
        { provide: AesCryptoService, useValue: mockCrypto },
      ],
    }).compile();

    service = module.get<AdAccountsService>(AdAccountsService);
  });

  describe('create', () => {
    it('should encrypt accessToken and populate both cache keys', async () => {
      mockRepo.create.mockReturnValue({ ...mockAccount });
      mockRepo.save.mockResolvedValue(mockAccount);

      const result = await service.create({
        clientId: 'uuid-client-1',
        adAccountId: 'act_123456789',
        accessToken: 'plaintext-token',
      });

      expect(mockCrypto.encrypt).toHaveBeenCalledWith('plaintext-token');
      expect(result).toEqual(mockAccount);
      expect(mockCache.set).toHaveBeenCalledWith('ad-account:id:uuid-acc-1', mockAccount);
      expect(mockCache.set).toHaveBeenCalledWith('ad-account:act:act_123456789', mockAccount);
    });

    it('should throw ConflictException on duplicate adAccountId', async () => {
      mockRepo.create.mockReturnValue(mockAccount);
      const dbError = new QueryFailedError('', [], new Error('duplicate key'));
      (dbError as QueryFailedError & { code: string }).code = '23505';
      mockRepo.save.mockRejectedValue(dbError);

      await expect(
        service.create({ clientId: 'c', adAccountId: 'act_123456789', accessToken: 'tok' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return active accounts filtered by clientId', async () => {
      mockRepo.find.mockResolvedValue([mockAccount]);
      const result = await service.findAll('uuid-client-1');
      expect(result).toEqual([mockAccount]);
      expect(mockRepo.find).toHaveBeenCalledWith({ where: { clientId: 'uuid-client-1', isActive: true } });
    });
  });

  describe('findOne', () => {
    it('should return cached account without hitting repository', async () => {
      mockCache.get.mockResolvedValue(mockAccount);
      const result = await service.findOne('uuid-acc-1');
      expect(result).toEqual(mockAccount);
      expect(mockRepo.findOne).not.toHaveBeenCalled();
    });

    it('should query repository on cache miss and populate cache', async () => {
      mockCache.get.mockResolvedValue(null);
      mockRepo.findOne.mockResolvedValue(mockAccount);

      const result = await service.findOne('uuid-acc-1');
      expect(result).toEqual(mockAccount);
      expect(mockCache.set).toHaveBeenCalledWith('ad-account:id:uuid-acc-1', mockAccount);
    });

    it('should throw NotFoundException when account does not exist', async () => {
      mockCache.get.mockResolvedValue(null);
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByAdAccountId', () => {
    it('should return cached account by adAccountId', async () => {
      mockCache.get.mockResolvedValue(mockAccount);
      const result = await service.findByAdAccountId('act_123456789');
      expect(result).toEqual(mockAccount);
      expect(mockRepo.findOne).not.toHaveBeenCalled();
    });

    it('should populate both cache keys on miss', async () => {
      mockCache.get.mockResolvedValue(null);
      mockRepo.findOne.mockResolvedValue(mockAccount);

      await service.findByAdAccountId('act_123456789');

      expect(mockCache.set).toHaveBeenCalledWith('ad-account:id:uuid-acc-1', mockAccount);
      expect(mockCache.set).toHaveBeenCalledWith('ad-account:act:act_123456789', mockAccount);
    });

    it('should throw NotFoundException when adAccountId does not exist', async () => {
      mockCache.get.mockResolvedValue(null);
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.findByAdAccountId('act_inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should encrypt new accessToken and invalidate both cache keys', async () => {
      mockCache.get.mockResolvedValue(mockAccount);
      mockRepo.save.mockResolvedValue({ ...mockAccount, accessToken: 'new-encrypted' });

      await service.update('uuid-acc-1', { accessToken: 'new-plaintext-token' });

      expect(mockCrypto.encrypt).toHaveBeenCalledWith('new-plaintext-token');
      expect(mockCache.del).toHaveBeenCalledWith('ad-account:id:uuid-acc-1');
      expect(mockCache.del).toHaveBeenCalledWith('ad-account:act:act_123456789');
    });

    it('should not encrypt if accessToken is not in dto', async () => {
      mockCache.get.mockResolvedValue(mockAccount);
      mockRepo.save.mockResolvedValue({ ...mockAccount, isActive: false });

      await service.update('uuid-acc-1', { isActive: false });

      expect(mockCrypto.encrypt).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should soft remove and invalidate both cache keys', async () => {
      mockCache.get.mockResolvedValue(mockAccount);
      mockRepo.softRemove.mockResolvedValue(undefined);

      await service.remove('uuid-acc-1');

      expect(mockRepo.softRemove).toHaveBeenCalledWith(mockAccount);
      expect(mockCache.del).toHaveBeenCalledWith('ad-account:id:uuid-acc-1');
      expect(mockCache.del).toHaveBeenCalledWith('ad-account:act:act_123456789');
    });
  });

  describe('findExpiring', () => {
    it('should return accounts expiring within daysAhead for a specific client', async () => {
      mockRepo.find.mockResolvedValue([mockAccount]);

      const result = await service.findExpiring('uuid-client-1', 7);

      expect(result).toEqual([mockAccount]);
      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            clientId: 'uuid-client-1',
            isActive: true,
          }),
        }),
      );
    });

    it('should include tokenExpiresAt LessThanOrEqual condition', async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.findExpiring('uuid-client-1', 7);

      const callArgs = mockRepo.find.mock.calls[0][0];
      expect(callArgs.where.tokenExpiresAt).toBeDefined();
    });

    it('should return empty array when no accounts are expiring', async () => {
      mockRepo.find.mockResolvedValue([]);

      const result = await service.findExpiring('uuid-client-1', 7);

      expect(result).toEqual([]);
    });
  });

  describe('findAllExpiring', () => {
    it('should return all expiring accounts across all clients', async () => {
      mockRepo.find.mockResolvedValue([mockAccount]);

      const result = await service.findAllExpiring(7);

      expect(result).toEqual([mockAccount]);
      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });

    it('should not filter by clientId', async () => {
      mockRepo.find.mockResolvedValue([]);

      await service.findAllExpiring(7);

      const callArgs = mockRepo.find.mock.calls[0][0];
      expect(callArgs.where.clientId).toBeUndefined();
    });
  });
});
