import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { ClientEntity } from './client.entity.js';
import { ClientBillingInstallmentEntity } from './client-billing-installment.entity.js';

export enum ContractStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export enum PaymentMethod {
  PIX = 'pix',
  BOLETO = 'boleto',
  DEBIT = 'debit',
  CREDIT = 'credit',
}

export enum DiscountType {
  FIXED = 'fixed',
  PERCENTAGE = 'percentage',
}

const decimalTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value != null ? parseFloat(value) : null),
};

@Entity('client_billings')
export class ClientBillingEntity extends BaseEntity {
  @Column({ name: 'client_id' })
  clientId: string;

  @ManyToOne(() => ClientEntity, (client) => client.billings)
  @JoinColumn({ name: 'client_id' })
  client: ClientEntity;

  @Column({ name: 'start_date', type: 'date' })
  startDate: Date;

  @Column({ name: 'duration_months' })
  durationMonths: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, transformer: decimalTransformer })
  amount: number;

  @Column({ name: 'discount_type', type: 'enum', enum: DiscountType, nullable: true })
  discountType: DiscountType | null;

  @Column({
    name: 'discount_value',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  discountValue: number | null;

  @Column({ name: 'payment_method', type: 'enum', enum: PaymentMethod })
  paymentMethod: PaymentMethod;

  @Column({ name: 'due_day' })
  dueDay: number;

  @Column({ name: 'contract_status', type: 'enum', enum: ContractStatus })
  contractStatus: ContractStatus;

  @OneToMany(() => ClientBillingInstallmentEntity, (inst) => inst.billing, { cascade: true })
  installments: ClientBillingInstallmentEntity[];
}
