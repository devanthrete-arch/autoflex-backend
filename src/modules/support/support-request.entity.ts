import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  SupportCategory,
  SupportStatus,
} from '../../common/enums/ownership.enum';

@Entity('support_requests')
export class SupportRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'customer_profile_id', type: 'uuid' })
  customerProfileId: string;

  /** `SR-YYYYMMDD-XXXX`, quoted when the customer calls. */
  @Column({ name: 'reference_number', type: 'varchar', length: 20 })
  referenceNumber: string;

  @Column({ type: 'varchar', length: 16 })
  category: SupportCategory;

  @Column({ type: 'varchar', length: 150 })
  subject: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ name: 'job_id', type: 'uuid', nullable: true })
  jobId: string | null;

  @Column({ name: 'booking_id', type: 'uuid', nullable: true })
  bookingId: string | null;

  @Column({
    name: 'preferred_channel',
    type: 'varchar',
    length: 12,
    nullable: true,
  })
  preferredChannel: string | null;

  @Column({
    type: 'enum',
    enum: SupportStatus,
    enumName: 'support_status_enum',
    default: SupportStatus.OPEN,
  })
  status: SupportStatus;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
