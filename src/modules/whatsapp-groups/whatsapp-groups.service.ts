import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { WhatsAppGroupEntity } from './entities/whatsapp-group.entity.js';
import { IWhatsAppGroupsService } from './interfaces/whatsapp-groups-service.interface.js';
import { CreateWhatsAppGroupDto } from './dto/create-whatsapp-group.dto.js';
import { UpdateWhatsAppGroupDto } from './dto/update-whatsapp-group.dto.js';

const cacheById = (id: string) => `whatsapp:group:id:${id}`;
const cacheByClient = (clientId: string) => `whatsapp:groups:client:${clientId}`;

const GROUPS_TTL_MS = 300_000;

@Injectable()
export class WhatsAppGroupsService implements IWhatsAppGroupsService {
  constructor(
    @InjectRepository(WhatsAppGroupEntity)
    private readonly repo: Repository<WhatsAppGroupEntity>,
    @Inject(CACHE_MANAGER)
    private readonly cache: Cache,
  ) {}

  async create(dto: CreateWhatsAppGroupDto): Promise<WhatsAppGroupEntity> {
    try {
      const entity = this.repo.create({ ...dto, label: dto.label ?? null });
      const saved = await this.repo.save(entity);
      await this.cache.del(cacheByClient(saved.clientId));
      await this.cache.set(cacheById(saved.id), saved, GROUPS_TTL_MS);
      return saved;
    } catch (err) {
      if (err instanceof QueryFailedError && (err as QueryFailedError & { code: string }).code === '23505') {
        throw new ConflictException('Já existe um grupo com este groupJid');
      }
      throw err;
    }
  }

  async findAll(clientId: string): Promise<WhatsAppGroupEntity[]> {
    const cached = await this.cache.get<WhatsAppGroupEntity[]>(cacheByClient(clientId));
    if (cached) return cached;

    const groups = await this.repo.find({ where: { clientId, isActive: true } });
    await this.cache.set(cacheByClient(clientId), groups, GROUPS_TTL_MS);
    return groups;
  }

  async findOne(id: string): Promise<WhatsAppGroupEntity> {
    const cached = await this.cache.get<WhatsAppGroupEntity>(cacheById(id));
    if (cached) return cached;

    const group = await this.repo.findOne({ where: { id } });
    if (!group) throw new NotFoundException(`WhatsApp group ${id} not found`);

    await this.cache.set(cacheById(id), group, GROUPS_TTL_MS);
    return group;
  }

  async update(id: string, dto: UpdateWhatsAppGroupDto): Promise<WhatsAppGroupEntity> {
    const group = await this.findOne(id);
    const updated = await this.repo.save({ ...group, ...dto });
    await this.cache.del(cacheById(id));
    await this.cache.del(cacheByClient(group.clientId));
    return updated;
  }

  async remove(id: string): Promise<void> {
    const group = await this.findOne(id);
    await this.repo.softRemove(group);
    await this.cache.del(cacheById(id));
    await this.cache.del(cacheByClient(group.clientId));
  }

  async findAllActiveGroupedByClientId(): Promise<Map<string, WhatsAppGroupEntity[]>> {
    const groups = await this.repo.find({ where: { isActive: true } });
    const map = new Map<string, WhatsAppGroupEntity[]>();
    for (const g of groups) {
      const list = map.get(g.clientId) ?? [];
      list.push(g);
      map.set(g.clientId, list);
    }
    return map;
  }
}
