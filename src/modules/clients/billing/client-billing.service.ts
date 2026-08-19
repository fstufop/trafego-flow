// src/modules/clients/billing/client-billing.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClientBillingEntity, ContractStatus } from '../entities/client-billing.entity.js';
import { ClientBillingInstallmentEntity } from '../entities/client-billing-installment.entity.js';
import { CreateClientBillingDto } from '../dto/create-client-billing.dto.js';
import { RenewClientBillingDto } from '../dto/renew-client-billing.dto.js';
import {
  ClientBillingResponseDto,
  InstallmentResponseDto,
  toClientBillingResponseDto,
  toInstallmentResponseDto,
} from '../dto/client-billing-response.dto.js';
import { generateInstallmentDates } from './installment-dates.helper.js';

@Injectable()
export class ClientBillingService {
  constructor(
    @InjectRepository(ClientBillingEntity)
    private readonly billingRepo: Repository<ClientBillingEntity>,
    @InjectRepository(ClientBillingInstallmentEntity)
    private readonly installmentRepo: Repository<ClientBillingInstallmentEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async createBilling(clientId: string, dto: CreateClientBillingDto): Promise<ClientBillingResponseDto> {
    const existing = await this.billingRepo.findOne({
      where: { clientId, contractStatus: ContractStatus.ACTIVE },
    });
    if (existing) throw new ConflictException('Client already has an active contract');

    return this.dataSource.transaction(async (manager) => {
      const billing = await manager.save(
        manager.create(ClientBillingEntity, {
          clientId,
          startDate: new Date(dto.startDate),
          durationMonths: dto.durationMonths,
          amount: dto.amount,
          dueDay: dto.dueDay,
          paymentMethod: dto.paymentMethod,
          discountType: dto.discountType ?? null,
          discountValue: dto.discountValue ?? null,
          contractStatus: ContractStatus.ACTIVE,
        }),
      );

      const dueDates = generateInstallmentDates(new Date(dto.startDate), dto.dueDay, dto.durationMonths);
      const installments = await manager.save(
        dueDates.map((dueDate, i) =>
          manager.create(ClientBillingInstallmentEntity, {
            clientBillingId: billing.id,
            installmentNumber: i + 1,
            dueDate,
            paidAt: null,
          }),
        ),
      );

      return toClientBillingResponseDto(billing, installments);
    });
  }

  async listBillings(clientId: string): Promise<ClientBillingResponseDto[]> {
    const billings = await this.billingRepo.find({
      where: { clientId },
      relations: { installments: true },
      order: { createdAt: 'DESC' },
    });
    return billings.map((b) => toClientBillingResponseDto(b, b.installments));
  }

  async getActiveBilling(clientId: string): Promise<ClientBillingResponseDto> {
    const billing = await this.billingRepo.findOne({
      where: { clientId, contractStatus: ContractStatus.ACTIVE },
      relations: { installments: true },
    });
    if (!billing) throw new NotFoundException(`No active contract for client ${clientId}`);
    return toClientBillingResponseDto(billing, billing.installments);
  }

  async renewBilling(
    clientId: string,
    billingId: string,
    dto: RenewClientBillingDto,
  ): Promise<ClientBillingResponseDto> {
    const current = await this.billingRepo.findOne({ where: { id: billingId, clientId } });
    if (!current) throw new NotFoundException(`Contract ${billingId} not found for client ${clientId}`);
    if (current.contractStatus !== ContractStatus.ACTIVE) {
      throw new BadRequestException('Only active contracts can be renewed');
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.update(ClientBillingEntity, { id: billingId }, { contractStatus: ContractStatus.EXPIRED });

      const effectiveDueDay = dto.dueDay ?? current.dueDay;
      const newBilling = await manager.save(
        manager.create(ClientBillingEntity, {
          clientId,
          startDate: new Date(dto.startDate),
          durationMonths: dto.durationMonths,
          amount: dto.amount ?? current.amount,
          dueDay: effectiveDueDay,
          paymentMethod: dto.paymentMethod ?? current.paymentMethod,
          discountType: dto.discountType ?? current.discountType,
          discountValue: dto.discountValue ?? current.discountValue,
          contractStatus: ContractStatus.ACTIVE,
        }),
      );

      const dueDates = generateInstallmentDates(new Date(dto.startDate), effectiveDueDay, dto.durationMonths);
      const installments = await manager.save(
        dueDates.map((dueDate, i) =>
          manager.create(ClientBillingInstallmentEntity, {
            clientBillingId: newBilling.id,
            installmentNumber: i + 1,
            dueDate,
            paidAt: null,
          }),
        ),
      );

      return toClientBillingResponseDto(newBilling, installments);
    });
  }

  async cancelBilling(clientId: string, billingId: string): Promise<ClientBillingResponseDto> {
    const billing = await this.billingRepo.findOne({
      where: { id: billingId, clientId },
      relations: { installments: true },
    });
    if (!billing) throw new NotFoundException(`Contract ${billingId} not found for client ${clientId}`);
    if (billing.contractStatus === ContractStatus.CANCELLED) {
      throw new BadRequestException('Contract is already cancelled');
    }

    await this.billingRepo.update({ id: billingId }, { contractStatus: ContractStatus.CANCELLED });
    billing.contractStatus = ContractStatus.CANCELLED;
    return toClientBillingResponseDto(billing, billing.installments);
  }

  async payInstallment(
    clientId: string,
    billingId: string,
    installmentId: string,
  ): Promise<InstallmentResponseDto> {
    const billing = await this.billingRepo.findOne({ where: { id: billingId, clientId } });
    if (!billing) throw new NotFoundException(`Contract ${billingId} not found for client ${clientId}`);

    const installment = await this.installmentRepo.findOne({
      where: { id: installmentId, clientBillingId: billingId },
    });
    if (!installment) throw new NotFoundException(`Installment ${installmentId} not found`);
    if (installment.paidAt) throw new BadRequestException('Installment is already paid');

    installment.paidAt = new Date();
    const saved = await this.installmentRepo.save(installment);
    return toInstallmentResponseDto(saved);
  }
}
