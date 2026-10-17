import { InvoiceStatus } from '../../common/enums/ownership.enum';
import { inr } from '../../common/money';
import { fromPaise, toPaise } from '../../common/money';
import { Invoice, InvoiceParty } from './entities/invoice.entity';

export interface InvoiceLineView {
  kind: string;
  description: string;
  partType: string | null;
  quantity: number;
  unitPriceInr: string;
  amountInr: string;
  taxRatePct: string;
  taxInr: string;
  taxSnapshot: Record<string, unknown> | null;
}

export interface PaymentView {
  id: string;
  method: string;
  amountInr: string;
  reference: string | null;
  receivedAt: Date;
}

export interface InvoiceView {
  corrections?: {
    pendingDebitCount: number;
    outstandingDebitInr: string;
    issuedCreditInr: string;
  };
  schemaVersion: number;
  documentKind: string;
  documentState: 'AVAILABLE_ON_REQUEST' | 'NOT_CONFIGURED';
  voidedAt: Date | null;
  voidReason: string | null;
  replacementForInvoiceId: string | null;
  supplyDate: string | null;
  placeOfSupply: { stateCode: string; context: string } | null;
  id: string;
  invoiceNumber: string;
  jobId: string;
  status: InvoiceStatus;
  subtotalInr: string;
  adjustmentInr: string;
  taxInr: string;
  totalInr: string;
  paidInr: string;
  balanceInr: string;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  notes: string | null;
  /** Shown to the customer for paying at the counter. */
  upiVpa: string | null;
  issuedAt: Date;
  paidAt: Date | null;
  lineItems: InvoiceLineView[];
  payments: PaymentView[];
}

export function toInvoiceView(invoice: Invoice): InvoiceView {
  return {
    schemaVersion: invoice.schemaVersion ?? 1,
    documentKind: invoice.documentKind ?? 'LEGACY_BILL',
    documentState:
      invoice.schemaVersion === 2 ? 'AVAILABLE_ON_REQUEST' : 'NOT_CONFIGURED',
    voidedAt: invoice.voidedAt ?? null,
    voidReason: invoice.voidReason ?? null,
    replacementForInvoiceId: invoice.replacementForInvoiceId ?? null,
    supplyDate: (invoice.billingSnapshot?.supplyDate as string) ?? null,
    placeOfSupply: invoice.billingSnapshot?.placeOfSupply
      ? {
          stateCode: (
            invoice.billingSnapshot.placeOfSupply as { stateCode: string }
          ).stateCode,
          context: (
            invoice.billingSnapshot.placeOfSupply as { context: string }
          ).context,
        }
      : null,
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    jobId: invoice.jobId,
    status: invoice.status,
    subtotalInr: inr(invoice.subtotalInr),
    adjustmentInr: inr(invoice.adjustmentInr),
    taxInr: inr(invoice.taxInr),
    totalInr: inr(invoice.totalInr),
    paidInr: inr(invoice.paidInr),
    balanceInr: fromPaise(toPaise(invoice.totalInr) - toPaise(invoice.paidInr)),
    seller: invoice.seller,
    buyer: invoice.buyer,
    notes: invoice.notes,
    upiVpa: invoice.serviceCenter?.upiVpa ?? null,
    issuedAt: invoice.issuedAt,
    paidAt: invoice.paidAt,
    lineItems: [...(invoice.lineItems ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((line) => ({
        kind: line.kind,
        description: line.description,
        partType: line.partType,
        quantity: Number(line.quantity),
        unitPriceInr: inr(line.unitPriceInr),
        amountInr: inr(line.amountInr),
        taxRatePct: inr(line.taxRatePct),
        taxInr: inr(line.taxInr),
        taxSnapshot: line.taxSnapshot ?? null,
      })),
    payments: (invoice.payments ?? []).map((payment) => ({
      id: payment.id,
      method: payment.method,
      amountInr: inr(payment.amountInr),
      reference: payment.reference,
      receivedAt: payment.receivedAt,
    })),
  };
}

/** The short form carried on job views. */
export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  totalInr: string;
  paidInr: string;
  issuedAt: Date;
  paidAt: Date | null;
}

export function toInvoiceSummary(
  invoices: Invoice[] | undefined,
): InvoiceSummary | null {
  const live = (invoices ?? []).find(
    (invoice) => invoice.status !== InvoiceStatus.VOID,
  );
  return live
    ? {
        id: live.id,
        invoiceNumber: live.invoiceNumber,
        status: live.status,
        totalInr: inr(live.totalInr),
        paidInr: inr(live.paidInr),
        issuedAt: live.issuedAt,
        paidAt: live.paidAt,
      }
    : null;
}
