import { AdAccountEntity } from '../entities/ad-account.entity.js';
import { CreateAdAccountDto } from '../dto/create-ad-account.dto.js';
import { UpdateAdAccountDto } from '../dto/update-ad-account.dto.js';

export interface IAdAccountsService {
  create(dto: CreateAdAccountDto): Promise<AdAccountEntity>;
  findAll(clientId: string): Promise<AdAccountEntity[]>;
  findOne(id: string): Promise<AdAccountEntity>;
  findByAdAccountId(adAccountId: string): Promise<AdAccountEntity>;
  update(id: string, dto: UpdateAdAccountDto): Promise<AdAccountEntity>;
  remove(id: string): Promise<void>;
  findExpiring(clientId: string, daysAhead: number): Promise<AdAccountEntity[]>;
  findAllExpiring(daysAhead: number): Promise<AdAccountEntity[]>;
}
