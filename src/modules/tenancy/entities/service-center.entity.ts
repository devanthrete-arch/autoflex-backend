import type { ScheduleRules } from '../../scheduling/schedule';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceCenterStatus } from '../../../common/enums/service-center-status.enum';
import { VehicleType } from '../../../common/enums/vehicle-type.enum';
import { OperatingHour } from './operating-hour.entity';
import { StaffProfile } from './staff-profile.entity';

@Entity('service_centers')
export class ServiceCenter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'iam_domain_id', type: 'varchar', length: 36 })
  iamDomainId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    type: 'enum',
    enum: ServiceCenterStatus,
    default: ServiceCenterStatus.ACTIVE,
  })
  status: ServiceCenterStatus;

  @Column({
    name: 'display_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  displayName: string | null;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({
    name: 'formatted_address',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  formattedAddress: string | null;

  @Column({
    name: 'hero_image_url',
    type: 'varchar',
    length: 1024,
    nullable: true,
  })
  heroImageUrl: string | null;

  @Column({ name: 'photo_urls', type: 'jsonb', default: () => "'[]'" })
  photoUrls: string[];

  @Column({
    name: 'google_maps_url',
    type: 'varchar',
    length: 1024,
    nullable: true,
  })
  googleMapsUrl: string | null;

  @Column({ name: 'logo_url', type: 'varchar', length: 1024, nullable: true })
  logoUrl: string | null;

  @Column({
    name: 'rating_avg',
    type: 'numeric',
    precision: 3,
    scale: 2,
    nullable: true,
  })
  ratingAvg: string | null;

  @Column({ name: 'rating_count', type: 'integer', default: 0 })
  ratingCount: number;

  @Column({ name: 'auto_accept', type: 'boolean', default: true })
  autoAccept: boolean;

  @Column({ name: 'booking_enabled', type: 'boolean', default: true })
  bookingEnabled: boolean;

  @Column({ name: 'hours_start', type: 'varchar', length: 8, default: '09:00' })
  hoursStart: string;

  @Column({ name: 'hours_end', type: 'varchar', length: 8, default: '17:00' })
  hoursEnd: string;

  @Column({ name: 'schedule_revision', type: 'integer', default: 1 })
  scheduleRevision: number;

  @Column({ name: 'booking_lead_minutes', type: 'integer', default: 0 })
  bookingLeadMinutes: number;

  @Column({ name: 'booking_advance_days', type: 'integer', default: 7 })
  bookingAdvanceDays: number;

  @Column({ name: 'schedule_rules', type: 'jsonb', nullable: true })
  scheduleRules: ScheduleRules | null;

  /** Bookings the center accepts per slot. */
  @Column({ name: 'slot_capacity', type: 'integer', default: 1 })
  slotCapacity: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  slug: string | null;

  @Column({ name: 'public_phone', type: 'varchar', length: 20, nullable: true })
  publicPhone: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  gstin: string | null;

  @Column({ name: 'address_line1', type: 'text', nullable: true })
  addressLine1: string | null;

  @Column({ name: 'address_line2', type: 'text', nullable: true })
  addressLine2: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state: string | null;

  @Column({ name: 'postal_code', type: 'varchar', length: 10, nullable: true })
  postalCode: string | null;

  @Column({
    name: 'supported_vehicle_types',
    type: 'jsonb',
    default: () => `'["TWO_WHEELER"]'`,
  })
  supportedVehicleTypes: VehicleType[];

  @Column({ name: 'pickup_drop_enabled', type: 'boolean', default: false })
  pickupDropEnabled: boolean;

  @Column({ name: 'onboarded_at', type: 'timestamptz', nullable: true })
  onboardedAt: Date | null;

  /** Lets quick jobs skip inspection or QC, with a close checklist. */
  @Column({ name: 'express_skip_enabled', type: 'boolean', default: false })
  expressSkipEnabled: boolean;

  /** UPI id shown to customers for paying at the counter. */
  @Column({ name: 'upi_vpa', type: 'varchar', length: 100, nullable: true })
  upiVpa: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @OneToMany(() => StaffProfile, (profile) => profile.serviceCenter)
  staffProfiles: StaffProfile[];

  @OneToMany(() => OperatingHour, (hour) => hour.serviceCenter)
  operatingHours: OperatingHour[];
}
