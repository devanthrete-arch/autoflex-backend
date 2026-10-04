import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BookingMode } from '../../../common/enums/booking-mode.enum';
import { BookingStatus } from '../../../common/enums/booking-status.enum';
import { PaymentMode } from '../../../common/enums/payment-mode.enum';
import { CustomerProfile } from '../../customers/entities/customer-profile.entity';
import { GarageVehicle } from '../../customers/entities/garage-vehicle.entity';
import { ServiceCenter } from '../../tenancy/entities/service-center.entity';

@Entity('bookings')
export class Booking {
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
