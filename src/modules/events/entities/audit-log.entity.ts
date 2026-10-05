import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { StaffProfile } from '../../tenancy/entities/staff-profile.entity';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 64 })
  entityType: string;

  @Index()
  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ name: 'actor_staff_profile_id', type: 'uuid', nullable: true })
  actorStaffProfileId: string | null;

  @ManyToOne(() => StaffProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_staff_profile_id' })
  actor: StaffProfile | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  /** Changed fields only, before and after the change. */
  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  @Column({
    name: 'correlation_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  correlationId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
