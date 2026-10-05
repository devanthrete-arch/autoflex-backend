import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Invoice } from './invoice.entity';

/** Billing snapshot; the job's own lines stay operational. */
@Entity('invoice_line_items')
export class InvoiceLineItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @ManyToOne(() => Invoice, (invoice) => invoice.lineItems, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ name: 'source_line_item_id', type: 'uuid', nullable: true })
  sourceLineItemId: string | null;

  /** `LABOUR`, `PART`, `FEE`, or `ADJUSTMENT`. */
  @Column({ type: 'varchar', length: 16 })
  kind: string;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ name: 'part_type', type: 'varchar', length: 8, nullable: true })
  partType: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 1 })
  quantity: string;

  @Column({ name: 'unit_price_inr', type: 'numeric', precision: 12, scale: 2 })
  unitPriceInr: string;

  @Column({ name: 'amount_inr', type: 'numeric', precision: 12, scale: 2 })
  amountInr: string;

  @Column({
    name: 'tax_rate_pct',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 0,
  })
  taxRatePct: string;

  @Column({
    name: 'tax_inr',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  taxInr: string;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;
}
