import { MigrationInterface, QueryRunner } from 'typeorm';
export class ReceptionRegistration1730000000016 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE reception_registration_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), service_center_id uuid NOT NULL REFERENCES service_centers(id),
      staff_profile_id uuid NOT NULL REFERENCES staff_profiles(id), phone varchar(20) NOT NULL,
      challenge_hash varchar(64) NOT NULL UNIQUE, state varchar(24) NOT NULL CHECK(state IN ('WAITING_CUSTOMER','CONSENTED','COMPLETED','CANCELLED')),
      version integer NOT NULL DEFAULT 1, expires_at timestamptz NOT NULL,
      customer_profile_id uuid REFERENCES customer_profiles(id), customer_id uuid REFERENCES customers(id),
      verification_id varchar(255), consent_at timestamptz, consent_name varchar(160), created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(
      `CREATE INDEX reception_sessions_center_idx ON reception_registration_sessions(service_center_id,created_at)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE reception_registration_sessions');
  }
}
