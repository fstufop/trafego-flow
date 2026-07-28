// src/modules/clients/clients.service.ts
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { ClientEntity } from './entities/client.entity.js';
import { ClientBillingEntity } from './entities/client-billing.entity.js';
import { IClientsService } from './interfaces/clients-service.interface.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

const cacheKey = (id: string) => `client:id:${id}`;

@Injectable()
export class ClientsService implements IClientsService {
  constructor(
    @InjectRepository(ClientEntity)
    private readonly repo: Repository<ClientEntity>,
    @InjectRepository(ClientBillingEntity)
    private readonly billingRepo: Repository<ClientBillingEntity>,
    @Inject(CACHE_MANAGER)
    private readonly cache: Cache,
  ) {}

  async create(dto: CreateClientDto): Promise<ClientEntity> {
    const { billing, ...clientData } = dto;
    let client: ClientEntity;
    try {
      client = await this.repo.save(this.repo.create(clientData));
    } catch (err) {
      if (err instanceof QueryFailedError && (err as QueryFailedError & { code: string }).code === '23505') {
        throw new ConflictException('A client with this email already exists');
      }
      throw err;
    }
    if (billing) {
      await this.billingRepo.save(this.billingRepo.create({ ...billing, clientId: client.id }));
    }
    return this.repo.findOne({ where: { id: client.id }, relations: { billing: true } }) as Promise<ClientEntity>;
  }

  findAll(): Promise<ClientEntity[]> {
    return this.repo.find({ where: { isActive: true }, relations: { billing: true } });
  }

  async findOne(id: string): Promise<ClientEntity> {
    const cached = await this.cache.get<ClientEntity>(cacheKey(id));
    if (cached) return cached;

    const client = await this.repo.findOne({ where: { id }, relations: { billing: true } });
    if (!client) throw new NotFoundException(`Client ${id} not found`);

    await this.cache.set(cacheKey(id), client);
    return client;
  }

  async update(id: string, dto: UpdateClientDto): Promise<ClientEntity> {
    const { billing, ...clientData } = dto;
    const client = await this.findOne(id);
    await this.repo.save({ ...client, ...clientData });

    if (billing) {
      const existing = await this.billingRepo.findOne({ where: { clientId: id } });
      if (existing) {
        await this.billingRepo.save({ ...existing, ...billing });
      } else {
        const { type, paymentMethod, dueDay, status } = billing;
        if (!type || !paymentMethod || dueDay == null || !status) {
          throw new BadRequestException(
            'Cannot create billing with partial data — provide type, paymentMethod, dueDay and status',
          );
        }
        await this.billingRepo.save(
          this.billingRepo.create({ ...billing, clientId: id } as any),
        );
      }
    }

    await this.cache.del(cacheKey(id));
    return this.repo.findOne({ where: { id }, relations: { billing: true } }) as Promise<ClientEntity>;
  }

  async remove(id: string): Promise<void> {
    const client = await this.findOne(id);
    await this.repo.softRemove(client);
    await this.cache.del(cacheKey(id));
  }
}
