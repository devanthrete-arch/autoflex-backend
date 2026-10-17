import { FinancialNoteService } from './financial-note.service';
import { FinancialNote } from './entities/financial-note.entity';
import {
  StaffFinancialNoteController,
  CustomerFinancialNoteController,
  FinanceFinancialNoteController,
} from './financial-note.controller';
import { ReceptionRateLimitGuard } from '../reception/reception-rate-limit.guard';
import { InvoiceCorrectionController } from './invoice-correction.controller';
import { InvoiceCorrectionService } from './invoice-correction.service';
import { InvoiceDocument } from './entities/invoice-document.entity';
import { InvoiceDocumentService } from './documents/invoice-document.service';
import { PrivateInvoiceStorage } from './documents/private-invoice-storage';
import {
  CustomerFinancialNoteDocumentController,
  StaffFinancialNoteDocumentController,
  FinanceFinancialNoteDocumentController,
  CustomerInvoiceDocumentController,
  StaffInvoiceDocumentController,
} from './documents/invoice-document.controller';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { EventsModule } from '../events/events.module';
import { JobsModule } from '../jobs/jobs.module';
import {
  CenterInvoicesController,
  CustomerInvoicesController,
  JobBillingController,
} from './billing.controller';
import { BillingService } from './billing.service';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';
import { Invoice } from './entities/invoice.entity';
import { Payment } from './entities/payment.entity';
import { BillingConfiguration } from './entities/billing-configuration.entity';
import { InvoiceSeries } from './entities/invoice-series.entity';
import {
  BillingConfigController,
  BillingReadinessController,
} from './billing-config.controller';
import { BillingConfigService } from './billing-config.service';
import { InvoiceWorkflowService } from './invoice-workflow.service';
import { BillingWriteGuard } from './billing-write.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invoice,
      FinancialNote,
      InvoiceDocument,
      InvoiceLineItem,
      Payment,
      BillingConfiguration,
      InvoiceSeries,
    ]),
    JobsModule,
    EventsModule,
    CustomersModule,
  ],
  controllers: [
    JobBillingController,
    StaffFinancialNoteController,
    CustomerFinancialNoteController,
    FinanceFinancialNoteController,
    InvoiceCorrectionController,
    CustomerInvoiceDocumentController,
    StaffInvoiceDocumentController,
    CustomerFinancialNoteDocumentController,
    StaffFinancialNoteDocumentController,
    FinanceFinancialNoteDocumentController,
    CenterInvoicesController,
    CustomerInvoicesController,
    BillingConfigController,
    BillingReadinessController,
  ],
  providers: [
    BillingService,
    FinancialNoteService,
    ReceptionRateLimitGuard,
    InvoiceCorrectionService,
    InvoiceDocumentService,
    PrivateInvoiceStorage,
    BillingConfigService,
    InvoiceWorkflowService,
    BillingWriteGuard,
  ],
  exports: [BillingConfigService],
})
export class BillingModule {}
