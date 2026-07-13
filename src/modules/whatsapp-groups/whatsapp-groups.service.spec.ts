import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { WhatsAppGroupsService } from './whatsapp-groups.service.js';
import { WhatsAppGroupEntity } from './entities/whatsapp-group.entity.js';

const makeGroup = (overrides: Partial<WhatsAppGroupEntity> = {}): WhatsAppGroupEntity =>
  Object.assign(new WhatsAppGroupEntity(), {
    id: 'group-uuid',
    clientId: 'client-uuid',
    groupJid: '120363000000@g.us',
    label: 'Grupo Teste',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  });

describe('WhatsAppGroupsService', () => {
  let service: WhatsAppGroupsService;

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

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppGroupsService,
        { provide: getRepositoryToken(WhatsAppGroupEntity), useValue: mockRepo },
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get(WhatsAppGroupsService);
  });

  describe('create', () => {
    it('salva o grupo e invalida o cache do cliente', async () => {
      const group = makeGroup();
      mockRepo.create.mockReturnValue(group);
      mockRepo.save.mockResolvedValue(group);
      mockCache.del.mockResolvedValue(undefined);
      mockCache.set.mockResolvedValue(undefined);

      const result = await service.create({ clientId: group.clientId, groupJid: group.groupJid });

      expect(mockRepo.save).toHaveBeenCalledWith(group);
      expect(mockCache.del).toHaveBeenCalledWith(`whatsapp:groups:client:${group.clientId}`);
      expect(result).toBe(group);
    });

    it('lança ConflictException para JID duplicado (código 23505)', async () => {
      mockRepo.create.mockReturnValue({});
      const err = Object.assign(new QueryFailedError('', [], new Error()), { code: '23505' });
      mockRepo.save.mockRejectedValue(err);

      await expect(service.create({ clientId: 'c', groupJid: '1@g.us' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findAll', () => {
    it('retorna do banco e cacheia na primeira chamada', async () => {
      const group = makeGroup();
      mockCache.get.mockResolvedValue(null);
      mockRepo.find.mockResolvedValue([group]);
      mockCache.set.mockResolvedValue(undefined);

      const result = await service.findAll('client-uuid');

      expect(mockRepo.find).toHaveBeenCalledWith({ where: { clientId: 'client-uuid', isActive: true } });
      expect(result).toEqual([group]);
    });

    it('retorna do cache na segunda chamada sem bater no banco', async () => {
      const cached = [makeGroup()];
      mockCache.get.mockResolvedValue(cached);

      const result = await service.findAll('client-uuid');

      expect(mockRepo.find).not.toHaveBeenCalled();
      expect(result).toBe(cached);
    });
  });

  describe('findOne', () => {
    it('retorna o grupo existente', async () => {
      const group = makeGroup();
      mockCache.get.mockResolvedValue(null);
      mockRepo.findOne.mockResolvedValue(group);
      mockCache.set.mockResolvedValue(undefined);

      const result = await service.findOne('group-uuid');
      expect(result).toBe(group);
    });

    it('lança NotFoundException para id inexistente', async () => {
      mockCache.get.mockResolvedValue(null);
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('chama softRemove e invalida os dois caches', async () => {
      const group = makeGroup();
      mockCache.get.mockResolvedValue(group);
      mockRepo.softRemove.mockResolvedValue(undefined);
      mockCache.del.mockResolvedValue(undefined);

      await service.remove('group-uuid');

      expect(mockRepo.softRemove).toHaveBeenCalledWith(group);
      expect(mockCache.del).toHaveBeenCalledWith(`whatsapp:group:id:${group.id}`);
      expect(mockCache.del).toHaveBeenCalledWith(`whatsapp:groups:client:${group.clientId}`);
    });
  });
});
