import { MigrationInterface, QueryRunner } from 'typeorm';
export class BookingSchedule1730000000012 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE service_centers
      ADD COLUMN schedule_revision integer NOT NULL DEFAULT 1,
      ADD COLUMN booking_lead_minutes integer NOT NULL DEFAULT 0,
      ADD COLUMN booking_advance_days integer NOT NULL DEFAULT 7,
      ADD COLUMN schedule_rules jsonb,
      ADD CONSTRAINT center_schedule_policy CHECK (schedule_revision > 0 AND booking_lead_minutes BETWEEN 0 AND 10080 AND booking_advance_days BETWEEN 1 AND 90)`);
    await runner.query(
      `ALTER TABLE bookings ADD COLUMN schedule_revision integer`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE bookings DROP COLUMN schedule_revision');
    await runner.query(`ALTER TABLE service_centers DROP CONSTRAINT center_schedule_policy,
      DROP COLUMN schedule_revision, DROP COLUMN booking_lead_minutes, DROP COLUMN booking_advance_days, DROP COLUMN schedule_rules`);
  }
}
