import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { JobPriority } from '../../../common/enums/job-priority.enum';
import { JobStatus } from '../../../common/enums/job-status.enum';
import { VehicleType } from '../../../common/enums/vehicle-type.enum';
import { Invoice } from '../../billing/entities/invoice.entity';
import { Customer } from '../../customers/entities/customer.entity';
import { Vehicle } from '../../customers/entities/vehicle.entity';
import { ServiceJobEvent } from '../../events/entities/service-job-event.entity';
import { JobApproval } from './job-approval.entity';
import { JobAssignment } from './job-assignment.entity';
import { JobLineItem } from './job-line-item.entity';
import { JobMedia } from './job-media.entity';
import { ServiceCenter } from '../../tenancy/entities/service-center.entity';
import { StaffProfile } from '../../tenancy/entities/staff-profile.entity';
import { JobCustomerAccess } from './job-customer-access.entity';

export interface IntakeSnapshot {
  customerName: string | null;
  customerPhone: string;
  vehicleRegistration: string;
  vehicleLabel: string | null;
  garageVehicleId: string | null;
}

@Entity('service_jobs')
export class ServiceJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;

  @ManyToOne(() => ServiceCenter, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_center_id' })
  serviceCenter: ServiceCenter;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne(() => Customer, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  /** Original invoice recipient; grant changes never silently change the debtor. */
  @Column({ name: 'billing_customer_profile_id', type: 'uuid', nullable: true })
  billingCustomerProfileId: string | null;

  @Column({ name: 'intake_snapshot', type: 'jsonb', nullable: true })
  intakeSnapshot: IntakeSnapshot | null;

  @OneToMany(() => JobCustomerAccess, (access) => access.job)
  customerAccess: JobCustomerAccess[];

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId: string;

  @ManyToOne(() => Vehicle, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle: Vehicle;

  @Column({
    name: 'vehicle_type',
    type: 'enum',
    enum: VehicleType,
    default: VehicleType.TWO_WHEELER,
  })
  vehicleType: VehicleType;

  @Index()
  @Column({ type: 'enum', enum: JobStatus, default: JobStatus.CHECKED_IN })
  status: JobStatus;

  @Column({ name: 'service_type', type: 'varchar', length: 128 })
  serviceType: string;

  @Column({ name: 'odometer_km', type: 'integer', nullable: true })
  odometerKm: number | null;

  @Column({ name: 'fuel_level', type: 'varchar', length: 32, nullable: true })
  fuelLevel: string | null;

  @Column({ name: 'estimated_ready_at', type: 'timestamptz', nullable: true })
  estimatedReadyAt: Date | null;

  @Column({ name: 'assigned_technician_id', type: 'uuid', nullable: true })
  assignedTechnicianId: string | null;

  @ManyToOne(() => StaffProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_technician_id' })
  assignedTechnician: StaffProfile | null;

  @Column({
    type: 'enum',
    enum: JobPriority,
    default: JobPriority.NORMAL,
  })
  priority: JobPriority;

  @Column({
    name: 'budget_ceiling',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  budgetCeiling: string | null;

  @Column({ name: 'accessories_checklist', type: 'jsonb', nullable: true })
  accessoriesChecklist: Record<string, unknown> | null;

  @Column({ name: 'payment_mode', type: 'varchar', length: 32, nullable: true })
  paymentMode: string | null;

  @Index('IDX_service_jobs_public_token', { unique: true })
  @Column({ name: 'public_token', type: 'varchar', length: 128 })
  publicToken: string;

  @Column({ name: 'source_booking_id', type: 'uuid', nullable: true })
  sourceBookingId: string | null;

  /** Human-facing reference, e.g. `JC-20270615-K7Q2`. */
  @Column({
    name: 'job_number',
    type: 'varchar',
    length: 20,
    nullable: true,
    unique: true,
  })
  jobNumber: string | null;

  /** Bumped by every job command; clients send it back as `If-Match`. */
  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({ name: 'customer_request', type: 'text', nullable: true })
  customerRequest: string | null;

  @Column({ name: 'waiting_on_site', type: 'boolean', default: false })
  waitingOnSite: boolean;

  @Column({
    name: 'previous_status',
    type: 'enum',
    enum: JobStatus,
    enumName: 'job_status_enum',
    nullable: true,
  })
  previousStatus: JobStatus | null;

  @Column({ name: 'hold_reason', type: 'text', nullable: true })
  holdReason: string | null;

  @Column({ name: 'expected_resume_at', type: 'timestamptz', nullable: true })
  expectedResumeAt: Date | null;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason: string | null;

  @Column({ name: 'comeback_of_job_id', type: 'uuid', nullable: true })
  comebackOfJobId: string | null;

  @ManyToOne(() => ServiceJob, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'comeback_of_job_id' })
  comebackOf: ServiceJob | null;

  @Column({ name: 'comeback_reason', type: 'text', nullable: true })
  comebackReason: string | null;

  @Column({ name: 'warranty_intent', type: 'boolean', default: false })
  warrantyIntent: boolean;

  /** Checklist results keyed by item, e.g. `{ brakes: { ok: false, note } }`. */
  @Column({ type: 'jsonb', nullable: true })
  inspection: Record<
    string,
    { ok: boolean; label?: string; note?: string }
  > | null;

  @Column({
    name: 'inspection_completed_at',
    type: 'timestamptz',
    nullable: true,
  })
  inspectionCompletedAt: Date | null;

  @Column({ name: 'qc_passed_at', type: 'timestamptz', nullable: true })
  qcPassedAt: Date | null;

  @Column({ name: 'qc_by_staff_profile_id', type: 'uuid', nullable: true })
  qcByStaffProfileId: string | null;

  @Column({ name: 'qc_notes', type: 'text', nullable: true })
  qcNotes: string | null;

  /** Steps skipped on the express path, e.g. `['INSPECTION', 'QC']`. */
  @Column({ name: 'skipped_steps', type: 'jsonb', nullable: true })
  skippedSteps: string[] | null;

  @Column({ name: 'close_checklist', type: 'jsonb', nullable: true })
  closeChecklist: Record<string, boolean> | null;

  @Column({
    name: 'final_amount_inr',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  finalAmountInr: string | null;

  @Column({
    name: 'amount_adjustment_reason',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  amountAdjustmentReason: string | null;

  @Column({ name: 'amount_adjustment_note', type: 'text', nullable: true })
  amountAdjustmentNote: string | null;

  @Column({ name: 'final_notes', type: 'text', nullable: true })
  finalNotes: string | null;

  /** Counter note while waiting at pickup, e.g. a dispute or unpaid balance. */
  @Column({ name: 'pickup_note', type: 'text', nullable: true })
  pickupNote: string | null;

  @OneToMany(() => JobLineItem, (line) => line.job)
  lineItems: JobLineItem[];

  @OneToMany(() => JobApproval, (approval) => approval.job)
  approvals: JobApproval[];

  @OneToMany(() => JobMedia, (media) => media.job)
  media: JobMedia[];

  @OneToMany(() => Invoice, (invoice) => invoice.job)
  invoices: Invoice[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @OneToMany(() => ServiceJobEvent, (event) => event.job)
  events: ServiceJobEvent[];

  @OneToMany(() => JobAssignment, (assignment) => assignment.job)
  assignments: JobAssignment[];
}
