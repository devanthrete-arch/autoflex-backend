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
import { MaintenanceStatus } from '../../common/enums/ownership.enum';
import { GarageVehicle } from '../customers/entities/garage-vehicle.entity';

/**
 * A reminder due by date, by odometer, or both. With an interval, completing
 * it moves the due point forward; without one it stays completed.
 */
@Entity('maintenance_items')
export class MaintenanceItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_profile_id', type: 'uuid' })
  customerProfileId: string;

  @Index()
  @Column({ name: 'garage_vehicle_id', type: 'uuid' })
  garageVehicleId: string;

  @ManyToOne(() => GarageVehicle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'garage_vehicle_id' })
  garageVehicle: GarageVehicle;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ name: 'due_odometer_km', type: 'integer', nullable: true })
  dueOdometerKm: number | null;

  @Column({ name: 'interval_months', type: 'integer', nullable: true })
  intervalMonths: number | null;

  @Column({ name: 'interval_km', type: 'integer', nullable: true })
  intervalKm: number | null;

  @Column({ name: 'last_completed_on', type: 'date', nullable: true })
  lastCompletedOn: string | null;

  @Column({
    name: 'last_completed_odometer_km',
    type: 'integer',
    nullable: true,
  })
  lastCompletedOdometerKm: number | null;

  @Column({
    type: 'enum',
    enum: MaintenanceStatus,
    enumName: 'maintenance_status_enum',
    default: MaintenanceStatus.UPCOMING,
  })
  status: MaintenanceStatus;

  @Column({ name: 'snoozed_until', type: 'date', nullable: true })
  snoozedUntil: string | null;

  @Column({ name: 'source_job_id', type: 'uuid', nullable: true })
  sourceJobId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
