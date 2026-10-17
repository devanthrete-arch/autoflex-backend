import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
@Entity('invoice_documents')
export class InvoiceDocument {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true })
  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId: string | null;
  @Index({ unique: true })
  @Column({ name: 'note_id', type: 'uuid', nullable: true })
  noteId: string | null;
  @Column({ type: 'varchar', length: 16, default: 'PENDING' }) state:
    | 'PENDING'
    | 'RENDERING'
    | 'READY'
    | 'FAILED';
  @Column({ name: 'storage_key', type: 'varchar', length: 255, nullable: true })
  storageKey: string | null;
  @Column({ type: 'varchar', length: 64, nullable: true }) sha256:
    | string
    | null;
  @Column({ type: 'integer', default: 0 }) attempts: number;
  @Column({ name: 'lease_token', type: 'uuid', nullable: true }) leaseToken:
    | string
    | null;
  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil: Date | null;
  @Column({ name: 'retry_at', type: 'timestamptz', nullable: true })
  retryAt: Date | null;
  @Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true })
  errorCode: string | null;
  @Column({ name: 'render_version', type: 'integer', default: 1 })
  renderVersion: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
