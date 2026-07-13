import { WhatsAppGroupEntity } from '../entities/whatsapp-group.entity.js';
import { CreateWhatsAppGroupDto } from '../dto/create-whatsapp-group.dto.js';
import { UpdateWhatsAppGroupDto } from '../dto/update-whatsapp-group.dto.js';

export interface IWhatsAppGroupsService {
  create(dto: CreateWhatsAppGroupDto): Promise<WhatsAppGroupEntity>;
  findAll(clientId: string): Promise<WhatsAppGroupEntity[]>;
  findOne(id: string): Promise<WhatsAppGroupEntity>;
  update(id: string, dto: UpdateWhatsAppGroupDto): Promise<WhatsAppGroupEntity>;
  remove(id: string): Promise<void>;
}
