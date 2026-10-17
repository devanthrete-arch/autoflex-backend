import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InvoiceStatus } from '../../../common/enums/ownership.enum';
import { ServiceJob } from '../../jobs/entities/service-job.entity';
import { ServiceCenter } from '../../tenancy/entities/service-center.entity';
import { InvoiceLineItem } from './invoice-line-item.entity';
import { Payment } from './payment.entity';

export interface InvoiceParty {
  name: string | null;
  phone?: string | null;
  gstin?: string | null;
  address?: string | null;
  vehicleRegistration?: string | null;
  vehicleLabel?: string | null;
  type?: 'INDIVIDUAL' | 'BUSINESS';
  stateCode?: string;
  pin?: string;
}

/** The bill for one job. Seller, buyer, and lines are copies made at issue. */
@Entity('invoices')
export class Invoice {
  @Column({ name: 'voided_at', type: 'timestamptz', nullable: true })
  voidedAt: Date | null;
  @Column({ name: 'void_reason', type: 'varchar', length: 500, nullable: true })
  voidReason: string | null;
  @Column({ name: 'replacement_for_invoice_id', type: 'uuid', nullable: true })
  replacementForInvoiceId: string | null;
  @Column({ name: 'schema_version', type: 'integer', default: 1 })
  schemaVersion: number;

  @Column({
    name: 'document_kind',
    type: 'varchar',
    length: 32,
    default: 'LEGACY_BILL',
  })
  documentKind: string;

  @Column({ name: 'billing_snapshot', type: 'jsonb', nullable: true })
  billingSnapshot: Record<string, unknown> | null;

  @Column({
    name: 'snapshot_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  snapshotHash: string | null;
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;

  @ManyToOne(() => ServiceCenter, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_center_id' })
  serviceCenter: ServiceCenter;

  @Column({ name: 'job_id', type: 'uuid' })
  jobId: string;

  @ManyToOne(() => ServiceJob, (job) => job.invoices, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'job_id' })
  job: ServiceJob;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'customer_profile_id', type: 'uuid', nullable: true })
  customerProfileId: string | null;

  /** `INV-YYYYMMDD-XXXX`. GST series numbering arrives with tax invoices. */
  @Column({ name: 'invoice_number', type: 'varchar', length: 20 })
  invoiceNumber: string;

  @Column({
    type: 'enum',
    enum: InvoiceStatus,
    enumName: 'invoice_status_enum',
    default: InvoiceStatus.DUE,
  })
  status: InvoiceStatus;

  @Column({ name: 'subtotal_inr', type: 'numeric', precision: 12, scale: 2 })
  subtotalInr: string;

  /** Signed difference between the billed total and the line subtotal. */
  @Column({
    name: 'adjustment_inr',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  adjustmentInr: string;

  @Column({
    name: 'tax_inr',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  taxInr: string;

  @Column({ name: 'total_inr', type: 'numeric', precision: 12, scale: 2 })
  totalInr: string;

  @Column({
    name: 'paid_inr',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  paidInr: string;

  @Column({ type: 'jsonb' })
  seller: InvoiceParty;

  @Column({ type: 'jsonb' })
  buyer: InvoiceParty;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({
    name: 'issued_by_staff_profile_id',
    type: 'uuid',
    nullable: true,
  })
  issuedByStaffProfileId: string | null;

  @OneToMany(() => InvoiceLineItem, (line) => line.invoice)
  lineItems: InvoiceLineItem[];

  @OneToMany(() => Payment, (payment) => payment.invoice)
  payments: Payment[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
