import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Customer } from './customer.entity';
import { GarageVehicle } from './garage-vehicle.entity';
import { ServiceCenter } from '../../tenancy/entities/service-center.entity';
import { VehicleType } from '../../../common/enums/vehicle-type.enum';

@Entity('vehicles')
@Index(['serviceCenterId', 'registrationNumber'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;

  @ManyToOne(() => ServiceCenter, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_center_id' })
  serviceCenter: ServiceCenter;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne(() => Customer, (customer) => customer.vehicles, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'registration_number', type: 'varchar', length: 32 })
  registrationNumber: string;

  @Column({
    name: 'registration_canonical',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  registrationCanonical: string | null;

  @Column({ type: 'integer', default: 1 })
  revision: number;

  @Column({
    name: 'vehicle_type',
    type: 'enum',
    enum: VehicleType,
    enumName: 'vehicle_type_enum',
    nullable: true,
  })
  vehicleType: VehicleType | null;

  @Column({ name: 'make_model', type: 'varchar', length: 255, nullable: true })
  makeModel: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  make: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  model: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  variant: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  nickname: string | null;

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

  /** Set at check-in when the vehicle comes from the owner's garage. */
  @Column({ name: 'garage_vehicle_id', type: 'uuid', nullable: true })
  garageVehicleId: string | null;

  @ManyToOne(() => GarageVehicle, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'garage_vehicle_id' })
  garageVehicle: GarageVehicle | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
