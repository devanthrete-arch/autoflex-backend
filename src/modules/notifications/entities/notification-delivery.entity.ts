import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  DeliveryChannel,
  DeliveryStatus,
} from '../../../common/enums/ownership.enum';

/** One send attempt per channel; providers update status and attempts. */
@Entity('notification_deliveries')
export class NotificationDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'notification_id', type: 'uuid', nullable: true })
  notificationId: string | null;

  @Column({ name: 'customer_profile_id', type: 'uuid', nullable: true })
  customerProfileId: string | null;

  @Column({ name: 'service_center_id', type: 'uuid', nullable: true })
  serviceCenterId: string | null;

  @Index()
  @Column({ name: 'job_id', type: 'uuid', nullable: true })
  jobId: string | null;

  @Column({ type: 'varchar', length: 12 })
  channel: DeliveryChannel;

  @Column({ name: 'template_key', type: 'varchar', length: 64 })
  templateKey: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  recipient: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({
    type: 'enum',
    enum: DeliveryStatus,
    enumName: 'delivery_status_enum',
    default: DeliveryStatus.PENDING,
  })
  status: DeliveryStatus;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
