import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BookingMode } from '../../../common/enums/booking-mode.enum';
import { BookingParty } from '../../../common/enums/booking-party.enum';
import { BookingStatus } from '../../../common/enums/booking-status.enum';
import { PaymentMode } from '../../../common/enums/payment-mode.enum';
import { CustomerProfile } from '../../customers/entities/customer-profile.entity';
import { GarageVehicle } from '../../customers/entities/garage-vehicle.entity';
import { ServiceJob } from '../../jobs/entities/service-job.entity';
import { ServiceCenter } from '../../tenancy/entities/service-center.entity';
import { BookingAttachment } from './booking-attachment.entity';
import { BookingItem } from './booking-item.entity';

@Entity('bookings')
export class Booking {
  @Column({ name: 'schedule_revision', type: 'integer', nullable: true })
  scheduleRevision: number | null;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;

  @ManyToOne(() => ServiceCenter, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_center_id' })
  serviceCenter: ServiceCenter;

  @Column({ name: 'customer_profile_id', type: 'uuid' })
  customerProfileId: string;

  @ManyToOne(() => CustomerProfile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_profile_id' })
  customerProfile: CustomerProfile;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId: string;

  @ManyToOne(() => GarageVehicle, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle: GarageVehicle;

  @Column({ type: 'enum', enum: BookingMode })
  mode: BookingMode;

  @Column({ type: 'enum', enum: BookingStatus })
  status: BookingStatus;

  @Column({ name: 'slot_start', type: 'timestamptz' })
  slotStart: Date;

  @Column({ name: 'slot_end', type: 'timestamptz' })
  slotEnd: Date;

  @Column({
    name: 'issue_description',
    type: 'text',
    nullable: true,
  })
  issueDescription: string | null;

  @Column({
    name: 'payment_mode',
    type: 'enum',
    enum: PaymentMode,
    default: PaymentMode.PAY_AT_CENTER,
  })
  paymentMode: PaymentMode;

  @Column({
    name: 'estimate_inr',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  estimateInr: string;

  /** Human-facing reference, e.g. `AF-20270615-K7Q2`. */
  @Column({
    name: 'booking_number',
    type: 'varchar',
    length: 20,
    nullable: true,
    unique: true,
  })
  bookingNumber: string | null;

  /** The job opened at check-in. */
  @Column({ name: 'service_job_id', type: 'uuid', nullable: true })
  serviceJobId: string | null;

  @ManyToOne(() => ServiceJob, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'service_job_id' })
  serviceJob: ServiceJob | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ name: 'checked_in_at', type: 'timestamptz', nullable: true })
  checkedInAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({
    name: 'cancelled_by',
    type: 'enum',
    enum: BookingParty,
    enumName: 'booking_party_enum',
    nullable: true,
  })
  cancelledBy: BookingParty | null;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason: string | null;

  @Column({ name: 'address_snapshot', type: 'jsonb', nullable: true })
  addressSnapshot: Record<string, unknown> | null;

  @OneToMany(() => BookingItem, (item) => item.booking)
  items: BookingItem[];

  @OneToMany(() => BookingAttachment, (attachment) => attachment.booking)
  attachments: BookingAttachment[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
