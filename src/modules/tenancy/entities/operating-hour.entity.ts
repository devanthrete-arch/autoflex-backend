import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ServiceCenter } from './service-center.entity';

/** One row per weekday. `dayOfWeek` is 0 = Sunday … 6 = Saturday, IST. */
@Entity('service_center_operating_hours')
export class OperatingHour {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;

  @ManyToOne(() => ServiceCenter, (center) => center.operatingHours, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'service_center_id' })
  serviceCenter: ServiceCenter;

  @Column({ name: 'day_of_week', type: 'smallint' })
  dayOfWeek: number;

  @Column({ name: 'open_time', type: 'varchar', length: 5, nullable: true })
  openTime: string | null;

  @Column({ name: 'close_time', type: 'varchar', length: 5, nullable: true })
  closeTime: string | null;

  @Column({ name: 'is_closed', type: 'boolean', default: false })
  isClosed: boolean;
}
