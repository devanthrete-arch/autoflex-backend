import { MigrationInterface, QueryRunner } from 'typeorm';

export class BillingFoundation1730000000014 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE billing_configurations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      service_center_id uuid NOT NULL REFERENCES service_centers(id) ON DELETE RESTRICT,
      version integer NOT NULL CHECK (version > 0),
      status varchar(16) NOT NULL CHECK (status IN ('DRAFT','APPROVED','SUSPENDED')),
      policy jsonb NOT NULL,
      created_by varchar(255) NOT NULL,
      approved_by varchar(255),
      evidence_reference varchar(255),
      created_at timestamptz NOT NULL DEFAULT now(),
      approved_at timestamptz,
      CONSTRAINT "UQ_billing_configuration_revision" UNIQUE(service_center_id, version),
      CONSTRAINT billing_configuration_approval CHECK (status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_by <> created_by AND approved_at IS NOT NULL AND evidence_reference IS NOT NULL))
    )`);
    await runner.query(
      `CREATE UNIQUE INDEX "UQ_billing_configuration_approved" ON billing_configurations(service_center_id) WHERE status = 'APPROVED'`,
    );
    await runner.query(`CREATE TABLE invoice_series (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      service_center_id uuid NOT NULL REFERENCES service_centers(id) ON DELETE RESTRICT,
      seller_key varchar(100) NOT NULL,
      financial_year varchar(9) NOT NULL,
      series_prefix varchar(4) NOT NULL,
      next_number integer NOT NULL DEFAULT 1 CHECK (next_number > 0),
      CONSTRAINT "UQ_invoice_series_seller_year_prefix" UNIQUE(seller_key, financial_year, series_prefix)
    )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE invoice_series');
    await runner.query('DROP TABLE billing_configurations');
  }
}
