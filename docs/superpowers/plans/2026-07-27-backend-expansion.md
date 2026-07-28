# Dashboard ModeFlow — Backend Expansion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expandir o backend NestJS (trafegoflow) com `ClientBillingEntity`, novos campos em `ClientEntity`, e suporte a `clientId` opcional no endpoint de dispatches.

**Architecture:** Três tasks independentes em sequência: (1) entidade + migração, (2) DTOs + Service, (3) ajuste no endpoint de dispatches. O frontend (plano separado) depende deste plano estar concluído.

**Tech Stack:** NestJS 11, TypeORM, PostgreSQL, Jest 30, class-validator

## Global Constraints

- NodeNext module resolution — todos os imports locais precisam de extensão `.js`
- Usar `@ApiProperty` em todos os DTOs públicos (Swagger ativo)
- Soft delete via `softRemove` — nunca `delete` direto
- Cache do Redis via `CACHE_MANAGER` — invalidar em update/remove
- Migrations usam SQL raw (não `queryRunner.createTable`) — seguir o padrão do repo
- Timestamp das migrations > `1780000000002` (último migration existente)

---

### Task 1: ClientBillingEntity + Migration + Atualização do ClientEntity

**Files:**
- Create: `src/modules/clients/entities/client-billing.entity.ts`
- Modify: `src/modules/clients/entities/client.entity.ts`
- Modify: `src/modules/clients/clients.module.ts`
- Create: `src/database/migrations/1780300000000-AddClientBillingAndExpandClients.ts`

**Interfaces:**
- Produces: `ClientBillingEntity`, enums `BillingType | PaymentMethod | BillingStatus | DiscountType` — usados na Task 2

---

- [ ] **Step 1: Criar `client-billing.entity.ts`**

```typescript
// src/modules/clients/entities/client-billing.entity.ts
import { Column, Entity, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { ClientEntity } from './client.entity.js';

export enum BillingType {
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  SEMIANNUAL = 'semiannual',
  ANNUAL = 'annual',
}

export enum PaymentMethod {
  PIX = 'pix',
  BOLETO = 'boleto',
  DEBIT = 'debit',
  CREDIT = 'credit',
}

export enum BillingStatus {
  PAID = 'paid',
  PENDING = 'pending',
  OVERDUE = 'overdue',
}

export enum DiscountType {
  FIXED = 'fixed',
  PERCENTAGE = 'percentage',
}

@Entity('client_billings')
export class ClientBillingEntity extends BaseEntity {
  @Column({ name: 'client_id' })
  clientId: string;

  @OneToOne(() => ClientEntity, (client) => client.billing)
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ type: 'enum', enum: BillingType })
  type: BillingType;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ name: 'discount_type', type: 'enum', enum: DiscountType, nullable: true })
  discountType: DiscountType | null;

  @Column({ name: 'discount_value', type: 'decimal', precision: 10, scale: 2, nullable: true })
  discountValue: number | null;

  @Column({ name: 'payment_method', type: 'enum', enum: PaymentMethod })
  paymentMethod: PaymentMethod;

  @Column({ name: 'due_day' })
  dueDay: number;

  @Column({ type: 'enum', enum: BillingStatus })
  status: BillingStatus;

  @Column({ name: 'last_paid_at', type: 'timestamptz', nullable: true })
  lastPaidAt: Date | null;
}
```

- [ ] **Step 2: Atualizar `client.entity.ts` com novos campos + relação billing**

Substituir o conteúdo atual por:

```typescript
// src/modules/clients/entities/client.entity.ts
import { Column, Entity, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { ClientBillingEntity } from './client-billing.entity.js';

@Entity('clients')
export class ClientEntity extends BaseEntity {
  @Column({ length: 200 })
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ length: 20, nullable: true })
  phone: string | null;

  @Column({ name: 'whatsapp_group_code', length: 200, nullable: true })
  whatsappGroupCode: string | null;

  @Column({ name: 'google_drive_folder_url', type: 'text', nullable: true })
  googleDriveFolderUrl: string | null;

  @OneToOne(() => ClientBillingEntity, (billing) => billing.client, { eager: false })
  billing: ClientBillingEntity;
}
```

- [ ] **Step 3: Criar a migration**

```typescript
// src/database/migrations/1780300000000-AddClientBillingAndExpandClients.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientBillingAndExpandClients1780300000000 implements MigrationInterface {
  name = 'AddClientBillingAndExpandClients1780300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "clients"
        ADD COLUMN IF NOT EXISTS "phone"                  character varying(20),
        ADD COLUMN IF NOT EXISTS "whatsapp_group_code"    character varying(200),
        ADD COLUMN IF NOT EXISTS "google_drive_folder_url" text
    `);

    await queryRunner.query(`CREATE TYPE "billing_type"        AS ENUM ('monthly', 'quarterly', 'semiannual', 'annual')`);
    await queryRunner.query(`CREATE TYPE "payment_method_enum" AS ENUM ('pix', 'boleto', 'debit', 'credit')`);
    await queryRunner.query(`CREATE TYPE "billing_status"      AS ENUM ('paid', 'pending', 'overdue')`);
    await queryRunner.query(`CREATE TYPE "discount_type"       AS ENUM ('fixed', 'percentage')`);

    await queryRunner.query(`
      CREATE TABLE "client_billings" (
        "id"             uuid                    NOT NULL DEFAULT gen_random_uuid(),
        "created_at"     TIMESTAMP               NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP               NOT NULL DEFAULT now(),
        "deleted_at"     TIMESTAMP,
        "client_id"      uuid                    NOT NULL,
        "type"           "billing_type"          NOT NULL,
        "amount"         numeric(10,2)           NOT NULL,
        "discount_type"  "discount_type",
        "discount_value" numeric(10,2),
        "payment_method" "payment_method_enum"   NOT NULL,
        "due_day"        integer                 NOT NULL CHECK ("due_day" BETWEEN 1 AND 31),
        "status"         "billing_status"        NOT NULL,
        "last_paid_at"   TIMESTAMPTZ,
        CONSTRAINT "PK_client_billings"           PRIMARY KEY ("id"),
        CONSTRAINT "UQ_client_billings_client_id" UNIQUE ("client_id"),
        CONSTRAINT "FK_client_billings_client_id" FOREIGN KEY ("client_id")
          REFERENCES "clients"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "client_billings"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "discount_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "billing_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payment_method_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "billing_type"`);
    await queryRunner.query(`
      ALTER TABLE "clients"
        DROP COLUMN IF EXISTS "google_drive_folder_url",
        DROP COLUMN IF EXISTS "whatsapp_group_code",
        DROP COLUMN IF EXISTS "phone"
    `);
  }
}
```

- [ ] **Step 4: Atualizar `clients.module.ts` para incluir `ClientBillingEntity`**

```typescript
// src/modules/clients/clients.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientEntity } from './entities/client.entity.js';
import { ClientBillingEntity } from './entities/client-billing.entity.js';
import { ClientsController } from './clients.controller.js';
import { ClientsService } from './clients.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([ClientEntity, ClientBillingEntity])],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
```

- [ ] **Step 5: Rodar a migration e verificar**

```bash
npm run build && npx typeorm migration:run -d dist/config/datasource.js
```

Esperado: `Migration AddClientBillingAndExpandClients1780300000000 has been executed successfully.`

- [ ] **Step 6: Commit**

```bash
git add src/modules/clients/entities/client-billing.entity.ts \
        src/modules/clients/entities/client.entity.ts \
        src/modules/clients/clients.module.ts \
        src/database/migrations/1780300000000-AddClientBillingAndExpandClients.ts
git commit -m "feat: add ClientBillingEntity and expand ClientEntity with phone/whatsapp/drive fields"
```

---

### Task 2: DTOs + ClientsService + Testes

**Files:**
- Create: `src/modules/clients/dto/create-client-billing.dto.ts`
- Modify: `src/modules/clients/dto/create-client.dto.ts`
- Modify: `src/modules/clients/dto/update-client.dto.ts`
- Modify: `src/modules/clients/clients.service.ts`
- Modify: `src/modules/clients/clients.service.spec.ts`

**Interfaces:**
- Consumes: `ClientBillingEntity`, enums de Task 1
- Produces: `CreateClientBillingDto`, `UpdateClientDto` com `billing?` — usados pelo frontend via API

---

- [ ] **Step 1: Escrever os testes falhando para o novo comportamento do service**

Substituir o conteúdo de `clients.service.spec.ts` pelo seguinte (preserva os testes existentes e adiciona os novos):

```typescript
// src/modules/clients/clients.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ClientsService } from './clients.service.js';
import { ClientEntity } from './entities/client.entity.js';
import { ClientBillingEntity, BillingType, BillingStatus, PaymentMethod } from './entities/client-billing.entity.js';

const mockBilling: ClientBillingEntity = {
  id: 'billing-1',
  clientId: 'uuid-1',
  type: BillingType.MONTHLY,
  amount: 1500,
  discountType: null,
  discountValue: null,
  paymentMethod: PaymentMethod.PIX,
  dueDay: 10,
  status: BillingStatus.PAID,
  lastPaidAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
} as ClientBillingEntity;

const mockClient: ClientEntity = {
  id: 'uuid-1',
  name: 'Agência XYZ',
  email: 'contato@xyz.com',
  isActive: true,
  phone: null,
  whatsappGroupCode: null,
  googleDriveFolderUrl: null,
  billing: mockBilling,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
} as ClientEntity;

const mockRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  softRemove: jest.fn(),
};

const mockBillingRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
};

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

describe('ClientsService', () => {
  let service: ClientsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: getRepositoryToken(ClientEntity), useValue: mockRepo },
        { provide: getRepositoryToken(ClientBillingEntity), useValue: mockBillingRepo },
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);
  });

  describe('create', () => {
    it('should create client without billing', async () => {
      const clientOnly = { ...mockClient, billing: undefined as any };
      mockRepo.create.mockReturnValue(clientOnly);
      mockRepo.save.mockResolvedValueOnce(clientOnly);
      mockRepo.findOne.mockResolvedValue(clientOnly);

      const result = await service.create({ name: 'Agência XYZ', email: 'contato@xyz.com' });

      expect(result).toEqual(clientOnly);
      expect(mockBillingRepo.save).not.toHaveBeenCalled();
    });

    it('should create client with billing when billing is provided', async () => {
      const clientOnly = { ...mockClient, billing: undefined as any };
      mockRepo.create.mockReturnValue(clientOnly);
      mockRepo.save.mockResolvedValueOnce(clientOnly);
      mockBillingRepo.create.mockReturnValue({ ...mockBilling });
      mockBillingRepo.save.mockResolvedValue(mockBilling);
      mockRepo.findOne.mockResolvedValue(mockClient);

      const result = await service.create({
        name: 'Agência XYZ',
        email: 'contato@xyz.com',
        billing: {
          type: BillingType.MONTHLY,
          amount: 1500,
          paymentMethod: PaymentMethod.PIX,
          dueDay: 10,
          status: BillingStatus.PAID,
        },
      });

      expect(mockBillingRepo.save).toHaveBeenCalledTimes(1);
      expect(result.billing).toEqual(mockBilling);
    });

    it('should throw ConflictException on duplicate email', async () => {
      mockRepo.create.mockReturnValue(mockClient);
      const dbError = new QueryFailedError('', [], new Error('duplicate key'));
      (dbError as QueryFailedError & { code: string }).code = '23505';
      mockRepo.save.mockRejectedValue(dbError);

      await expect(service.create({ name: 'Agência XYZ', email: 'contato@xyz.com' })).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return active clients with billing relation', async () => {
      mockRepo.find.mockResolvedValue([mockClient]);

      const result = await service.findAll();

      expect(result).toEqual([mockClient]);
      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        relations: ['billing'],
      });
    });
  });

  describe('findOne', () => {
    it('should return cached client without hitting the repository', async () => {
      mockCache.get.mockResolvedValue(mockClient);

      const result = await service.findOne('uuid-1');

      expect(result).toEqual(mockClient);
      expect(mockRepo.findOne).not.toHaveBeenCalled();
    });

    it('should query repository with billing relation on cache miss', async () => {
      mockCache.get.mockResolvedValue(null);
      mockRepo.findOne.mockResolvedValue(mockClient);

      const result = await service.findOne('uuid-1');

      expect(result).toEqual(mockClient);
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        relations: ['billing'],
      });
    });

    it('should throw NotFoundException when client does not exist', async () => {
      mockCache.get.mockResolvedValue(null);
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update client and invalidate cache', async () => {
      mockCache.get.mockResolvedValue(mockClient);
      mockRepo.save.mockResolvedValue({ ...mockClient, name: 'Novo Nome' });
      mockRepo.findOne.mockResolvedValue({ ...mockClient, name: 'Novo Nome' });

      const result = await service.update('uuid-1', { name: 'Novo Nome' });

      expect(result.name).toBe('Novo Nome');
      expect(mockCache.del).toHaveBeenCalledWith('client:id:uuid-1');
    });

    it('should upsert billing on update when billing is provided', async () => {
      mockCache.get.mockResolvedValue(mockClient);
      mockRepo.save.mockResolvedValue(mockClient);
      mockBillingRepo.findOne.mockResolvedValue(mockBilling);
      mockBillingRepo.save.mockResolvedValue({ ...mockBilling, amount: 2000 });
      mockRepo.findOne.mockResolvedValue({ ...mockClient, billing: { ...mockBilling, amount: 2000 } });

      await service.update('uuid-1', { billing: { amount: 2000 } });

      expect(mockBillingRepo.save).toHaveBeenCalledWith({ ...mockBilling, amount: 2000 });
    });
  });

  describe('remove', () => {
    it('should soft remove client and invalidate cache', async () => {
      mockCache.get.mockResolvedValue(mockClient);
      mockRepo.softRemove.mockResolvedValue(undefined);

      await service.remove('uuid-1');

      expect(mockRepo.softRemove).toHaveBeenCalledWith(mockClient);
      expect(mockCache.del).toHaveBeenCalledWith('client:id:uuid-1');
    });
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

```bash
npx jest --testPathPattern=clients.service.spec
```

Esperado: falhas em `findAll` (asserting `relations: ['billing']`) e nos testes de billing.

- [ ] **Step 3: Criar `create-client-billing.dto.ts`**

```typescript
// src/modules/clients/dto/create-client-billing.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import {
  BillingStatus,
  BillingType,
  DiscountType,
  PaymentMethod,
} from '../entities/client-billing.entity.js';

export class CreateClientBillingDto {
  @ApiProperty({ enum: BillingType, example: BillingType.MONTHLY })
  @IsEnum(BillingType)
  type: BillingType;

  @ApiProperty({ example: 1500.00 })
  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @ApiPropertyOptional({ enum: DiscountType })
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @ApiPropertyOptional({ example: 100.00, description: 'Valor ou percentual do desconto' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  discountValue?: number;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.PIX })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiProperty({ example: 10, description: 'Dia do mês de vencimento (1–31)' })
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay: number;

  @ApiProperty({ enum: BillingStatus, example: BillingStatus.PENDING })
  @IsEnum(BillingStatus)
  status: BillingStatus;
}
```

- [ ] **Step 4: Atualizar `create-client.dto.ts`**

```typescript
// src/modules/clients/dto/create-client.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CreateClientBillingDto } from './create-client-billing.dto.js';

export class CreateClientDto {
  @ApiProperty({ example: 'Agência XYZ', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({ example: 'contato@agenciaxyz.com.br' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: '(32) 99999-0000' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: '120363000000000000@g.us', description: 'JID do grupo WhatsApp' })
  @IsOptional()
  @IsString()
  whatsappGroupCode?: string;

  @ApiPropertyOptional({ example: 'https://drive.google.com/drive/folders/xxx' })
  @IsOptional()
  @IsString()
  googleDriveFolderUrl?: string;

  @ApiPropertyOptional({ type: () => CreateClientBillingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateClientBillingDto)
  billing?: CreateClientBillingDto;
}
```

- [ ] **Step 5: Atualizar `update-client.dto.ts`**

```typescript
// src/modules/clients/dto/update-client.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { CreateClientDto } from './create-client.dto.js';
import { CreateClientBillingDto } from './create-client-billing.dto.js';

export class UpdateClientBillingDto extends PartialType(CreateClientBillingDto) {}

export class UpdateClientDto extends PartialType(CreateClientDto) {
  @ApiPropertyOptional({ type: () => UpdateClientBillingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateClientBillingDto)
  billing?: UpdateClientBillingDto;
}
```

- [ ] **Step 6: Substituir `clients.service.ts` com suporte a billing**

```typescript
// src/modules/clients/clients.service.ts
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
    return this.repo.findOne({ where: { id: client.id }, relations: ['billing'] }) as Promise<ClientEntity>;
  }

  findAll(): Promise<ClientEntity[]> {
    return this.repo.find({ where: { isActive: true }, relations: ['billing'] });
  }

  async findOne(id: string): Promise<ClientEntity> {
    const cached = await this.cache.get<ClientEntity>(cacheKey(id));
    if (cached) return cached;

    const client = await this.repo.findOne({ where: { id }, relations: ['billing'] });
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
        await this.billingRepo.save(this.billingRepo.create({ ...billing, clientId: id } as any));
      }
    }

    await this.cache.del(cacheKey(id));
    return this.repo.findOne({ where: { id }, relations: ['billing'] }) as Promise<ClientEntity>;
  }

  async remove(id: string): Promise<void> {
    const client = await this.findOne(id);
    await this.repo.softRemove(client);
    await this.cache.del(cacheKey(id));
  }
}
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

```bash
npx jest --testPathPattern=clients.service.spec
```

Esperado: todos os testes passando.

- [ ] **Step 8: Rodar todos os testes do projeto para checar regressões**

```bash
npm run test
```

Esperado: zero falhas.

- [ ] **Step 9: Commit**

```bash
git add src/modules/clients/dto/ src/modules/clients/clients.service.ts src/modules/clients/clients.service.spec.ts
git commit -m "feat: add billing DTO, update ClientsService to handle ClientBillingEntity"
```

---

### Task 3: Tornar `clientId` opcional em `GET /report-dispatches`

**Files:**
- Modify: `src/modules/report-dispatches/report-dispatches.controller.ts`
- Modify: `src/modules/report-dispatches/report-dispatches.service.ts`
- Modify: `src/modules/report-dispatches/report-dispatches.service.spec.ts`

**Interfaces:**
- Produces: `GET /report-dispatches` sem `clientId` retorna todos os logs — necessário para a página `/relatorios` do frontend

---

- [ ] **Step 1: Escrever o teste falhando**

Abrir `src/modules/report-dispatches/report-dispatches.service.spec.ts` e adicionar dentro do `describe('findLogs')` (ou criar se não existir):

```typescript
it('should return all logs when clientId is not provided', async () => {
  const allLogs = [
    { id: 'log-1', clientId: 'client-1' },
    { id: 'log-2', clientId: 'client-2' },
  ];
  mockLogRepo.find.mockResolvedValue(allLogs);

  const result = await service.findLogs(undefined);

  expect(result).toEqual(allLogs);
  expect(mockLogRepo.find).toHaveBeenCalledWith({
    where: {},
    order: { createdAt: 'DESC' },
  });
});

it('should filter by clientId when provided', async () => {
  const filtered = [{ id: 'log-1', clientId: 'client-1' }];
  mockLogRepo.find.mockResolvedValue(filtered);

  const result = await service.findLogs('client-1');

  expect(result).toEqual(filtered);
  expect(mockLogRepo.find).toHaveBeenCalledWith({
    where: { clientId: 'client-1' },
    order: { createdAt: 'DESC' },
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
npx jest --testPathPattern=report-dispatches.service.spec
```

Esperado: `TypeError` ou falha de assertion pois `findLogs` não aceita `undefined`.

- [ ] **Step 3: Atualizar `findLogs` no service**

Localizar `findLogs` em `src/modules/report-dispatches/report-dispatches.service.ts` e substituir:

```typescript
// Antes:
async findLogs(clientId: string): Promise<ReportDispatchLogEntity[]> {
  return this.logRepo.find({
    where: { clientId },
    order: { createdAt: 'DESC' },
  });
}

// Depois:
async findLogs(clientId?: string): Promise<ReportDispatchLogEntity[]> {
  return this.logRepo.find({
    where: clientId ? { clientId } : {},
    order: { createdAt: 'DESC' },
  });
}
```

- [ ] **Step 4: Atualizar o controller para tornar `clientId` opcional**

Localizar o método `findLogs` em `src/modules/report-dispatches/report-dispatches.controller.ts` e substituir:

```typescript
// Antes:
@Get()
@ApiOperation({ summary: 'Listar histórico de despachos de um cliente' })
@ApiQuery({ name: 'clientId', required: true, type: String })
findLogs(@Query('clientId') clientId: string) {
  return this.reportDispatchesService.findLogs(clientId);
}

// Depois:
@Get()
@ApiOperation({ summary: 'Listar histórico de despachos (todos ou por cliente)' })
@ApiQuery({ name: 'clientId', required: false, type: String })
findLogs(@Query('clientId') clientId?: string) {
  return this.reportDispatchesService.findLogs(clientId);
}
```

- [ ] **Step 5: Atualizar a interface do service se existir**

Abrir `src/modules/report-dispatches/interfaces/report-dispatches-service.interface.ts` e ajustar a assinatura:

```typescript
findLogs(clientId?: string): Promise<ReportDispatchLogEntity[]>;
```

- [ ] **Step 6: Rodar os testes**

```bash
npm run test
```

Esperado: todos os testes passando.

- [ ] **Step 7: Commit**

```bash
git add src/modules/report-dispatches/
git commit -m "feat: make clientId optional on GET /report-dispatches to support general history view"
```
