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
import { CustomerProfile } from './customer-profile.entity';

@Entity('customer_addresses')
export class CustomerAddress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'customer_profile_id', type: 'uuid' })
  customerProfileId: string;

  @ManyToOne(() => CustomerProfile, (profile) => profile.addresses, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'customer_profile_id' })
  customerProfile: CustomerProfile;

  @Column({ type: 'varchar', length: 50 })
  label: string;

  @Column({ type: 'text' })
  line1: string;

  @Column({ type: 'text', nullable: true })
  line2: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  landmark: string | null;

  @Column({ type: 'varchar', length: 100 })
  city: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state: string | null;

  @Column({ name: 'postal_code', type: 'varchar', length: 10 })
  postalCode: string;

  @Column({
    name: 'contact_phone',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  contactPhone: string | null;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
