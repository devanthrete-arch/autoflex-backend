import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('support_agent_profiles')
@Index(['iamDomainId', 'iamUserId'], { unique: true })
export class SupportAgentProfile {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'iam_domain_id', type: 'varchar', length: 128 })
  iamDomainId: string;
  @Column({ name: 'iam_user_id', type: 'varchar', length: 128 })
  iamUserId: string;
  @Column({ name: 'display_name', type: 'varchar', length: 255 })
  displayName: string;
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
