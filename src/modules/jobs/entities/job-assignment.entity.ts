import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ServiceJob } from './service-job.entity';
import { StaffProfile } from '../../tenancy/entities/staff-profile.entity';

@Entity('job_assignments')
export class JobAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'job_id', type: 'uuid' })
  jobId: string;

  @ManyToOne(() => ServiceJob, (job) => job.assignments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'job_id' })
  job: ServiceJob;

  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;

  @Column({ name: 'staff_profile_id', type: 'uuid' })
  staffProfileId: string;

  @ManyToOne(() => StaffProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'staff_profile_id' })
  staffProfile: StaffProfile;

  @Column({ type: 'varchar', length: 32 })
  role: string;

  @Column({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt: Date;

  @Column({ name: 'unassigned_at', type: 'timestamptz', nullable: true })
  unassignedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
