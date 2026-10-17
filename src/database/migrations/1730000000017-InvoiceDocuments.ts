import { MigrationInterface, QueryRunner } from 'typeorm';
export class InvoiceDocuments1730000000017 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE invoice_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL UNIQUE REFERENCES invoices(id), state varchar(16) NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RENDERING','READY','FAILED')), storage_key varchar(255), sha256 varchar(64), attempts integer NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz, retry_at timestamptz, error_code varchar(64), render_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now())`,
    );
    await q.query(
      `CREATE INDEX invoice_documents_pending_idx ON invoice_documents(state,retry_at)`,
    );
    await q.query(
      `ALTER TABLE invoices ADD COLUMN voided_at timestamptz, ADD COLUMN void_reason varchar(500), ADD COLUMN replacement_for_invoice_id uuid REFERENCES invoices(id)`,
    );
    await q.query(
      `INSERT INTO invoice_documents(invoice_id) SELECT id FROM invoices WHERE schema_version = 2`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE invoice_documents');
    await q.query(
      'ALTER TABLE invoices DROP COLUMN replacement_for_invoice_id, DROP COLUMN void_reason, DROP COLUMN voided_at',
    );
  }
}
