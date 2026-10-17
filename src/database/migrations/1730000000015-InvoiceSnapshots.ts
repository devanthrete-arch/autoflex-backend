import { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive only: historical numbers, amounts and entitlement remain unchanged. */
export class InvoiceSnapshots1730000000015 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE invoices ADD COLUMN schema_version integer NOT NULL DEFAULT 1,
      ADD COLUMN document_kind varchar(32) NOT NULL DEFAULT 'LEGACY_BILL',
      ADD COLUMN billing_snapshot jsonb, ADD COLUMN snapshot_hash varchar(64)`);
    await q.query(
      `ALTER TABLE invoice_line_items ADD COLUMN tax_snapshot jsonb`,
    );
    await q.query(
      `ALTER TABLE service_job_line_items ADD COLUMN billing_source_kind varchar(16)`,
    );
    await q.query(`ALTER TABLE payments ADD COLUMN dedupe_key varchar(64)`);
    await q.query(
      `CREATE UNIQUE INDEX payments_v2_dedupe_uq ON payments(dedupe_key) WHERE dedupe_key IS NOT NULL`,
    );
    // The job lock serializes both old/new writers at cutover. Restrict new
    // uniqueness to V2: unsafe historical duplicates require a preflight review.
    await q.query(`CREATE UNIQUE INDEX invoices_v2_active_job_uq ON invoices(job_id)
      WHERE schema_version = 2 AND status <> 'VOID'`);
    await q.query(`CREATE UNIQUE INDEX invoices_v2_number_uq ON invoices ((billing_snapshot->>'sellerKey'), (billing_snapshot->>'financialYear'), invoice_number)
      WHERE schema_version = 2`);
  }
  async down(q: QueryRunner): Promise<void> {
    const rows = (await q.query(
      `SELECT count(*)::int AS count FROM invoices WHERE schema_version = 2`,
    )) as { count: number }[];
    if (rows[0].count)
      throw new Error(
        'Issued V2 invoices prevent destructive migration rollback',
      );
    await q.query(`DROP INDEX invoices_v2_number_uq`);
    await q.query(`DROP INDEX invoices_v2_active_job_uq`);
    await q.query(`DROP INDEX payments_v2_dedupe_uq`);
    await q.query(`ALTER TABLE payments DROP COLUMN dedupe_key`);
    await q.query(
      `ALTER TABLE service_job_line_items DROP COLUMN billing_source_kind`,
    );
    await q.query(`ALTER TABLE invoice_line_items DROP COLUMN tax_snapshot`);
    await q.query(
      `ALTER TABLE invoices DROP COLUMN schema_version, DROP COLUMN document_kind, DROP COLUMN billing_snapshot, DROP COLUMN snapshot_hash`,
    );
  }
}
