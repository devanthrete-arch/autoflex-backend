import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PaymentMethod } from '../../../common/enums/ownership.enum';
import { Invoice } from './invoice.entity';

/** Money received against an invoice; collection happens at the center. */
@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @ManyToOne(() => Invoice, (invoice) => invoice.payments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;

  @Column({
    type: 'enum',
    enum: PaymentMethod,
    enumName: 'payment_method_enum',
  })
  method: PaymentMethod;

  @Column({ name: 'amount_inr', type: 'numeric', precision: 12, scale: 2 })
  amountInr: string;

  /** UPI transaction id, card slip number, or gateway reference. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  reference: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;

  @Column({
    name: 'received_by_staff_profile_id',
    type: 'uuid',
    nullable: true,
  })
  receivedByStaffProfileId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
