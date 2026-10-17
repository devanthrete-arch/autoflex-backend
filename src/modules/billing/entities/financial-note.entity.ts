import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface NoteLine {
  sourceLineId: string;
  description: string;
  classificationCode: string;
  netInr: string;
  cgstInr: string;
  sgstInr: string;
  igstInr: string;
  taxInr: string;
  totalInr: string;
  rateBps: number;
  treatment: string;
}

/** A proposal has no legal number. Issuance seals a separate document. */
@Entity('financial_notes')
export class FinancialNote {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ name: 'invoice_id', type: 'uuid' }) invoiceId: string;
  @Column({ name: 'service_center_id', type: 'uuid' }) serviceCenterId: string;
  @Column({ name: 'customer_profile_id', type: 'uuid' })
  customerProfileId: string;
  @Column({ type: 'varchar', length: 12 }) kind: 'CREDIT' | 'DEBIT';
  @Column({ type: 'varchar', length: 16, default: 'PROPOSED' }) state:
    | 'PROPOSED'
    | 'ACCEPTED'
    | 'DECLINED'
    | 'WITHDRAWN'
    | 'ISSUED';
  @Column({ type: 'integer', default: 1 }) version: number;
  @Column({ type: 'varchar', length: 500 }) reason: string;
  @Column({ type: 'jsonb' }) lines: NoteLine[];
  @Column({ name: 'total_inr', type: 'numeric', precision: 12, scale: 2 })
  totalInr: string;
  @Column({ name: 'snapshot', type: 'jsonb' }) snapshot: Record<
    string,
    unknown
  >;
  @Column({ name: 'proposed_by', type: 'varchar', length: 150 })
  proposedBy: string;
  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;
  @Column({ name: 'issued_by', type: 'varchar', length: 150, nullable: true })
  issuedBy: string | null;
  @Column({
    name: 'evidence_reference',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  evidenceReference: string | null;
  @Column({ name: 'note_number', type: 'varchar', length: 16, nullable: true })
  noteNumber: string | null;
  @Column({ name: 'issued_at', type: 'timestamptz', nullable: true })
  issuedAt: Date | null;
  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
