import { DataSource } from 'typeorm';

/** Minimal internal rows. Identity snapshots and reference values never enter the report. */
export interface BillingPreflightInvoice {
  id: string;
  serviceCenterId: string;
  jobId: string;
  invoiceNumber: string;
  status: string;
  subtotalInr: string;
  adjustmentInr: string;
  taxInr: string;
  totalInr: string;
  paidInr: string;
  missingBuyerName: boolean;
  missingBuyerPhone: boolean;
  missingBuyerPlate: boolean;
  missingSellerName: boolean;
  missingSellerAddress: boolean;
}

export interface BillingPreflightPayment {
  invoiceId: string | null;
  noteId?: string | null;
  serviceCenterId: string;
  method: string;
  amountInr: string;
  reference: string | null;
}

export interface BillingPreflightLineTotal {
  invoiceId: string;
  amountInr: string;
  taxInr: string;
}

export interface BillingPreflightNote {
  id: string;
  serviceCenterId: string;
  kind: string;
  state: string;
  totalInr: string;
  paidAt: string | null;
}
function emptyCounts() {
  return {
    invoices: 0,
    financialNotes: 0,
    notePayments: 0,
    orphanNotePaymentRows: 0,
    notePaymentMismatches: 0,
    invalidPaymentTargetRows: 0,
    payments: 0,
    statusCounts: {} as Record<string, number>,
    duplicateActiveInvoiceJobGroups: 0,
    duplicateActiveInvoiceRows: 0,
    duplicateInvoiceNumberGroups: 0,
    duplicateInvoiceNumberRows: 0,
    paymentReferenceConflictGroups: 0,
    paymentReferenceConflictRows: 0,
    missingInvoiceNumbers: 0,
    missingBuyerName: 0,
    missingBuyerPhone: 0,
    missingBuyerPlate: 0,
    missingSellerName: 0,
    missingSellerAddress: 0,
    invoiceArithmeticMismatches: 0,
    invoiceLineAmountMismatches: 0,
    invoiceLineTaxMismatches: 0,
    invoicesWithoutLines: 0,
    invoicePaidVsPaymentsMismatches: 0,
    paidStatusMismatches: 0,
    dueStatusMismatches: 0,
    negativeInvoiceAmounts: 0,
    invalidInvoiceMoneyRows: 0,
    invalidPaymentMoneyRows: 0,
    nonpositivePaymentRows: 0,
    paymentCenterMismatches: 0,
    orphanPaymentRows: 0,
    unknownInvoiceStatuses: 0,
    voidInvoices: 0,
    voidInvoicesWithPayments: 0,
    jobsWithInvoiceHistory: 0,
    jobsWithVoidHistory: 0,
  };
}

type Counts = ReturnType<typeof emptyCounts>;

/** Exact minor units; preflight must not round or repair malformed legacy money. */
function minorUnits(value: string): bigint | null {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -amount : amount;
}

/** Potential collisions only: no reference, invoice number, job ID or party data is returned. */
export function summarizeBillingPreflight(
  invoices: BillingPreflightInvoice[],
  payments: BillingPreflightPayment[],
  lineTotals: BillingPreflightLineTotal[],
  notes: BillingPreflightNote[] = [],
) {
  const totals = emptyCounts();
  const centers = new Map<string, Counts>();
  const center = (id: string) => {
    let counts = centers.get(id);
    if (!counts) {
      counts = emptyCounts();
      centers.set(id, counts);
    }
    return counts;
  };
  const increment = (
    counts: Counts,
    key: Exclude<keyof Counts, 'statusCounts'>,
  ) => {
    totals[key]++;
    counts[key]++;
  };
  const invoicesById = new Map(
    invoices.map((invoice) => [invoice.id, invoice]),
  );
  const notesById = new Map(notes.map((n) => [n.id, n]));
  const paymentsByNote = new Map<string, BillingPreflightPayment[]>();
  const paymentsByInvoice = new Map<string, BillingPreflightPayment[]>();
  const linesByInvoice = new Map(
    lineTotals.map((line) => [line.invoiceId, line]),
  );
  const jobs = new Map<string, BillingPreflightInvoice[]>();
  const numbers = new Map<string, BillingPreflightInvoice[]>();
  const references = new Map<string, BillingPreflightPayment[]>();
  const normalize = (value: string) => value.trim().toUpperCase();

  for (const payment of payments) {
    const counts = center(payment.serviceCenterId);
    increment(counts, 'payments');
    if (payment.noteId) {
      increment(counts, 'notePayments');
      if (payment.invoiceId) increment(counts, 'invalidPaymentTargetRows');
      const note = notesById.get(payment.noteId);
      if (!note) increment(counts, 'orphanNotePaymentRows');
      else if (note.serviceCenterId !== payment.serviceCenterId)
        increment(counts, 'paymentCenterMismatches');
      const group = paymentsByNote.get(payment.noteId) ?? [];
      group.push(payment);
      paymentsByNote.set(payment.noteId, group);
    } else if (payment.invoiceId) {
      const existing = paymentsByInvoice.get(payment.invoiceId) ?? [];
      existing.push(payment);
      paymentsByInvoice.set(payment.invoiceId, existing);
      const invoice = invoicesById.get(payment.invoiceId);
      if (!invoice) increment(counts, 'orphanPaymentRows');
      else if (invoice.serviceCenterId !== payment.serviceCenterId)
        increment(counts, 'paymentCenterMismatches');
    } else increment(counts, 'invalidPaymentTargetRows');
    const amount = minorUnits(payment.amountInr);
    if (amount === null) increment(counts, 'invalidPaymentMoneyRows');
    else if (amount <= 0n) increment(counts, 'nonpositivePaymentRows');
    const reference = payment.reference ? normalize(payment.reference) : '';
    if (reference) {
      const key = JSON.stringify([
        payment.serviceCenterId,
        payment.method,
        reference,
      ]);
      const group = references.get(key) ?? [];
      group.push(payment);
      references.set(key, group);
    }
  }

  for (const note of notes) {
    const counts = center(note.serviceCenterId);
    increment(counts, 'financialNotes');
    const paid = paymentsByNote.get(note.id) ?? [];
    if (
      paid.length &&
      (note.kind !== 'DEBIT' ||
        note.state !== 'ISSUED' ||
        !note.paidAt ||
        paid.length !== 1 ||
        minorUnits(paid[0].amountInr) !== minorUnits(note.totalInr))
    )
      increment(counts, 'notePaymentMismatches');
    else if (note.paidAt && !paid.length)
      increment(counts, 'notePaymentMismatches');
  }
  for (const invoice of invoices) {
    const counts = center(invoice.serviceCenterId);
    increment(counts, 'invoices');
    totals.statusCounts[invoice.status] =
      (totals.statusCounts[invoice.status] ?? 0) + 1;
    counts.statusCounts[invoice.status] =
      (counts.statusCounts[invoice.status] ?? 0) + 1;
    if (!['DUE', 'PAID', 'VOID'].includes(invoice.status))
      increment(counts, 'unknownInvoiceStatuses');
    for (const field of [
      'missingBuyerName',
      'missingBuyerPhone',
      'missingBuyerPlate',
      'missingSellerName',
      'missingSellerAddress',
    ] as const) {
      if (invoice[field]) increment(counts, field);
    }
    // A job is globally unique. A malformed cross-center invoice must not hide
    // a second active principal bill from the uniqueness cutover report.
    const history = jobs.get(invoice.jobId) ?? [];
    history.push(invoice);
    jobs.set(invoice.jobId, history);
    const number = normalize(invoice.invoiceNumber);
    if (!number) increment(counts, 'missingInvoiceNumbers');
    else {
      const key = JSON.stringify([invoice.serviceCenterId, number]);
      const group = numbers.get(key) ?? [];
      group.push(invoice);
      numbers.set(key, group);
    }
    const invoicePayments = paymentsByInvoice.get(invoice.id) ?? [];
    if (invoice.status === 'VOID') {
      increment(counts, 'voidInvoices');
      if (invoicePayments.length) increment(counts, 'voidInvoicesWithPayments');
    }
    const money = [
      invoice.subtotalInr,
      invoice.adjustmentInr,
      invoice.taxInr,
      invoice.totalInr,
      invoice.paidInr,
    ].map(minorUnits);
    if (money.some((amount) => amount === null)) {
      increment(counts, 'invalidInvoiceMoneyRows');
      continue;
    }
    const [subtotal, adjustment, tax, total, paid] = money as bigint[];
    if (subtotal < 0n || tax < 0n || total < 0n || paid < 0n)
      increment(counts, 'negativeInvoiceAmounts');
    if (subtotal + adjustment + tax !== total)
      increment(counts, 'invoiceArithmeticMismatches');
    const paymentAmounts = invoicePayments.map((payment) =>
      minorUnits(payment.amountInr),
    );
    if (paymentAmounts.every((amount) => amount !== null)) {
      const received = paymentAmounts.reduce((sum, amount) => sum + amount, 0n);
      if (received !== paid)
        increment(counts, 'invoicePaidVsPaymentsMismatches');
    }
    if (invoice.status === 'PAID' && paid !== total)
      increment(counts, 'paidStatusMismatches');
    if (
      invoice.status === 'DUE' &&
      (paid > total || (total > 0n && paid === total))
    )
      increment(counts, 'dueStatusMismatches');
    const lines = linesByInvoice.get(invoice.id);
    if (!lines) increment(counts, 'invoicesWithoutLines');
    else {
      if (minorUnits(lines.amountInr) !== subtotal + adjustment)
        increment(counts, 'invoiceLineAmountMismatches');
      if (minorUnits(lines.taxInr) !== tax)
        increment(counts, 'invoiceLineTaxMismatches');
    }
  }

  for (const history of jobs.values()) {
    const active = history.filter((invoice) => invoice.status !== 'VOID');
    const involvedCenters = new Set(history.map((row) => row.serviceCenterId));
    if (history.length > 1) {
      totals.jobsWithInvoiceHistory++;
      for (const id of involvedCenters) center(id).jobsWithInvoiceHistory++;
    }
    if (history.some((invoice) => invoice.status === 'VOID')) {
      totals.jobsWithVoidHistory++;
      for (const id of involvedCenters) center(id).jobsWithVoidHistory++;
    }
    if (active.length > 1) {
      totals.duplicateActiveInvoiceJobGroups++;
      totals.duplicateActiveInvoiceRows += active.length;
      for (const id of new Set(active.map((row) => row.serviceCenterId))) {
        const counts = center(id);
        counts.duplicateActiveInvoiceJobGroups++;
        counts.duplicateActiveInvoiceRows += active.filter(
          (row) => row.serviceCenterId === id,
        ).length;
      }
    }
  }
  for (const group of numbers.values()) {
    if (group.length < 2) continue;
    const counts = center(group[0].serviceCenterId);
    increment(counts, 'duplicateInvoiceNumberGroups');
    totals.duplicateInvoiceNumberRows += group.length;
    counts.duplicateInvoiceNumberRows += group.length;
  }
  for (const group of references.values()) {
    if (group.length < 2) continue;
    const counts = center(group[0].serviceCenterId);
    increment(counts, 'paymentReferenceConflictGroups');
    totals.paymentReferenceConflictRows += group.length;
    counts.paymentReferenceConflictRows += group.length;
  }
  return {
    mode: 'READ_ONLY_COUNTS' as const,
    totals,
    byCenter: [...centers.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([serviceCenterId, counts]) => ({ serviceCenterId, ...counts })),
    guidance:
      'Active invoice uniqueness is checked by job across all centers; a cross-center job group appears in each affected center and once in totals. Legacy invoice numbers are checked within a center, including VOID history. Nonempty invoice numbers and payment references are trimmed and case-normalized for potential conflicts; payment references are grouped by center and method. Counts are review signals, not permission to merge, renumber, retax or rewrite historical records. Seller GSTIN absence alone is not an error because registration status needs finance review. No legal series, tax compliance or ownership is certified by this report.',
  };
}

/** One consistent read-only snapshot. This inspector never invokes a migration or repair. */
export async function inspectBilling(dataSource: DataSource) {
  return dataSource.transaction('REPEATABLE READ', async (manager) => {
    await manager.query('SET TRANSACTION READ ONLY');
    const invoices = await manager.query<BillingPreflightInvoice[]>(`
      SELECT id, service_center_id AS "serviceCenterId", job_id AS "jobId",
        invoice_number AS "invoiceNumber", status::text AS status,
        subtotal_inr::text AS "subtotalInr", adjustment_inr::text AS "adjustmentInr",
        tax_inr::text AS "taxInr", total_inr::text AS "totalInr", paid_inr::text AS "paidInr",
        NULLIF(btrim(buyer->>'name'), '') IS NULL AS "missingBuyerName",
        NULLIF(btrim(buyer->>'phone'), '') IS NULL AS "missingBuyerPhone",
        NULLIF(btrim(buyer->>'vehicleRegistration'), '') IS NULL AS "missingBuyerPlate",
        NULLIF(btrim(seller->>'name'), '') IS NULL AS "missingSellerName",
        NULLIF(btrim(seller->>'address'), '') IS NULL AS "missingSellerAddress"
      FROM invoices`);
    const payments = await manager.query<BillingPreflightPayment[]>(`
      SELECT invoice_id AS "invoiceId", to_jsonb(payments)->>'note_id' AS "noteId", service_center_id AS "serviceCenterId",
        method::text AS method, amount_inr::text AS "amountInr", reference
      FROM payments`);
    const lines = await manager.query<BillingPreflightLineTotal[]>(`
      SELECT invoice_id AS "invoiceId", sum(amount_inr)::text AS "amountInr",
        sum(tax_inr)::text AS "taxInr"
      FROM invoice_line_items GROUP BY invoice_id`);
    const tables = await manager.query<{ present: string | null }[]>(
      "SELECT to_regclass('public.financial_notes') AS present",
    );
    const notes = tables[0]?.present
      ? await manager.query<BillingPreflightNote[]>(
          `SELECT id,service_center_id AS "serviceCenterId",kind,state,total_inr::text AS "totalInr",paid_at::text AS "paidAt" FROM financial_notes`,
        )
      : [];
    return summarizeBillingPreflight(invoices, payments, lines, notes);
  });
}
