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
