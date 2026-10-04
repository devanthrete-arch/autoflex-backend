import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceCenterStatus } from '../../../common/enums/service-center-status.enum';
import { StaffProfile } from './staff-profile.entity';

@Entity('service_centers')
export class ServiceCenter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'iam_domain_id', type: 'varchar', length: 36 })
  iamDomainId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    type: 'enum',
    enum: ServiceCenterStatus,
    default: ServiceCenterStatus.ACTIVE,
  })
  status: ServiceCenterStatus;

  @Column({
    name: 'display_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  displayName: string | null;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({
    name: 'formatted_address',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  formattedAddress: string | null;

  @Column({
    name: 'hero_image_url',
    type: 'varchar',
    length: 1024,
    nullable: true,
  })
  heroImageUrl: string | null;

  @Column({ name: 'logo_url', type: 'varchar', length: 1024, nullable: true })
  logoUrl: string | null;

  @Column({
    name: 'rating_avg',
    type: 'numeric',
    precision: 3,
    scale: 2,
    nullable: true,
  })
  ratingAvg: string | null;

  @Column({ name: 'rating_count', type: 'integer', default: 0 })
  ratingCount: number;

  @Column({ name: 'auto_accept', type: 'boolean', default: true })
  autoAccept: boolean;

  @Column({ name: 'booking_enabled', type: 'boolean', default: true })
  bookingEnabled: boolean;

  @Column({ name: 'hours_start', type: 'varchar', length: 8, default: '09:00' })
  hoursStart: string;

  @Column({ name: 'hours_end', type: 'varchar', length: 8, default: '17:00' })
  hoursEnd: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @OneToMany(() => StaffProfile, (profile) => profile.serviceCenter)
  staffProfiles: StaffProfile[];
}
