import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { IntegrationEntity } from './entities/integration.entity.js';
import { IIntegrationsService } from './interfaces/integrations-service.interface.js';
import { CreateIntegrationDto } from './dto/create-integration.dto.js';
import { UpdateIntegrationDto } from './dto/update-integration.dto.js';

const cacheById = (id: string) => `integration:id:${id}`;
const cacheByPage = (pageId: string) => `integration:page:${pageId}`;

@Injectable()
export class IntegrationsService implements IIntegrationsService {
  constructor(
    @InjectRepository(IntegrationEntity)
    private readonly repo: Repository<IntegrationEntity>,
    @Inject(CACHE_MANAGER)
    private readonly cache: Cache,
    private readonly crypto: AesCryptoService,
  ) {}

  async create(dto: CreateIntegrationDto): Promise<IntegrationEntity> {
    try {
      const entity = this.repo.create({
        ...dto,
        accessToken: this.crypto.encrypt(dto.accessToken),
        tokenExpiresAt: dto.tokenExpiresAt ? new Date(dto.tokenExpiresAt) : null,
      });
      const saved = await this.repo.save(entity);
      await this.cache.set(cacheById(saved.id), saved);
      await this.cache.set(cacheByPage(saved.pageId), saved);
      return saved;
    } catch (err) {
      if (err instanceof QueryFailedError && (err as QueryFailedError & { code: string }).code === '23505') {
        throw new ConflictException('An integration with this pageId already exists');
      }
      throw err;
    }
  }

  findAll(clientId: string): Promise<IntegrationEntity[]> {
    return this.repo.find({ where: { clientId, isActive: true } });
  }

  async findOne(id: string): Promise<IntegrationEntity> {
    const cached = await this.cache.get<IntegrationEntity>(cacheById(id));
    if (cached) return cached;

    const integration = await this.repo.findOne({ where: { id } });
    if (!integration) throw new NotFoundException(`Integration ${id} not found`);

    await this.cache.set(cacheById(id), integration);
    return integration;
  }

  async findByPageId(pageId: string): Promise<IntegrationEntity> {
    const cached = await this.cache.get<IntegrationEntity>(cacheByPage(pageId));
    if (cached) return cached;

    const integration = await this.repo.findOne({ where: { pageId } });
    if (!integration) throw new NotFoundException(`Integration for pageId ${pageId} not found`);

    await this.cache.set(cacheById(integration.id), integration);
    await this.cache.set(cacheByPage(pageId), integration);
    return integration;
  }

  async update(id: string, dto: UpdateIntegrationDto): Promise<IntegrationEntity> {
    const integration = await this.findOne(id);

    const patch: Partial<IntegrationEntity> = {
      isActive: dto.isActive,
      tokenExpiresAt: dto.tokenExpiresAt ? new Date(dto.tokenExpiresAt) : integration.tokenExpiresAt,
    };
    if (dto.accessToken) {
      patch.accessToken = this.crypto.encrypt(dto.accessToken);
    }

    const updated = await this.repo.save({ ...integration, ...patch });
    await this.cache.del(cacheById(id));
    await this.cache.del(cacheByPage(integration.pageId));
    return updated;
  }

  async remove(id: string): Promise<void> {
    const integration = await this.findOne(id);
    await this.repo.softRemove(integration);
    await this.cache.del(cacheById(id));
    await this.cache.del(cacheByPage(integration.pageId));
  }
}
