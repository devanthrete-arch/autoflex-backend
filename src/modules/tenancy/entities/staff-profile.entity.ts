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
import { StaffDesignation } from '../../../common/enums/staff-designation.enum';
import { ServiceCenter } from './service-center.entity';

@Entity('staff_profiles')
@Index(['serviceCenterId', 'iamUserId'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class StaffProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;

  @ManyToOne(() => ServiceCenter, (center) => center.staffProfiles, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'service_center_id' })
  serviceCenter: ServiceCenter;

  @Index()
  @Column({ name: 'iam_user_id', type: 'varchar', length: 36 })
  iamUserId: string;

  @Column({ name: 'display_name', type: 'varchar', length: 255 })
  displayName: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({
    type: 'enum',
    enum: StaffDesignation,
    nullable: true,
  })
  designation: StaffDesignation | null;

  @Column({
    name: 'employee_code',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  employeeCode: string | null;

  @Column({ type: 'jsonb', nullable: true })
  specializations: string[] | null;

  @Column({ name: 'joined_at', type: 'date', nullable: true })
  joinedAt: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
