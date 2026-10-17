import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { BillingPolicy } from '../billing-calculator';

export type BillingConfigurationStatus = 'DRAFT' | 'APPROVED' | 'SUSPENDED';

/** Finance-approved immutable policy content; changed rules require a new row. */
@Entity('billing_configurations')
@Index(['serviceCenterId', 'version'], { unique: true })
export class BillingConfiguration {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'service_center_id', type: 'uuid' }) serviceCenterId: string;
  @Column({ type: 'integer' }) version: number;
  @Column({ type: 'varchar', length: 16 }) status: BillingConfigurationStatus;
  @Column({ type: 'jsonb' }) policy: BillingPolicy;
  @Column({ name: 'created_by', type: 'varchar', length: 255 })
  createdBy: string;
  @Column({ name: 'approved_by', type: 'varchar', length: 255, nullable: true })
  approvedBy: string | null;
  @Column({
    name: 'evidence_reference',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  evidenceReference: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;
}
