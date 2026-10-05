import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NotificationCategory } from '../../../common/enums/ownership.enum';

/** In-app inbox entry; `href` is a customer-web route. */
@Entity('customer_notifications')
export class CustomerNotification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_profile_id', type: 'uuid' })
  customerProfileId: string;

  @Column({
    type: 'enum',
    enum: NotificationCategory,
    enumName: 'notification_category_enum',
  })
  category: NotificationCategory;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'varchar', length: 500 })
  body: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  href: string | null;

  @Column({ name: 'job_id', type: 'uuid', nullable: true })
  jobId: string | null;

  @Column({ name: 'booking_id', type: 'uuid', nullable: true })
  bookingId: string | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
