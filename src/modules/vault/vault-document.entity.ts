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
import { UploadStatus } from '../../common/enums/job-work.enum';
import {
  RecordStatus,
  VaultCategory,
  VerificationStatus,
} from '../../common/enums/ownership.enum';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { GarageVehicle } from '../customers/entities/garage-vehicle.entity';

/** Vehicle papers and personal documents such as a driving licence. */
@Entity('vault_documents')
export class VaultDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'customer_profile_id', type: 'uuid' })
  customerProfileId: string;

  @ManyToOne(() => CustomerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_profile_id' })
  customerProfile: CustomerProfile;

  @Column({ name: 'garage_vehicle_id', type: 'uuid', nullable: true })
  garageVehicleId: string | null;

  @ManyToOne(() => GarageVehicle, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'garage_vehicle_id' })
  garageVehicle: GarageVehicle | null;

  @Column({
    type: 'enum',
    enum: VaultCategory,
    enumName: 'vault_category_enum',
  })
  category: VaultCategory;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({
    name: 'document_number',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  documentNumber: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  issuer: string | null;

  @Column({ name: 'issue_date', type: 'date', nullable: true })
  issueDate: string | null;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: true })
  fileName: string | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 100, nullable: true })
  mimeType: string | null;

  @Column({ name: 'size_bytes', type: 'integer', nullable: true })
  sizeBytes: number | null;

  @Column({
    name: 'front_storage_key',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  frontStorageKey: string | null;

  @Column({
    name: 'back_storage_key',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  backStorageKey: string | null;

  @Column({
    name: 'upload_status',
    type: 'enum',
    enum: UploadStatus,
    enumName: 'upload_status_enum',
    default: UploadStatus.PENDING,
  })
  uploadStatus: UploadStatus;

  @Column({
    name: 'verification_status',
    type: 'varchar',
    length: 12,
    default: VerificationStatus.UNVERIFIED,
  })
  verificationStatus: VerificationStatus;

  @Column({ type: 'varchar', length: 12, default: RecordStatus.ACTIVE })
  status: RecordStatus;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
