import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  JobMediaKind,
  UploadStatus,
} from '../../../common/enums/job-work.enum';
import { JobLineItem } from './job-line-item.entity';
import { ServiceJob } from './service-job.entity';

/** Evidence metadata; the bytes live in object storage under `storageKey`. */
@Entity('service_job_media')
export class JobMedia {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'job_id', type: 'uuid' })
  jobId: string;

  @ManyToOne(() => ServiceJob, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id' })
  job: ServiceJob;

  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;

  @Column({ type: 'enum', enum: JobMediaKind, enumName: 'job_media_kind_enum' })
  kind: JobMediaKind;

  @Column({ name: 'storage_key', type: 'varchar', length: 512 })
  storageKey: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ name: 'size_bytes', type: 'integer' })
  sizeBytes: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  caption: string | null;

  @Column({ name: 'visible_to_customer', type: 'boolean', default: false })
  visibleToCustomer: boolean;

  @Column({
    name: 'upload_status',
    type: 'enum',
    enum: UploadStatus,
    enumName: 'upload_status_enum',
    default: UploadStatus.PENDING,
  })
  uploadStatus: UploadStatus;

  @Column({ name: 'line_item_id', type: 'uuid', nullable: true })
  lineItemId: string | null;

  @ManyToOne(() => JobLineItem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'line_item_id' })
  lineItem: JobLineItem | null;

  @Column({
    name: 'uploaded_by_staff_profile_id',
    type: 'uuid',
    nullable: true,
  })
  uploadedByStaffProfileId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
