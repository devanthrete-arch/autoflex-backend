import type { FinancialNote } from './entities/financial-note.entity';
import type { Invoice } from './entities/invoice.entity';

/** The source invoice alone cannot confer a mismatched note's authority. */
export function noteMatchesInvoice(
  note: Pick<
    FinancialNote,
    'invoiceId' | 'serviceCenterId' | 'customerProfileId'
  >,
  invoice: Pick<Invoice, 'id' | 'serviceCenterId' | 'customerProfileId'>,
): boolean {
  return (
    !!invoice.customerProfileId &&
    note.invoiceId === invoice.id &&
    note.serviceCenterId === invoice.serviceCenterId &&
    note.customerProfileId === invoice.customerProfileId
  );
}
