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

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceLineItem, Payment]),
    JobsModule,
    EventsModule,
    CustomersModule,
  ],
  controllers: [
    JobBillingController,
    CenterInvoicesController,
    CustomerInvoicesController,
  ],
  providers: [BillingService],
})
export class BillingModule {}
