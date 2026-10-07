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
import { CommunicationChannel } from '../../../common/enums/communication-channel.enum';
import { CustomerAddress } from './customer-address.entity';
import { GarageVehicle } from './garage-vehicle.entity';

@Entity('customer_profiles')
export class CustomerProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'iam_user_id', type: 'varchar', length: 36 })
  iamUserId: string;

  @Column({
    name: 'display_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  displayName: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 1024, nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  locale: string | null;

  @Column({
    name: 'selected_place_label',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  selectedPlaceLabel: string | null;

  @Column({
    name: 'last_lat',
    type: 'double precision',
    nullable: true,
  })
  lastLat: number | null;

  @Column({
    name: 'last_lng',
    type: 'double precision',
    nullable: true,
  })
  lastLng: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state: string | null;

  @Column({ name: 'postal_code', type: 'varchar', length: 10, nullable: true })
  postalCode: string | null;

  /** Calendar date `YYYY-MM-DD`. Age is derived, never stored. */
  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth: string | null;

  @Column({
    name: 'preferred_channel',
    type: 'enum',
    enum: CommunicationChannel,
    default: CommunicationChannel.WHATSAPP,
  })
  preferredChannel: CommunicationChannel;

  @Column({ name: 'whatsapp_consent', type: 'boolean', default: false })
  whatsappConsent: boolean;

  @Column({ name: 'email_consent', type: 'boolean', default: false })
  emailConsent: boolean;

  @Column({ name: 'service_updates', type: 'boolean', default: true })
  serviceUpdates: boolean;

  @Column({ name: 'maintenance_reminders', type: 'boolean', default: true })
  maintenanceReminders: boolean;

  @Column({ name: 'document_reminders', type: 'boolean', default: true })
  documentReminders: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @OneToMany(() => GarageVehicle, (vehicle) => vehicle.customerProfile)
  garageVehicles: GarageVehicle[];

  @OneToMany(() => CustomerAddress, (address) => address.customerProfile)
  addresses: CustomerAddress[];
}
