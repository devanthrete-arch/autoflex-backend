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
import { VehicleType } from '../../../common/enums/vehicle-type.enum';
import { ServiceCategory } from '../../marketplace/entities/service-category.entity';
import { ServiceCenter } from '../../tenancy/entities/service-center.entity';
import { ServiceDefinition } from './service-definition.entity';

/** A priced item on a center's service menu. `vehicleType` null fits every type. */
@Entity('service_offerings')
export class ServiceOffering {
  @Column({ name: 'service_definition_id', type: 'uuid', nullable: true })
  serviceDefinitionId: string | null;

  @ManyToOne(() => ServiceDefinition, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_definition_id' })
  serviceDefinition: ServiceDefinition | null;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;

  @ManyToOne(() => ServiceCenter, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'service_center_id' })
  serviceCenter: ServiceCenter;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  @ManyToOne(() => ServiceCategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category: ServiceCategory | null;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    name: 'vehicle_type',
    type: 'enum',
    enum: VehicleType,
    enumName: 'vehicle_type_enum',
    nullable: true,
  })
  vehicleType: VehicleType | null;

  @Column({ name: 'price_inr', type: 'numeric', precision: 12, scale: 2 })
  priceInr: string;

  @Column({ name: 'price_is_starting', type: 'boolean', default: false })
  priceIsStarting: boolean;

  @Column({ name: 'duration_minutes', type: 'integer', default: 60 })
  durationMinutes: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
