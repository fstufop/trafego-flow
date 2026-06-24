import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, QueryFailedError, Repository } from 'typeorm';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { AesCryptoService } from '../../common/crypto/aes.service.js';
import { AdAccountEntity } from './entities/ad-account.entity.js';
import { IAdAccountsService } from './interfaces/ad-accounts-service.interface.js';
import { CreateAdAccountDto } from './dto/create-ad-account.dto.js';
import { UpdateAdAccountDto } from './dto/update-ad-account.dto.js';

const cacheById = (id: string) => `ad-account:id:${id}`;
const cacheByAct = (adAccountId: string) => `ad-account:act:${adAccountId}`;

@Injectable()
export class AdAccountsService implements IAdAccountsService {
  constructor(
    @InjectRepository(AdAccountEntity)
    private readonly repo: Repository<AdAccountEntity>,
    @Inject(CACHE_MANAGER)
    private readonly cache: Cache,
    private readonly crypto: AesCryptoService,
  ) {}

  async create(dto: CreateAdAccountDto): Promise<AdAccountEntity> {
    try {
      const entity = this.repo.create({
        ...dto,
        accessToken: this.crypto.encrypt(dto.accessToken),
        tokenExpiresAt: dto.tokenExpiresAt ? new Date(dto.tokenExpiresAt) : null,
      });
      const saved = await this.repo.save(entity);
      await this.cache.set(cacheById(saved.id), saved);
      await this.cache.set(cacheByAct(saved.adAccountId), saved);
      return saved;
    } catch (err) {
      if (err instanceof QueryFailedError && (err as QueryFailedError & { code: string }).code === '23505') {
        throw new ConflictException('An ad account with this adAccountId already exists');
      }
      throw err;
    }
  }

  findAll(clientId: string): Promise<AdAccountEntity[]> {
    return this.repo.find({ where: { clientId, isActive: true } });
  }

  async findOne(id: string): Promise<AdAccountEntity> {
    const cached = await this.cache.get<AdAccountEntity>(cacheById(id));
    if (cached) return cached;

    const account = await this.repo.findOne({ where: { id } });
    if (!account) throw new NotFoundException(`Ad account ${id} not found`);

    await this.cache.set(cacheById(id), account);
    return account;
  }

  async findByAdAccountId(adAccountId: string): Promise<AdAccountEntity> {
    const cached = await this.cache.get<AdAccountEntity>(cacheByAct(adAccountId));
    if (cached) return cached;

    const account = await this.repo.findOne({ where: { adAccountId } });
    if (!account) throw new NotFoundException(`Ad account ${adAccountId} not found`);

    await this.cache.set(cacheById(account.id), account);
    await this.cache.set(cacheByAct(adAccountId), account);
    return account;
  }

  async update(id: string, dto: UpdateAdAccountDto): Promise<AdAccountEntity> {
    const account = await this.findOne(id);

    const patch: Partial<AdAccountEntity> = {
      isActive: dto.isActive,
      accountName: dto.accountName ?? account.accountName,
      tokenExpiresAt: dto.tokenExpiresAt ? new Date(dto.tokenExpiresAt) : account.tokenExpiresAt,
    };
    if (dto.accessToken) {
      patch.accessToken = this.crypto.encrypt(dto.accessToken);
    }

    const updated = await this.repo.save({ ...account, ...patch });
    await this.cache.del(cacheById(id));
    await this.cache.del(cacheByAct(account.adAccountId));
    return updated;
  }

  async remove(id: string): Promise<void> {
    const account = await this.findOne(id);
    await this.repo.softRemove(account);
    await this.cache.del(cacheById(id));
    await this.cache.del(cacheByAct(account.adAccountId));
  }

  findExpiring(clientId: string, daysAhead: number): Promise<AdAccountEntity[]> {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + daysAhead);
    return this.repo.find({
      where: { clientId, isActive: true, tokenExpiresAt: LessThanOrEqual(deadline) },
    });
  }

  findAllExpiring(daysAhead: number): Promise<AdAccountEntity[]> {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + daysAhead);
    return this.repo.find({
      where: { isActive: true, tokenExpiresAt: LessThanOrEqual(deadline) },
    });
  }
}
