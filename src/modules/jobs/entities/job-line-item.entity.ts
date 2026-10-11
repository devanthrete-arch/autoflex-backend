import type { ServiceScope } from '../../offerings/entities/service-package.entity';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  JobLineKind,
  JobLineStatus,
  PartType,
} from '../../../common/enums/job-work.enum';
import { JobApproval } from './job-approval.entity';
import { ServiceJob } from './service-job.entity';

@Entity('service_job_line_items')
export class JobLineItem {
  @Column({ type: 'jsonb', default: () => "'[]'" })
  scope: ServiceScope[];

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'job_id', type: 'uuid' })
  jobId: string;

  @ManyToOne(() => ServiceJob, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id' })
  job: ServiceJob;

  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;

  @Column({ type: 'enum', enum: JobLineKind, enumName: 'job_line_kind_enum' })
  kind: JobLineKind;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ name: 'part_type', type: 'varchar', length: 8, nullable: true })
  partType: PartType | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 1 })
  quantity: string;

  @Column({ name: 'unit_price_inr', type: 'numeric', precision: 12, scale: 2 })
  unitPriceInr: string;

  @Column({ name: 'amount_inr', type: 'numeric', precision: 12, scale: 2 })
  amountInr: string;

  @Column({
    type: 'enum',
    enum: JobLineStatus,
    enumName: 'job_line_status_enum',
  })
  status: JobLineStatus;

  @Column({ name: 'approval_id', type: 'uuid', nullable: true })
  approvalId: string | null;

  @ManyToOne(() => JobApproval, (approval) => approval.lineItems, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'approval_id' })
  approval: JobApproval | null;

  @Column({ name: 'source_booking_item_id', type: 'uuid', nullable: true })
  sourceBookingItemId: string | null;

  @Column({
    name: 'created_by_staff_profile_id',
    type: 'uuid',
    nullable: true,
  })
  createdByStaffProfileId: string | null;

  /** Set when a replaced part was handed back to the owner at pickup. */
  @Column({ name: 'part_returned_at', type: 'timestamptz', nullable: true })
  partReturnedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
