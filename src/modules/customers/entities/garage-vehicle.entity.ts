import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { GarageVehicleStatus } from '../../../common/enums/garage-vehicle-status.enum';
import { VehicleType } from '../../../common/enums/vehicle-type.enum';
import { CustomerProfile } from './customer-profile.entity';

@Entity('garage_vehicles')
export class GarageVehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_profile_id', type: 'uuid' })
  customerProfileId: string;

  @ManyToOne(() => CustomerProfile, (profile) => profile.garageVehicles, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'customer_profile_id' })
  customerProfile: CustomerProfile;

  @Column({
    name: 'vehicle_type',
    type: 'enum',
    enum: VehicleType,
    default: VehicleType.TWO_WHEELER,
  })
  vehicleType: VehicleType;

  @Column({ type: 'varchar', length: 128 })
  make: string;

  @Column({ type: 'varchar', length: 128 })
  model: string;

  @Column({ type: 'integer', nullable: true })
  year: number | null;

  @Column({ name: 'registration_number', type: 'varchar', length: 32 })
  registrationNumber: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  color: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  fuel: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  transmission: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  variant: string | null;

  /** Catalogue leaf for a car. Two-wheelers stay null until they have a catalogue. */
  @Column({ name: 'catalog_configuration_id', type: 'uuid', nullable: true })
  catalogConfigurationId: string | null;

  @Column({
    name: 'chassis_number',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  chassisNumber: string | null;

  @Column({
    name: 'engine_number',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  engineNumber: string | null;

  @Column({ name: 'current_odometer_km', type: 'integer', nullable: true })
  currentOdometerKm: number | null;

  @Column({ name: 'purchase_date', type: 'date', nullable: true })
  purchaseDate: string | null;

  @Column({
    type: 'enum',
    enum: GarageVehicleStatus,
    default: GarageVehicleStatus.ACTIVE,
  })
  status: GarageVehicleStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
