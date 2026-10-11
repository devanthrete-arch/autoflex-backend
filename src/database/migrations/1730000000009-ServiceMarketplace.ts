import { MigrationInterface, QueryRunner } from 'typeorm';

export class ServiceMarketplace1730000000009 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE service_job_line_items ADD COLUMN scope jsonb NOT NULL DEFAULT '[]'`,
    );
    await q.query(`CREATE TABLE service_definitions (
      id uuid PRIMARY KEY, slug varchar(100) NOT NULL UNIQUE, name varchar(150) NOT NULL,
      description text NOT NULL, category varchar(100) NOT NULL,
      aliases jsonb NOT NULL DEFAULT '[]', vehicle_types jsonb NOT NULL,
      is_active boolean NOT NULL DEFAULT true
    )`);
    await q.query(
      `ALTER TABLE service_offerings ADD COLUMN service_definition_id uuid REFERENCES service_definitions(id) ON DELETE RESTRICT`,
    );
    await q.query(
      `ALTER TABLE service_offerings ADD COLUMN version integer NOT NULL DEFAULT 1`,
    );
    await q.query(
      `CREATE INDEX service_offerings_definition_idx ON service_offerings(service_definition_id, service_center_id)`,
    );
    await q.query(`CREATE TABLE service_packages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      service_center_id uuid NOT NULL REFERENCES service_centers(id) ON DELETE CASCADE,
      name varchar(150) NOT NULL, description text, vehicle_type vehicle_type_enum NOT NULL,
      price_inr numeric(12,2) NOT NULL CHECK (price_inr >= 0), price_is_starting boolean NOT NULL DEFAULT false,
      duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 15 AND 1440),
      components jsonb NOT NULL, is_active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query(
      `CREATE INDEX service_packages_center_idx ON service_packages(service_center_id)`,
    );
    await q.query(
      `ALTER TABLE booking_items ADD COLUMN service_package_id uuid REFERENCES service_packages(id) ON DELETE SET NULL`,
    );
    await q.query(`ALTER TABLE booking_items ADD COLUMN menu_version integer`);
    await q.query(
      `ALTER TABLE booking_items ADD COLUMN scope jsonb NOT NULL DEFAULT '[]'`,
    );
    await q.query(`ALTER TABLE booking_items ADD COLUMN description text`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE service_job_line_items DROP COLUMN scope`);
    await q.query(`ALTER TABLE booking_items DROP COLUMN description`);
    await q.query(`ALTER TABLE booking_items DROP COLUMN scope`);
    await q.query(`ALTER TABLE booking_items DROP COLUMN menu_version`);
    await q.query(`ALTER TABLE booking_items DROP COLUMN service_package_id`);
    await q.query(`DROP TABLE service_packages`);
    await q.query(`DROP INDEX service_offerings_definition_idx`);
    await q.query(`ALTER TABLE service_offerings DROP COLUMN version`);
    await q.query(
      `ALTER TABLE service_offerings DROP COLUMN service_definition_id`,
    );
    await q.query(`DROP TABLE service_definitions`);
  }
}
