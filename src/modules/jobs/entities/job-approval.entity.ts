import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { JobStatus } from '../../../common/enums/job-status.enum';
import {
  DecisionChannel,
  JobApprovalStatus,
} from '../../../common/enums/job-work.enum';
import { JobLineItem } from './job-line-item.entity';
import { ServiceJob } from './service-job.entity';

/** One request for extra work. `version` counts requests on the job. */
@Entity('service_job_approvals')
export class JobApproval {
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

  @Column({ type: 'integer' })
  version: number;

  @Column({
    type: 'enum',
    enum: JobApprovalStatus,
    enumName: 'job_approval_status_enum',
    default: JobApprovalStatus.PENDING,
  })
  status: JobApprovalStatus;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'total_inr', type: 'numeric', precision: 12, scale: 2 })
  totalInr: string;

  /** Where the job goes once the request is resolved. */
  @Column({
    name: 'return_status',
    type: 'enum',
    enum: JobStatus,
    enumName: 'job_status_enum',
  })
  returnStatus: JobStatus;

  @Column({
    name: 'requested_by_staff_profile_id',
    type: 'uuid',
    nullable: true,
  })
  requestedByStaffProfileId: string | null;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt: Date;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({
    name: 'decided_by_customer_profile_id',
    type: 'uuid',
    nullable: true,
  })
  decidedByCustomerProfileId: string | null;

  @Column({
    name: 'decided_by_staff_profile_id',
    type: 'uuid',
    nullable: true,
  })
  decidedByStaffProfileId: string | null;

  @Column({
    name: 'decision_channel',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  decisionChannel: DecisionChannel | null;

  @Column({ name: 'decision_note', type: 'text', nullable: true })
  decisionNote: string | null;

  /** Number the advisor called for a verbal decision. */
  @Column({
    name: 'decision_contact_phone',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  decisionContactPhone: string | null;

  /** Set when the owner accepted non-OEM parts in this request. */
  @Column({
    name: 'non_oem_acknowledged_at',
    type: 'timestamptz',
    nullable: true,
  })
  nonOemAcknowledgedAt: Date | null;

  @OneToMany(() => JobLineItem, (line) => line.approval)
  lineItems: JobLineItem[];
}
