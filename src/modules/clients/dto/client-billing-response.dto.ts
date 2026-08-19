// src/modules/clients/dto/client-billing-response.dto.ts
import { ContractStatus, DiscountType, PaymentMethod } from '../entities/client-billing.entity.js';
import { ClientBillingEntity } from '../entities/client-billing.entity.js';
import { ClientBillingInstallmentEntity } from '../entities/client-billing-installment.entity.js';

export type InstallmentStatus = 'paid' | 'overdue' | 'pending';

export interface InstallmentResponseDto {
  id: string;
  installmentNumber: number;
  dueDate: Date;
  paidAt: Date | null;
  status: InstallmentStatus;
}

export interface ClientBillingResponseDto {
  id: string;
  clientId: string;
  startDate: Date;
  durationMonths: number;
  amount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  paymentMethod: PaymentMethod;
  dueDay: number;
  contractStatus: ContractStatus;
  installments: InstallmentResponseDto[];
}

export function computeInstallmentStatus(installment: ClientBillingInstallmentEntity): InstallmentStatus {
  if (installment.paidAt) return 'paid';
  const due = installment.dueDate instanceof Date ? installment.dueDate : new Date(installment.dueDate);
  if (due < new Date()) return 'overdue';
  return 'pending';
}

export function toInstallmentResponseDto(installment: ClientBillingInstallmentEntity): InstallmentResponseDto {
  return {
    id: installment.id,
    installmentNumber: installment.installmentNumber,
    dueDate: installment.dueDate,
    paidAt: installment.paidAt,
    status: computeInstallmentStatus(installment),
  };
}

export function toClientBillingResponseDto(
  billing: ClientBillingEntity,
  installments: ClientBillingInstallmentEntity[],
): ClientBillingResponseDto {
  return {
    id: billing.id,
    clientId: billing.clientId,
    startDate: billing.startDate,
    durationMonths: billing.durationMonths,
    amount: billing.amount,
    discountType: billing.discountType,
    discountValue: billing.discountValue,
    paymentMethod: billing.paymentMethod,
    dueDay: billing.dueDay,
    contractStatus: billing.contractStatus,
    installments: [...installments]
      .sort((a, b) => a.installmentNumber - b.installmentNumber)
      .map(toInstallmentResponseDto),
  };
}
