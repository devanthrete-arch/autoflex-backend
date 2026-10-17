import { MigrationInterface, QueryRunner } from 'typeorm';
export class FinancialNotes1730000000018 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE financial_notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES invoices(id),
      service_center_id uuid NOT NULL REFERENCES service_centers(id), customer_profile_id uuid NOT NULL REFERENCES customer_profiles(id),
      kind varchar(12) NOT NULL CHECK(kind IN ('CREDIT','DEBIT')),
      state varchar(16) NOT NULL DEFAULT 'PROPOSED' CHECK(state IN ('PROPOSED','ACCEPTED','DECLINED','WITHDRAWN','ISSUED')),
      version integer NOT NULL DEFAULT 1, reason varchar(500) NOT NULL, lines jsonb NOT NULL, snapshot jsonb NOT NULL,
      total_inr numeric(12,2) NOT NULL CHECK(total_inr > 0), proposed_by varchar(150) NOT NULL,
      accepted_at timestamptz, issued_by varchar(150), evidence_reference varchar(500), note_number varchar(16),
      issued_at timestamptz, paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(
      'CREATE INDEX financial_notes_invoice_idx ON financial_notes(invoice_id)',
    );
    await q.query(
      'CREATE UNIQUE INDEX financial_notes_number_idx ON financial_notes(service_center_id,note_number) WHERE note_number IS NOT NULL',
    );
    await q.query(`ALTER TABLE invoice_documents ALTER COLUMN invoice_id DROP NOT NULL,
      ADD COLUMN note_id uuid UNIQUE REFERENCES financial_notes(id),
      ADD CONSTRAINT invoice_document_target CHECK ((invoice_id IS NULL) <> (note_id IS NULL))`);
    await q.query(`ALTER TABLE payments ALTER COLUMN invoice_id DROP NOT NULL,
      ADD COLUMN note_id uuid REFERENCES financial_notes(id),
      ADD CONSTRAINT payment_target CHECK ((invoice_id IS NULL) <> (note_id IS NULL))`);
    await q.query(
      'CREATE UNIQUE INDEX note_full_payment_idx ON payments(note_id) WHERE note_id IS NOT NULL',
    );
  }
  async down(q: QueryRunner) {
    // Explicit refusal protects issued notes and their ledger/document references.
    if (
      Number((await q.query('SELECT count(*) AS n FROM financial_notes'))[0].n)
    )
      throw new Error(
        'Financial-note data must be retained; disable writes instead of reverting',
      );
    await q.query(
      'ALTER TABLE payments DROP CONSTRAINT payment_target, DROP COLUMN note_id, ALTER COLUMN invoice_id SET NOT NULL',
    );
    await q.query(
      'ALTER TABLE invoice_documents DROP CONSTRAINT invoice_document_target, DROP COLUMN note_id, ALTER COLUMN invoice_id SET NOT NULL',
    );
    await q.query('DROP TABLE financial_notes');
  }
}
