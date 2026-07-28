// src/modules/clients/clients.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ClientsService } from './clients.service.js';
import { ClientEntity } from './entities/client.entity.js';
import { ClientBillingEntity, BillingType, BillingStatus, PaymentMethod } from './entities/client-billing.entity.js';

const mockBilling: ClientBillingEntity = {
  id: 'billing-1',
  clientId: 'uuid-1',
  type: BillingType.MONTHLY,
  amount: 1500,
  discountType: null,
  discountValue: null,
  paymentMethod: PaymentMethod.PIX,
  dueDay: 10,
  status: BillingStatus.PAID,
  lastPaidAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
} as ClientBillingEntity;

const mockClient: ClientEntity = {
  id: 'uuid-1',
  name: 'Agência XYZ',
  email: 'contato@xyz.com',
  isActive: true,
  phone: null,
  whatsappGroupCode: null,
  googleDriveFolderUrl: null,
  billing: mockBilling,
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

const mockBillingRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
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
        { provide: getRepositoryToken(ClientBillingEntity), useValue: mockBillingRepo },
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);
  });

  describe('create', () => {
    it('should create client without billing', async () => {
      const clientOnly = { ...mockClient, billing: undefined as any };
      mockRepo.create.mockReturnValue(clientOnly);
      mockRepo.save.mockResolvedValueOnce(clientOnly);
      mockRepo.findOne.mockResolvedValue(clientOnly);

      const result = await service.create({ name: 'Agência XYZ', email: 'contato@xyz.com' });

      expect(result).toEqual(clientOnly);
      expect(mockBillingRepo.save).not.toHaveBeenCalled();
    });

    it('should create client with billing when billing is provided', async () => {
      const clientOnly = { ...mockClient, billing: undefined as any };
      mockRepo.create.mockReturnValue(clientOnly);
      mockRepo.save.mockResolvedValueOnce(clientOnly);
      mockBillingRepo.create.mockReturnValue({ ...mockBilling });
      mockBillingRepo.save.mockResolvedValue(mockBilling);
      mockRepo.findOne.mockResolvedValue(mockClient);

      const result = await service.create({
        name: 'Agência XYZ',
        email: 'contato@xyz.com',
        billing: {
          type: BillingType.MONTHLY,
          amount: 1500,
          paymentMethod: PaymentMethod.PIX,
          dueDay: 10,
          status: BillingStatus.PAID,
        },
      });

      expect(mockBillingRepo.save).toHaveBeenCalledTimes(1);
      expect(result.billing).toEqual(mockBilling);
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
    it('should return active clients with billing relation', async () => {
      mockRepo.find.mockResolvedValue([mockClient]);

      const result = await service.findAll();

      expect(result).toEqual([mockClient]);
      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        relations: ['billing'],
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

    it('should query repository with billing relation on cache miss', async () => {
      mockCache.get.mockResolvedValue(null);
      mockRepo.findOne.mockResolvedValue(mockClient);

      const result = await service.findOne('uuid-1');

      expect(result).toEqual(mockClient);
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        relations: ['billing'],
      });
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
      mockRepo.save.mockResolvedValue({ ...mockClient, name: 'Novo Nome' });
      mockRepo.findOne.mockResolvedValue({ ...mockClient, name: 'Novo Nome' });

      const result = await service.update('uuid-1', { name: 'Novo Nome' });

      expect(result.name).toBe('Novo Nome');
      expect(mockCache.del).toHaveBeenCalledWith('client:id:uuid-1');
    });

    it('should upsert billing on update when billing is provided', async () => {
      mockCache.get.mockResolvedValue(mockClient);
      mockRepo.save.mockResolvedValue(mockClient);
      mockBillingRepo.findOne.mockResolvedValue(mockBilling);
      mockBillingRepo.save.mockResolvedValue({ ...mockBilling, amount: 2000 });
      mockRepo.findOne.mockResolvedValue({ ...mockClient, billing: { ...mockBilling, amount: 2000 } });

      await service.update('uuid-1', { billing: { amount: 2000 } });

      expect(mockBillingRepo.save).toHaveBeenCalledWith({ ...mockBilling, amount: 2000 });
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
});
