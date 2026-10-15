import { MigrationInterface, QueryRunner } from 'typeorm';

export class VisitCustomerAccess1730000000013 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE service_jobs
      ADD COLUMN billing_customer_profile_id uuid REFERENCES customer_profiles(id) ON DELETE RESTRICT,
      ADD COLUMN intake_snapshot jsonb`);
    await runner.query(`CREATE TABLE job_customer_access (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id uuid NOT NULL REFERENCES service_jobs(id) ON DELETE RESTRICT,
      customer_profile_id uuid NOT NULL REFERENCES customer_profiles(id) ON DELETE RESTRICT,
      can_view boolean NOT NULL DEFAULT true,
      can_decide boolean NOT NULL DEFAULT true,
      source varchar(32) NOT NULL,
      customer_revision integer NOT NULL,
      version integer NOT NULL DEFAULT 1,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_job_customer_access" UNIQUE (job_id, customer_profile_id),
      CONSTRAINT visit_access_capabilities CHECK (NOT can_decide OR can_view),
      CONSTRAINT visit_access_versions CHECK (version > 0 AND customer_revision > 0),
      CONSTRAINT visit_access_source CHECK (source IN ('LEGACY_CONTACT_LINK','WALK_IN','BOOKING_CHECKIN'))
    )`);
    await runner.query(
      `CREATE INDEX "IDX_job_customer_access_profile" ON job_customer_access(customer_profile_id)`,
    );

    // Capture the prior authorization principal only where its center relation
    // is intact. Unlinked/deleted/foreign-center rows require reviewed repair.
    await runner.query(`INSERT INTO job_customer_access
      (job_id, customer_profile_id, source, customer_revision)
      SELECT j.id, c.customer_profile_id, 'LEGACY_CONTACT_LINK', c.revision
      FROM service_jobs j JOIN customers c ON c.id = j.customer_id
      JOIN customer_profiles p ON p.id = c.customer_profile_id
      JOIN vehicles v ON v.id = j.vehicle_id
      WHERE j.deleted_at IS NULL AND c.deleted_at IS NULL AND p.deleted_at IS NULL
        AND v.deleted_at IS NULL AND j.service_center_id = c.service_center_id
        AND v.service_center_id = j.service_center_id AND v.customer_id = c.id`);
    await runner.query(`UPDATE service_jobs SET billing_customer_profile_id = a.customer_profile_id
      FROM job_customer_access a WHERE a.job_id = service_jobs.id`);
    await runner.query(`UPDATE service_jobs SET intake_snapshot = snapshot.value
      FROM (SELECT j.id, jsonb_build_object(
          'customerName', c.name, 'customerPhone', c.phone,
          'vehicleRegistration', v.registration_number, 'vehicleLabel', v.make_model,
          'garageVehicleId', v.garage_vehicle_id::text) AS value
        FROM service_jobs j JOIN customers c ON c.id = j.customer_id
        JOIN vehicles v ON v.id = j.vehicle_id
        WHERE c.deleted_at IS NULL AND v.deleted_at IS NULL
          AND c.service_center_id = j.service_center_id
          AND v.service_center_id = j.service_center_id
          AND v.customer_id = c.id) snapshot
      WHERE snapshot.id = service_jobs.id`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE job_customer_access');
    await runner.query(
      `ALTER TABLE service_jobs DROP COLUMN intake_snapshot, DROP COLUMN billing_customer_profile_id`,
    );
  }
}
