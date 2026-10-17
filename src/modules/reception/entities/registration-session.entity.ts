import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
export type RegistrationState =
  | 'WAITING_CUSTOMER'
  | 'CONSENTED'
  | 'COMPLETED'
  | 'CANCELLED';
@Entity('reception_registration_sessions')
export class RegistrationSession {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index()
  @Column({ name: 'service_center_id', type: 'uuid' })
  serviceCenterId: string;
  @Column({ name: 'staff_profile_id', type: 'uuid' }) staffProfileId: string;
  @Column({ type: 'varchar', length: 20 }) phone: string;
  @Column({ name: 'challenge_hash', type: 'varchar', length: 64 })
  challengeHash: string;
  @Column({ type: 'varchar', length: 24 }) state: RegistrationState;
  @Column({ type: 'integer', default: 1 }) version: number;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @Column({ name: 'customer_profile_id', type: 'uuid', nullable: true })
  customerProfileId: string | null;
  @Column({ name: 'customer_id', type: 'uuid', nullable: true }) customerId:
    | string
    | null;
  @Column({
    name: 'verification_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  verificationId: string | null;
  @Column({ name: 'consent_at', type: 'timestamptz', nullable: true })
  consentAt: Date | null;
  @Column({
    name: 'consent_name',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  consentName: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
