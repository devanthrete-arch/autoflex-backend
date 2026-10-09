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
  @Index('UQ_support_requests_reference', { unique: true })
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

  @Column({ name: 'assigned_agent_profile_id', type: 'uuid', nullable: true })
  assignedAgentProfileId: string | null;
  @Column({ type: 'varchar', length: 8, default: 'NORMAL' }) priority:
    | 'NORMAL'
    | 'HIGH';
  @Column({ name: 'waiting_on', type: 'varchar', length: 8, nullable: true })
  waitingOn: 'CUSTOMER' | 'CENTER' | 'INTERNAL' | null;
  @Column({ type: 'integer', default: 1 }) version: number;
  @Column({
    name: 'resolution_code',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  resolutionCode: string | null;
  @Column({ name: 'resolution_summary', type: 'text', nullable: true })
  resolutionSummary: string | null;
  @Column({ name: 'closure_summary', type: 'text', nullable: true })
  closureSummary: string | null;
  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;
  @Column({
    name: 'last_activity_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastActivityAt: Date;
  @Column({
    name: 'last_customer_message_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastCustomerMessageAt: Date;
  @Column({ name: 'last_public_reply_at', type: 'timestamptz', nullable: true })
  lastPublicReplyAt: Date | null;
  @Column({
    name: 'last_customer_message_version',
    type: 'integer',
    default: 1,
  })
  lastCustomerMessageVersion: number;
  @Column({
    name: 'last_public_reply_version',
    type: 'integer',
    nullable: true,
  })
  lastPublicReplyVersion: number | null;
  @Column({ name: 'first_response_at', type: 'timestamptz', nullable: true })
  firstResponseAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
