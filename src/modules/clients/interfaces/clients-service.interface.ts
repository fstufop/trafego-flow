import { ClientEntity } from '../entities/client.entity.js';
import { CreateClientDto } from '../dto/create-client.dto.js';
import { UpdateClientDto } from '../dto/update-client.dto.js';

export interface IClientsService {
  create(dto: CreateClientDto): Promise<ClientEntity>;
  findAll(): Promise<ClientEntity[]>;
  findOne(id: string): Promise<ClientEntity>;
  update(id: string, dto: UpdateClientDto): Promise<ClientEntity>;
  remove(id: string): Promise<void>;
}
