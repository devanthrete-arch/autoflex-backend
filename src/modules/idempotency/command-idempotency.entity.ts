import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Stored outcome of a mutating request sent with an `Idempotency-Key`. */
@Entity('command_idempotency')
@Index(['scope', 'idempotencyKey'], { unique: true })
export class CommandIdempotency {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Actor the key belongs to, e.g. `staff:<staffProfileId>`. */
  @Column({ type: 'varchar', length: 80 })
  scope: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  /** SHA-256 of method, path, and body. */
  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash: string;

  @Column({ name: 'response_status', type: 'integer' })
  responseStatus: number;

  @Column({ name: 'response_body', type: 'jsonb', nullable: true })
  responseBody: Record<string, unknown> | unknown[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
