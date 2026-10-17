import { DataSource } from 'typeorm';
import {
  BillingPreflightInvoice,
  BillingPreflightPayment,
  inspectBilling,
  summarizeBillingPreflight,
} from './billing-preflight';

function invoice(
  overrides: Partial<BillingPreflightInvoice> = {},
): BillingPreflightInvoice {
  return {
    id: 'invoice-1',
    serviceCenterId: 'center-a',
    jobId: 'job-1',
    invoiceNumber: 'INV-LEGACY-1',
    status: 'DUE',
    subtotalInr: '100.00',
    adjustmentInr: '0.00',
    taxInr: '0.00',
    totalInr: '100.00',
    paidInr: '0.00',
    missingBuyerName: false,
    missingBuyerPhone: false,
    missingBuyerPlate: false,
    missingSellerName: false,
    missingSellerAddress: false,
    ...overrides,
  };
}

function payment(
  overrides: Partial<BillingPreflightPayment> = {},
): BillingPreflightPayment {
  return {
    invoiceId: 'invoice-1',
    serviceCenterId: 'center-a',
    method: 'UPI',
    amountInr: '100.00',
    reference: null,
    ...overrides,
  };
}

describe('billing preflight', () => {
  it('reports empty data without inventing a configured legal series', () => {
    const report = summarizeBillingPreflight([], [], []);
    expect(report.mode).toBe('READ_ONLY_COUNTS');
    expect(report.totals.invoices).toBe(0);
    expect(report.byCenter).toEqual([]);
    expect(report.guidance).toContain('No legal series');
  });

  it('includes VOID history in number collisions but excludes it from active-job collisions', () => {
    const rows = [
      invoice({ status: 'VOID' }),
      invoice({ id: 'invoice-2', invoiceNumber: ' inv-legacy-1 ' }),
      invoice({
        id: 'invoice-3',
        invoiceNumber: 'INV-OTHER',
        status: 'PAID',
        paidInr: '100.00',
      }),
      invoice({
        id: 'invoice-4',
        serviceCenterId: 'center-b',
        jobId: 'job-2',
        invoiceNumber: 'INV-LEGACY-1',
      }),
    ];
    const report = summarizeBillingPreflight(rows, [], []);
    expect(report.totals).toMatchObject({
      invoices: 4,
      voidInvoices: 1,
      jobsWithInvoiceHistory: 1,
      jobsWithVoidHistory: 1,
      duplicateActiveInvoiceJobGroups: 1,
      duplicateActiveInvoiceRows: 2,
      duplicateInvoiceNumberGroups: 1,
      duplicateInvoiceNumberRows: 2,
      statusCounts: { VOID: 1, DUE: 2, PAID: 1 },
    });
    expect(report.byCenter.map((row) => row.serviceCenterId)).toEqual([
      'center-a',
      'center-b',
    ]);
    expect(report.byCenter[1].duplicateInvoiceNumberGroups).toBe(0);
  });

  it('detects a second active invoice even if its tenant differs from the first', () => {
    const report = summarizeBillingPreflight(
      [invoice(), invoice({ id: 'other', serviceCenterId: 'center-b' })],
      [],
      [],
    );
    expect(report.totals.duplicateActiveInvoiceJobGroups).toBe(1);
    expect(report.totals.duplicateActiveInvoiceRows).toBe(2);
    expect(
      report.byCenter.map((row) => row.duplicateActiveInvoiceJobGroups),
    ).toEqual([1, 1]);
    expect(
      report.byCenter.map((row) => row.duplicateActiveInvoiceRows),
    ).toEqual([1, 1]);
  });

  it('groups nonempty normalized references only within the same center and method', () => {
    const rows = [
      payment({ reference: 'private-ref' }),
      payment({ reference: ' PRIVATE-REF ' }),
      payment({ reference: 'private-ref', serviceCenterId: 'center-b' }),
      payment({ reference: 'private-ref', method: 'CARD' }),
      payment({ reference: '   ', method: 'CASH' }),
      payment({ reference: null, method: 'CASH' }),
    ];
    const report = summarizeBillingPreflight([invoice()], rows, []);
    expect(report.totals).toMatchObject({
      payments: 6,
      paymentReferenceConflictGroups: 1,
      paymentReferenceConflictRows: 2,
      paymentCenterMismatches: 1,
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('private-ref');
    expect(serialized).not.toContain('PRIVATE-REF');
    expect(serialized).not.toContain('invoice-1');
    expect(serialized).not.toContain('job-1');
  });

  it('reconciles exact money, adjustment lines and zero-value due bills without float errors', () => {
    const rows = [
      invoice({
        status: 'PAID',
        subtotalInr: '9999999999.99',
        adjustmentInr: '-0.10',
        taxInr: '0.11',
        totalInr: '10000000000.00',
        paidInr: '10000000000.00',
      }),
      invoice({
        id: 'zero',
        jobId: 'zero-job',
        invoiceNumber: 'ZERO',
        subtotalInr: '0.00',
        totalInr: '0.00',
      }),
    ];
    const report = summarizeBillingPreflight(
      rows,
      [payment({ amountInr: '10000000000.00' })],
      [
        { invoiceId: 'invoice-1', amountInr: '9999999999.89', taxInr: '0.11' },
        { invoiceId: 'zero', amountInr: '0.00', taxInr: '0.00' },
      ],
    );
    expect(report.totals).toMatchObject({
      invoiceArithmeticMismatches: 0,
      invoiceLineAmountMismatches: 0,
      invoiceLineTaxMismatches: 0,
      invoicePaidVsPaymentsMismatches: 0,
      paidStatusMismatches: 0,
      dueStatusMismatches: 0,
      negativeInvoiceAmounts: 0,
    });
  });

  it('counts missing snapshots, inconsistent totals, payment status and invalid rows', () => {
    const rows = [
      invoice({
        status: 'PAID',
        totalInr: '110.00',
        paidInr: '90.00',
        missingBuyerName: true,
        missingBuyerPhone: true,
        missingBuyerPlate: true,
        missingSellerName: true,
        missingSellerAddress: true,
      }),
      invoice({
        id: 'due',
        jobId: 'job-due',
        invoiceNumber: '',
        paidInr: '100.00',
      }),
      invoice({
        id: 'bad',
        jobId: 'job-bad',
        invoiceNumber: 'BAD',
        totalInr: 'NaN',
      }),
      invoice({
        id: 'void',
        jobId: 'job-void',
        invoiceNumber: 'VOID',
        status: 'VOID',
      }),
    ];
    const report = summarizeBillingPreflight(
      rows,
      [
        payment({ amountInr: '80.00' }),
        payment({ invoiceId: 'void', amountInr: '0.00' }),
        payment({ invoiceId: 'unknown', amountInr: 'invalid' }),
      ],
      [{ invoiceId: 'invoice-1', amountInr: '101.00', taxInr: '1.00' }],
    );
    expect(report.totals).toMatchObject({
      missingBuyerName: 1,
      missingBuyerPhone: 1,
      missingBuyerPlate: 1,
      missingSellerName: 1,
      missingSellerAddress: 1,
      missingInvoiceNumbers: 1,
      invoiceArithmeticMismatches: 1,
      invoicePaidVsPaymentsMismatches: 2,
      invoiceLineAmountMismatches: 1,
      invoiceLineTaxMismatches: 1,
      paidStatusMismatches: 1,
      dueStatusMismatches: 1,
      invalidInvoiceMoneyRows: 1,
      invalidPaymentMoneyRows: 1,
      nonpositivePaymentRows: 1,
      voidInvoicesWithPayments: 1,
      orphanPaymentRows: 1,
    });
  });

  it('establishes a read-only repeatable snapshot before selecting any data', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([invoice({ missingBuyerName: true })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ present: null }]);
    const transaction = jest.fn(async (_isolation, operation) =>
      operation({ query }),
    );
    const result = await inspectBilling({
      transaction,
    } as unknown as DataSource);
    expect(transaction).toHaveBeenCalledWith(
      'REPEATABLE READ',
      expect.any(Function),
    );
    expect(query.mock.calls[0]).toEqual(['SET TRANSACTION READ ONLY']);
    expect(query).toHaveBeenCalledTimes(5);
    for (const [sql] of query.mock.calls.slice(1)) {
      expect(sql.trim()).toMatch(/^SELECT\b/);
      expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE|ALTER|CREATE)\b/);
    }
    expect(result.totals.missingBuyerName).toBe(1);
  });
  it('reconciles debit-note payments independently while detecting references reused across targets', () => {
    const report = summarizeBillingPreflight(
      [invoice({ status: 'PAID', paidInr: '100.00' })],
      [
        payment({ reference: 'same' }),
        payment({
          invoiceId: null,
          noteId: 'note-1',
          amountInr: '11.80',
          reference: ' SAME ',
        }),
      ],
      [{ invoiceId: 'invoice-1', amountInr: '100.00', taxInr: '0.00' }],
      [
        {
          id: 'note-1',
          serviceCenterId: 'center-a',
          kind: 'DEBIT',
          state: 'ISSUED',
          totalInr: '11.80',
          paidAt: '2026-10-17',
        },
      ],
    );
    expect(report.totals).toMatchObject({
      payments: 2,
      notePayments: 1,
      financialNotes: 1,
      orphanPaymentRows: 0,
      orphanNotePaymentRows: 0,
      invoicePaidVsPaymentsMismatches: 0,
      notePaymentMismatches: 0,
      paymentReferenceConflictGroups: 1,
    });
  });
});
