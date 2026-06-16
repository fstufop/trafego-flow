import { IntegrationEntity } from '../entities/integration.entity.js';
import { CreateIntegrationDto } from '../dto/create-integration.dto.js';
import { UpdateIntegrationDto } from '../dto/update-integration.dto.js';

export interface IIntegrationsService {
  create(dto: CreateIntegrationDto): Promise<IntegrationEntity>;
  findAll(clientId: string): Promise<IntegrationEntity[]>;
  findOne(id: string): Promise<IntegrationEntity>;
  findByPageId(pageId: string): Promise<IntegrationEntity>;
  update(id: string, dto: UpdateIntegrationDto): Promise<IntegrationEntity>;
  remove(id: string): Promise<void>;
}
