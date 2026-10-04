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
import { Customer } from '../../customers/entities/customer.entity';
import { Vehicle } from '../../customers/entities/vehicle.entity';
import { ServiceJobEvent } from '../../events/entities/service-job-event.entity';
import { JobAssignment } from './job-assignment.entity';
import { ServiceCenter } from '../../tenancy/entities/service-center.entity';
import { StaffProfile } from '../../tenancy/entities/staff-profile.entity';

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

  @Index({ unique: true })
  @Column({ name: 'public_token', type: 'varchar', length: 128 })
  publicToken: string;

  @Column({ name: 'source_booking_id', type: 'uuid', nullable: true })
  sourceBookingId: string | null;

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
