// src/modules/clients/billing/client-billing.service.spec.ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClientBillingService } from './client-billing.service.js';
import { ClientBillingEntity, ContractStatus, PaymentMethod } from '../entities/client-billing.entity.js';
import { ClientBillingInstallmentEntity } from '../entities/client-billing-installment.entity.js';
import { CreateClientBillingDto } from '../dto/create-client-billing.dto.js';

const makeBillingRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  update: jest.fn(),
  create: jest.fn((data: unknown) => data),
  save: jest.fn(async (e: unknown) => e),
});

const makeInstallmentRepo = () => ({
  findOne: jest.fn(),
  save: jest.fn(async (e: unknown) => e),
  create: jest.fn((data: unknown) => data),
});

const makeManager = () => ({
  create: jest.fn((_, data: unknown) => ({ id: 'new-id', ...data as object })),
  save: jest.fn(async (e: unknown) => Array.isArray(e)
    ? (e as unknown[]).map((x, i) => ({ id: `inst-${i}`, ...x as object }))
    : { id: 'saved-id', ...e as object }),
  update: jest.fn(),
});

const makeDataSource = (manager = makeManager()) => ({
  transaction: jest.fn((cb: (m: ReturnType<typeof makeManager>) => Promise<unknown>) => cb(manager)),
});

describe('ClientBillingService', () => {
  let service: ClientBillingService;
  let billingRepo: ReturnType<typeof makeBillingRepo>;
  let installmentRepo: ReturnType<typeof makeInstallmentRepo>;

  beforeEach(async () => {
    billingRepo = makeBillingRepo();
    installmentRepo = makeInstallmentRepo();

    const module = await Test.createTestingModule({
      providers: [
        ClientBillingService,
        { provide: getRepositoryToken(ClientBillingEntity), useValue: billingRepo },
        { provide: getRepositoryToken(ClientBillingInstallmentEntity), useValue: installmentRepo },
        { provide: DataSource, useValue: makeDataSource() },
      ],
    }).compile();

    service = module.get(ClientBillingService);
  });

  describe('createBilling', () => {
    const dto: CreateClientBillingDto = {
      startDate: new Date(2026, 0, 1),
      durationMonths: 3,
      dueDay: 10,
      amount: 1500,
      paymentMethod: PaymentMethod.PIX,
    };

    it('throws ConflictException when an active contract already exists', async () => {
      billingRepo.findOne.mockResolvedValue({ id: 'existing', contractStatus: ContractStatus.ACTIVE });
      await expect(service.createBilling('client-1', dto)).rejects.toThrow(ConflictException);
    });

    it('creates contract and generates durationMonths installments', async () => {
      billingRepo.findOne.mockResolvedValue(null);
      const result = await service.createBilling('client-1', dto);
      expect(result.installments).toHaveLength(3);
      expect(result.contractStatus).toBe(ContractStatus.ACTIVE);
    });
  });

  describe('getActiveBilling', () => {
    it('throws NotFoundException when no active contract exists', async () => {
      billingRepo.findOne.mockResolvedValue(null);
      await expect(service.getActiveBilling('client-1')).rejects.toThrow(NotFoundException);
    });

    it('returns the active billing with enriched installment statuses', async () => {
      const futureDate = new Date(Date.now() + 86400000 * 30); // 30 days ahead
      billingRepo.findOne.mockResolvedValue({
        id: 'billing-1',
        clientId: 'client-1',
        startDate: new Date(2026, 0, 1),
        durationMonths: 1,
        amount: 1500,
        discountType: null,
        discountValue: null,
        paymentMethod: PaymentMethod.PIX,
        dueDay: 10,
        contractStatus: ContractStatus.ACTIVE,
        installments: [{ id: 'inst-1', installmentNumber: 1, dueDate: futureDate, paidAt: null }],
      });
      const result = await service.getActiveBilling('client-1');
      expect(result.installments[0].status).toBe('pending');
    });
  });

  describe('renewBilling', () => {
    it('throws NotFoundException when contract not found', async () => {
      billingRepo.findOne.mockResolvedValue(null);
      await expect(
        service.renewBilling('client-1', 'billing-1', { startDate: new Date(), durationMonths: 6 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when contract is not active', async () => {
      billingRepo.findOne.mockResolvedValue({ id: 'billing-1', clientId: 'client-1', contractStatus: ContractStatus.EXPIRED });
      await expect(
        service.renewBilling('client-1', 'billing-1', { startDate: new Date(), durationMonths: 6 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelBilling', () => {
    it('throws NotFoundException when contract not found', async () => {
      billingRepo.findOne.mockResolvedValue(null);
      await expect(service.cancelBilling('client-1', 'billing-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when already cancelled', async () => {
      billingRepo.findOne.mockResolvedValue({
        id: 'billing-1',
        contractStatus: ContractStatus.CANCELLED,
        installments: [],
      });
      await expect(service.cancelBilling('client-1', 'billing-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('payInstallment', () => {
    it('throws NotFoundException when contract not found', async () => {
      billingRepo.findOne.mockResolvedValue(null);
      await expect(service.payInstallment('client-1', 'billing-1', 'inst-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when installment not found', async () => {
      billingRepo.findOne.mockResolvedValue({ id: 'billing-1' });
      installmentRepo.findOne.mockResolvedValue(null);
      await expect(service.payInstallment('client-1', 'billing-1', 'inst-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when installment is already paid', async () => {
      billingRepo.findOne.mockResolvedValue({ id: 'billing-1' });
      installmentRepo.findOne.mockResolvedValue({ id: 'inst-1', paidAt: new Date() });
      await expect(service.payInstallment('client-1', 'billing-1', 'inst-1')).rejects.toThrow(BadRequestException);
    });

    it('sets paidAt and returns paid status', async () => {
      billingRepo.findOne.mockResolvedValue({ id: 'billing-1' });
      const installment = { id: 'inst-1', installmentNumber: 1, dueDate: new Date(2026, 0, 10), paidAt: null };
      installmentRepo.findOne.mockResolvedValue(installment);
      installmentRepo.save.mockResolvedValue({ ...installment, paidAt: new Date() });
      const result = await service.payInstallment('client-1', 'billing-1', 'inst-1');
      expect(result.status).toBe('paid');
    });
  });
});
