import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ClientsService } from './clients.service.js';
import { ClientEntity } from './entities/client.entity.js';

const mockClient: ClientEntity = {
  id: 'uuid-1',
  name: 'Agência XYZ',
  email: 'contato@xyz.com',
  isActive: true,
  phone: null,
  whatsappGroupCode: null,
  googleDriveFolderUrl: null,
  aiStrategyContext: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
} as ClientEntity;

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

describe('ClientsService', () => {
  let service: ClientsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: getRepositoryToken(ClientEntity), useValue: mockRepo },
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);
  });

  describe('create', () => {
    it('should create and save a new client', async () => {
      mockRepo.create.mockReturnValue(mockClient);
      mockRepo.save.mockResolvedValue(mockClient);

      const result = await service.create({ name: 'Agência XYZ', email: 'contato@xyz.com' });

      expect(result).toEqual(mockClient);
      expect(mockRepo.create).toHaveBeenCalledWith({ name: 'Agência XYZ', email: 'contato@xyz.com' });
      expect(mockRepo.save).toHaveBeenCalledWith(mockClient);
    });

    it('should throw ConflictException on duplicate email', async () => {
      mockRepo.create.mockReturnValue(mockClient);
      const dbError = new QueryFailedError('', [], new Error('duplicate key'));
      (dbError as QueryFailedError & { code: string }).code = '23505';
      mockRepo.save.mockRejectedValue(dbError);

      await expect(service.create({ name: 'Agência XYZ', email: 'contato@xyz.com' })).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return all active clients', async () => {
      mockRepo.find.mockResolvedValue([mockClient]);

      const result = await service.findAll();

      expect(result).toEqual([mockClient]);
      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
      });
    });
  });

  describe('findOne', () => {
    it('should return cached client without hitting the repository', async () => {
      mockCache.get.mockResolvedValue(mockClient);

      const result = await service.findOne('uuid-1');

      expect(result).toEqual(mockClient);
      expect(mockRepo.findOne).not.toHaveBeenCalled();
    });

    it('should query repository on cache miss', async () => {
      mockCache.get.mockResolvedValue(null);
      mockRepo.findOne.mockResolvedValue(mockClient);

      const result = await service.findOne('uuid-1');

      expect(result).toEqual(mockClient);
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
      });
      expect(mockCache.set).toHaveBeenCalledWith('client:id:uuid-1', mockClient);
    });

    it('should throw NotFoundException when client does not exist', async () => {
      mockCache.get.mockResolvedValue(null);
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update client and invalidate cache', async () => {
      mockCache.get.mockResolvedValue(mockClient);
      const updatedClient = { ...mockClient, name: 'Novo Nome' };
      mockRepo.save.mockResolvedValue(updatedClient);
      mockRepo.findOne.mockResolvedValue(updatedClient);

      const result = await service.update('uuid-1', { name: 'Novo Nome' });

      expect(result.name).toBe('Novo Nome');
      expect(mockCache.del).toHaveBeenCalledWith('client:id:uuid-1');
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
      });
    });
  });

  describe('remove', () => {
    it('should soft remove client and invalidate cache', async () => {
      mockCache.get.mockResolvedValue(mockClient);
      mockRepo.softRemove.mockResolvedValue(undefined);

      await service.remove('uuid-1');

      expect(mockRepo.softRemove).toHaveBeenCalledWith(mockClient);
      expect(mockCache.del).toHaveBeenCalledWith('client:id:uuid-1');
    });
  });

  describe('clearCache', () => {
    it('should clear cache for a given client id', async () => {
      await service.clearCache('uuid-1');

      expect(mockCache.del).toHaveBeenCalledWith('client:id:uuid-1');
    });
  });
});
