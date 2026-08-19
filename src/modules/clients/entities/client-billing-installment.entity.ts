import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/database/base.entity.js';
import { ClientBillingEntity } from './client-billing.entity.js';

@Entity('client_billing_installments')
export class ClientBillingInstallmentEntity extends BaseEntity {
  @Column({ name: 'client_billing_id' })
  clientBillingId: string;

  @ManyToOne(() => ClientBillingEntity, (billing) => billing.installments)
  @JoinColumn({ name: 'client_billing_id' })
  billing: ClientBillingEntity;

  @Column({ name: 'installment_number' })
  installmentNumber: number;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;
}
