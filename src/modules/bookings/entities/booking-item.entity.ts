import {
  ServicePackage,
  type ServiceScope,
} from '../../offerings/entities/service-package.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ServiceOffering } from '../../offerings/entities/service-offering.entity';
import { Booking } from './booking.entity';

/** Name and price are copied from the offering when the booking is made. */
@Entity('booking_items')
export class BookingItem {
  @Column({ name: 'service_package_id', type: 'uuid', nullable: true })
  servicePackageId: string | null;
  @ManyToOne(() => ServicePackage, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'service_package_id' })
  servicePackage: ServicePackage | null;
  @Column({ name: 'menu_version', type: 'integer', nullable: true })
  menuVersion: number | null;
  @Column({ type: 'jsonb', default: () => "'[]'" })
  scope: ServiceScope[];
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @ManyToOne(() => Booking, (booking) => booking.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ name: 'service_offering_id', type: 'uuid', nullable: true })
  serviceOfferingId: string | null;

  @ManyToOne(() => ServiceOffering, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'service_offering_id' })
  serviceOffering: ServiceOffering | null;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ name: 'price_inr', type: 'numeric', precision: 12, scale: 2 })
  priceInr: string;

  @Column({ name: 'price_is_starting', type: 'boolean', default: false })
  priceIsStarting: boolean;

  @Column({ name: 'duration_minutes', type: 'integer' })
  durationMinutes: number;

  @Column({ type: 'integer', default: 1 })
  quantity: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
