import { InvoiceStatus } from '../../common/enums/ownership.enum';
import { inr } from '../../common/money';
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
}

export interface PaymentView {
  id: string;
  method: string;
  amountInr: string;
  reference: string | null;
  receivedAt: Date;
}

export interface InvoiceView {
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
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    jobId: invoice.jobId,
    status: invoice.status,
    subtotalInr: inr(invoice.subtotalInr),
    adjustmentInr: inr(invoice.adjustmentInr),
    taxInr: inr(invoice.taxInr),
    totalInr: inr(invoice.totalInr),
    paidInr: inr(invoice.paidInr),
    balanceInr: inr(Number(invoice.totalInr) - Number(invoice.paidInr)),
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
