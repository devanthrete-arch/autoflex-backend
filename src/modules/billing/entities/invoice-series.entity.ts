import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('invoice_series')
@Index(['sellerKey', 'financialYear', 'seriesPrefix'], { unique: true })
export class InvoiceSeries {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'service_center_id', type: 'uuid' }) serviceCenterId: string;
  /** GSTIN where registered; otherwise an approved stable seller identity. */
  @Column({ name: 'seller_key', type: 'varchar', length: 100 })
  sellerKey: string;
  @Column({ name: 'financial_year', type: 'varchar', length: 9 })
  financialYear: string;
  @Column({ name: 'series_prefix', type: 'varchar', length: 4 })
  seriesPrefix: string;
  @Column({ name: 'next_number', type: 'integer', default: 1 })
  nextNumber: number;
}
