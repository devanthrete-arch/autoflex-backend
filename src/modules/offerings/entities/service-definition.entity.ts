import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { VehicleType } from '../../../common/enums/vehicle-type.enum';

/** Shared activity identity. Prices and availability belong to each center. */
@Entity('service_definitions')
export class ServiceDefinition {
  @PrimaryColumn('uuid') id: string;
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  slug: string;
  @Column({ type: 'varchar', length: 150 }) name: string;
  @Column({ type: 'text' }) description: string;
  @Column({ type: 'varchar', length: 100 }) category: string;
  @Column({ type: 'jsonb', default: () => "'[]'" }) aliases: string[];
  @Column({ name: 'vehicle_types', type: 'jsonb' }) vehicleTypes: VehicleType[];
  @Column({ name: 'is_active', default: true }) isActive: boolean;
}
