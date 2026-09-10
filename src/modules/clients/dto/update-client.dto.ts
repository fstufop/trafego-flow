import { PartialType } from '@nestjs/swagger';
import { CreateClientDto } from './create-client.dto.js';

export class UpdateClientDto extends PartialType(CreateClientDto) {}
