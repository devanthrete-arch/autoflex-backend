import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { VehicleType } from '../../../common/enums/vehicle-type.enum';
import { ServiceCenter } from '../../tenancy/entities/service-center.entity';

export type PackageComponent = { offeringId: string; quantity: number };
export type ServiceScope = {
  offeringId: string;
  serviceDefinitionId: string | null;
  name: string;
  description: string | null;
  quantity: number;
};

@Entity('service_packages')
export class ServicePackage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index()
  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;
  @ManyToOne(() => ServiceCenter, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_center_id' })
  serviceCenter: ServiceCenter;
  @Column({ type: 'varchar', length: 150 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({
    name: 'vehicle_type',
    type: 'enum',
    enum: VehicleType,
    enumName: 'vehicle_type_enum',
  })
  vehicleType: VehicleType;
  @Column({ name: 'price_inr', type: 'numeric', precision: 12, scale: 2 })
  priceInr: string;
  @Column({ name: 'price_is_starting', default: false })
  priceIsStarting: boolean;
  @Column({ name: 'duration_minutes', type: 'integer' })
  durationMinutes: number;
  // Membership is validated against this center under the shared menu lock.
  @Column({ type: 'jsonb' }) components: PackageComponent[];
  @Column({ name: 'is_active', default: true }) isActive: boolean;
  @Column({ type: 'integer', default: 1 }) version: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
