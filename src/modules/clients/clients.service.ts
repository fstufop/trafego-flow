import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { ClientEntity } from './entities/client.entity.js';
import { IClientsService } from './interfaces/clients-service.interface.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

const cacheKey = (id: string) => `client:id:${id}`;

@Injectable()
export class ClientsService implements IClientsService {
  constructor(
    @InjectRepository(ClientEntity)
    private readonly repo: Repository<ClientEntity>,
    @Inject(CACHE_MANAGER)
    private readonly cache: Cache,
  ) {}

  async create(dto: CreateClientDto): Promise<ClientEntity> {
    try {
      return await this.repo.save(this.repo.create(dto));
    } catch (err) {
      if (err instanceof QueryFailedError && (err as QueryFailedError & { code: string }).code === '23505') {
        throw new ConflictException('A client with this email already exists');
      }
      throw err;
    }
  }

  findAll(): Promise<ClientEntity[]> {
    return this.repo.find({ where: { isActive: true } });
  }

  async findOne(id: string): Promise<ClientEntity> {
    const cached = await this.cache.get<ClientEntity>(cacheKey(id));
    if (cached) return cached;

    const client = await this.repo.findOne({ where: { id } });
    if (!client) throw new NotFoundException(`Client ${id} not found`);

    await this.cache.set(cacheKey(id), client);
    return client;
  }

  async update(id: string, dto: UpdateClientDto): Promise<ClientEntity> {
    const client = await this.findOne(id);
    await this.repo.save({ ...client, ...dto });
    await this.cache.del(cacheKey(id));
    return this.repo.findOne({ where: { id } }) as Promise<ClientEntity>;
  }

  async remove(id: string): Promise<void> {
    const client = await this.findOne(id);
    await this.repo.softRemove(client);
    await this.cache.del(cacheKey(id));
  }

  async clearCache(id: string): Promise<void> {
    await this.cache.del(cacheKey(id));
  }
}
