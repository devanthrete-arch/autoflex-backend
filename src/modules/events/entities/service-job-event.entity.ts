import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { JobEventType } from '../../../common/enums/job-event-type.enum';
import { JobStatus } from '../../../common/enums/job-status.enum';
import { ServiceJob } from '../../jobs/entities/service-job.entity';
import { StaffProfile } from '../../tenancy/entities/staff-profile.entity';

@Entity('service_job_events')
export class ServiceJobEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'job_id', type: 'uuid' })
  jobId: string;

  @ManyToOne(() => ServiceJob, (job) => job.events, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id' })
  job: ServiceJob;

  @Index()
  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;

  @Column({ type: 'enum', enum: JobEventType })
  type: JobEventType;

  @Column({
    name: 'from_status',
    type: 'enum',
    enum: JobStatus,
    nullable: true,
  })
  fromStatus: JobStatus | null;

  @Column({ name: 'to_status', type: 'enum', enum: JobStatus, nullable: true })
  toStatus: JobStatus | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ name: 'visible_to_customer', type: 'boolean', default: true })
  visibleToCustomer: boolean;

  @Column({ name: 'created_by_staff_profile_id', type: 'uuid', nullable: true })
  createdByStaffProfileId: string | null;

  @ManyToOne(() => StaffProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_staff_profile_id' })
  createdBy: StaffProfile | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
