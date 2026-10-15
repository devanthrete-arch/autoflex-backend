import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CustomerProfile } from '../../customers/entities/customer-profile.entity';
import { ServiceJob } from './service-job.entity';

export type VisitAccessSource =
  | 'LEGACY_CONTACT_LINK'
  | 'WALK_IN'
  | 'BOOKING_CHECKIN';

/** A visit grant survives contact relinking; it never proves vehicle ownership. */
@Entity('job_customer_access')
@Index('UQ_job_customer_access', ['jobId', 'customerProfileId'], {
  unique: true,
})
export class JobCustomerAccess {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'job_id', type: 'uuid' })
  jobId: string;

  @ManyToOne(() => ServiceJob, (job) => job.customerAccess, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'job_id' })
  job: ServiceJob;

  @Index()
  @Column({ name: 'customer_profile_id', type: 'uuid' })
  customerProfileId: string;

  @ManyToOne(() => CustomerProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_profile_id' })
  profile: CustomerProfile;

  @Column({ name: 'can_view', type: 'boolean', default: true })
  canView: boolean;

  @Column({ name: 'can_decide', type: 'boolean', default: true })
  canDecide: boolean;

  @Column({ type: 'varchar', length: 32 })
  source: VisitAccessSource;

  @Column({ name: 'customer_revision', type: 'integer' })
  customerRevision: number;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
