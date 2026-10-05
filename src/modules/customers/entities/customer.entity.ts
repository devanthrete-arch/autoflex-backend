import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceCenter } from '../../tenancy/entities/service-center.entity';
import { CustomerProfile } from './customer-profile.entity';
import { Vehicle } from './vehicle.entity';

@Entity('customers')
@Index(['serviceCenterId', 'phone'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;

  @ManyToOne(() => ServiceCenter, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_center_id' })
  serviceCenter: ServiceCenter;

  @Column({ type: 'varchar', length: 20 })
  phone: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  @Column({
    name: 'secondary_contact_phone',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  secondaryContactPhone: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  locale: string | null;

  @Column({ name: 'consent_recorded_at', type: 'timestamptz', nullable: true })
  consentRecordedAt: Date | null;

  /** Set at check-in when the visit belongs to a signed-in owner. */
  @Column({ name: 'customer_profile_id', type: 'uuid', nullable: true })
  customerProfileId: string | null;

  @ManyToOne(() => CustomerProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'customer_profile_id' })
  customerProfile: CustomerProfile | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @OneToMany(() => Vehicle, (vehicle) => vehicle.customer)
  vehicles: Vehicle[];
}
