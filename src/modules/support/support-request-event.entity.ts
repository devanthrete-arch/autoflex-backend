import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
export const SUPPORT_EVENT_TYPES = [
  'CREATED',
  'IMPORTED',
  'CLAIMED',
  'ASSIGNED',
  'RELEASED',
  'INTERNAL_NOTE',
  'PUBLIC_REPLY',
  'CUSTOMER_REPLY',
  'PRIORITY_CHANGED',
  'WAITING_CHANGED',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
] as const;
export type SupportEventType = (typeof SUPPORT_EVENT_TYPES)[number];
@Entity('support_request_events')
@Index(['supportRequestId', 'requestVersion'], { unique: true })
export class SupportRequestEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'support_request_id', type: 'uuid' })
  supportRequestId: string;
  @Column({ name: 'request_version', type: 'integer' }) requestVersion: number;
  @Column({ type: 'varchar', length: 32 }) type: SupportEventType;
  @Column({ type: 'varchar', length: 8 }) visibility: 'PUBLIC' | 'INTERNAL';
  @Column({ type: 'text', nullable: true }) body: string | null;
  @Column({ name: 'actor_type', type: 'varchar', length: 8 }) actorType:
    | 'CUSTOMER'
    | 'SUPPORT'
    | 'SYSTEM';
  @Column({ name: 'actor_customer_profile_id', type: 'uuid', nullable: true })
  actorCustomerProfileId: string | null;
  @Column({
    name: 'actor_support_agent_profile_id',
    type: 'uuid',
    nullable: true,
  })
  actorSupportAgentProfileId: string | null;
  @Column({ type: 'jsonb', nullable: true }) changes: Record<
    string,
    unknown
  > | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
