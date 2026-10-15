import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { JobEventType } from '../../common/enums/job-event-type.enum';
import { JobStatus } from '../../common/enums/job-status.enum';
import { JobLineKind, JobLineStatus } from '../../common/enums/job-work.enum';
import {
  AmountAdjustmentReason,
  InvoiceStatus,
  PaymentMethod,
} from '../../common/enums/ownership.enum';
import { fromPaise, toPaise } from '../../common/money';
import { generateReference } from '../../common/reference-number';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { MeService } from '../customers/me.service';
import { EventsService } from '../events/events.service';
import { JobLineItem } from '../jobs/entities/job-line-item.entity';
import { ServiceJob } from '../jobs/entities/service-job.entity';
import { JobStoreService } from '../jobs/job-store.service';
import { JobDetailView } from '../jobs/job-view';
import { JobsService } from '../jobs/jobs.service';
import {
  CloseJobDto,
  IssueInvoiceDto,
  PaymentInputDto,
} from './dto/billing.dto';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';
import { Invoice } from './entities/invoice.entity';
import { Payment } from './entities/payment.entity';
import { InvoiceView, toInvoiceView } from './invoice-view';

/** Every item must be ticked when inspection or QC was skipped. */
export const CLOSE_CHECKLIST_KEYS = [
  'work_verified',
  'road_test',
  'no_tools_left',
  'customer_briefed',
] as const;

const BILLABLE = [JobLineStatus.INCLUDED, JobLineStatus.APPROVED];

const ADJUSTMENT_LABELS: Record<AmountAdjustmentReason, string> = {
  [AmountAdjustmentReason.DISCOUNT]: 'Discount',
  [AmountAdjustmentReason.GOODWILL]: 'Goodwill adjustment',
  [AmountAdjustmentReason.ROUNDING]: 'Rounding',
  [AmountAdjustmentReason.EXTRA_LABOUR]: 'Additional labour',
  [AmountAdjustmentReason.PARTS_PRICE_CHANGE]: 'Parts price change',
  [AmountAdjustmentReason.OTHER]: 'Adjustment',
};

const INVOICE_RELATIONS = {
  lineItems: true,
  payments: true,
  serviceCenter: true,
} as const;

@Injectable()
export class BillingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly store: JobStoreService,
    private readonly jobsService: JobsService,
    private readonly eventsService: EventsService,
    private readonly meService: MeService,
  ) {}

  /** Issues the bill before pickup so the owner sees the amount due. */
  async issue(
    auth: AuthContext,
    jobId: string,
    dto: IssueInvoiceDto,
    expectedVersion?: number,
  ): Promise<InvoiceView> {
    const job = await this.loadForBilling(auth, jobId, expectedVersion);
    const invoice = await this.dataSource.transaction(async (manager) => {
      const issued = await this.issueWithin(manager, auth, job, dto, false);
      await this.store.commit(
        job,
        this.amountChanges(job, dto, issued),
        manager,
      );
      return issued;
    });
    return this.getById(invoice.id);
  }

  async getForJob(auth: AuthContext, jobId: string): Promise<InvoiceView> {
    await this.store.get(auth.serviceCenterId!, jobId);
    const invoice = await this.invoiceRepository.findOne({
      where: { jobId, status: Not(InvoiceStatus.VOID) },
      relations: INVOICE_RELATIONS,
    });
    if (!invoice) throw new NotFoundException('No bill issued for this job');
    return toInvoiceView(invoice);
  }

  /**
   * Records payment and completes the job. The bill is issued here when it
   * was not issued earlier, or reissued when the amount changed.
   */
  async close(
    auth: AuthContext,
    jobId: string,
    dto: CloseJobDto,
    expectedVersion?: number,
  ): Promise<JobDetailView> {
    const job = await this.loadForBilling(auth, jobId, expectedVersion);
    this.assertChecklist(job, dto.closeChecklist);
    const returned = await this.returnedParts(job, dto.returnedPartLineIds);

    await this.dataSource.transaction(async (manager) => {
      const invoice = await this.issueWithin(manager, auth, job, dto, true);
      const now = new Date();
      const method = await this.recordPayment(
        manager,
        auth,
        job,
        invoice,
        dto.payment,
        now,
      );
      await manager.getRepository(Invoice).update(
        { id: invoice.id },
        {
          status: InvoiceStatus.PAID,
          paidInr: invoice.totalInr,
          paidAt: now,
        },
      );
      if (returned.length) {
        await manager
          .getRepository(JobLineItem)
          .update({ id: In(returned) }, { partReturnedAt: now });
      }

      await this.store.commit(
        job,
        {
          ...this.amountChanges(job, dto, invoice),
          status: JobStatus.COMPLETED,
          closedAt: now,
          finalNotes: dto.finalNotes?.trim() || null,
          closeChecklist: dto.closeChecklist ?? null,
        },
        manager,
      );
      if (method) {
        await this.eventsService.append(
          {
            jobId,
            serviceCenterId: job.serviceCenterId,
            type: JobEventType.PAYMENT_RECORDED,
            payload: {
              invoiceNumber: invoice.invoiceNumber,
              amountInr: invoice.totalInr,
              method,
            },
            staffProfileId: auth.staffProfileId,
          },
          manager,
        );
      }
      await this.eventsService.appendStatusChange(
        {
          jobId,
          serviceCenterId: job.serviceCenterId,
          fromStatus: JobStatus.READY_FOR_PICKUP,
          toStatus: JobStatus.COMPLETED,
          staffProfileId: auth.staffProfileId,
          note: returned.length
            ? `${returned.length} replaced part(s) returned to the owner`
            : undefined,
        },
        manager,
      );
      await this.eventsService.writeAuditLog(
        {
          serviceCenterId: job.serviceCenterId,
          entityType: 'ServiceJob',
          entityId: jobId,
          action: 'CLOSE',
          actorStaffProfileId: auth.staffProfileId,
          after: {
            invoiceNumber: invoice.invoiceNumber,
            totalInr: invoice.totalInr,
            method,
            adjustmentReason: dto.adjustmentReason ?? null,
          },
        },
        manager,
      );
    });

    return this.jobsService.findOne(auth, jobId);
  }

  async listForCenter(
    auth: AuthContext,
    status?: InvoiceStatus,
  ): Promise<InvoiceView[]> {
    const rows = await this.invoiceRepository.find({
      where: {
        serviceCenterId: auth.serviceCenterId!,
        ...(status ? { status } : {}),
      },
      relations: INVOICE_RELATIONS,
      order: { issuedAt: 'DESC' },
      take: 200,
    });
    return rows.map(toInvoiceView);
  }

  async listForCustomer(auth: AuthContext): Promise<InvoiceView[]> {
    const profile = await this.meService.ensureProfile(auth);
    const rows = await this.invoiceRepository.find({
      where: {
        customerProfileId: profile.id,
        status: Not(InvoiceStatus.VOID),
      },
      relations: INVOICE_RELATIONS,
      order: { issuedAt: 'DESC' },
    });
    return rows.map(toInvoiceView);
  }

  async getForCustomer(auth: AuthContext, id: string): Promise<InvoiceView> {
    const profile = await this.meService.ensureProfile(auth);
    const invoice = await this.invoiceRepository.findOne({
      where: {
        id,
        customerProfileId: profile.id,
        status: Not(InvoiceStatus.VOID),
      },
      relations: INVOICE_RELATIONS,
    });
    if (!invoice) throw new NotFoundException();
    return toInvoiceView(invoice);
  }

  private async getById(id: string): Promise<InvoiceView> {
    const invoice = await this.invoiceRepository.findOneOrFail({
      where: { id },
      relations: INVOICE_RELATIONS,
    });
    return toInvoiceView(invoice);
  }

  private async loadForBilling(
    auth: AuthContext,
    jobId: string,
    expectedVersion?: number,
  ): Promise<ServiceJob> {
    const job = await this.store.get(auth.serviceCenterId!, jobId, {
      expectedVersion,
      relations: {
        customer: true,
        vehicle: true,
        serviceCenter: true,
        lineItems: true,
      },
    });
    this.store.assertStatus(job, [JobStatus.READY_FOR_PICKUP], 'bill the job');
    return job;
  }

  /**
   * Reuses a due bill with the same total; otherwise voids it and issues a
   * fresh one, so the paid bill always matches what was collected.
   */
  private async issueWithin(
    manager: EntityManager,
    auth: AuthContext,
    job: ServiceJob,
    dto: IssueInvoiceDto,
    closing: boolean,
  ): Promise<Invoice> {
    const lines = (job.lineItems ?? [])
      .filter((line) => !line.deletedAt && BILLABLE.includes(line.status))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const subtotal = lines.reduce(
      (sum, line) => sum + toPaise(line.amountInr),
      0,
    );
    const total =
      dto.finalAmountInr !== undefined ? toPaise(dto.finalAmountInr) : subtotal;
    const adjustment = total - subtotal;
    if (adjustment !== 0 && !dto.adjustmentReason) {
      throw new UnprocessableEntityException(
        `The billed ₹${fromPaise(total)} differs from the approved ₹${fromPaise(subtotal)}; give an adjustment reason`,
      );
    }
    if (
      dto.adjustmentReason === AmountAdjustmentReason.OTHER &&
      !dto.adjustmentNote?.trim()
    ) {
      throw new UnprocessableEntityException(
        'Describe the adjustment when the reason is OTHER',
      );
    }

    const invoices = manager.getRepository(Invoice);
    const existing = await invoices.findOne({
      where: { jobId: job.id, status: Not(InvoiceStatus.VOID) },
    });
    if (existing?.status === InvoiceStatus.PAID) {
      throw new ConflictException('This job is already paid');
    }
    if (existing && toPaise(existing.totalInr) === total && closing) {
      return existing;
    }
    // Preserve an already issued bill, while refusing any new/reissued bill
    // whose legacy visit lacks an attributable customer and plate snapshot.
    if (
      !job.billingCustomerProfileId ||
      !job.intakeSnapshot?.customerPhone?.trim() ||
      !job.intakeSnapshot.vehicleRegistration?.trim()
    ) {
      throw new UnprocessableEntityException({
        code: 'VISIT_BILLING_IDENTITY_REQUIRED',
        message: 'Review the visit customer and vehicle before issuing a bill',
      });
    }
    if (existing) {
      await invoices.update(
        { id: existing.id },
        { status: InvoiceStatus.VOID },
      );
    }

    const center = job.serviceCenter;
    const address = [
      center.addressLine1,
      center.addressLine2,
      center.city,
      center.state,
      center.postalCode,
    ]
      .filter(Boolean)
      .join(', ');
    const invoice = await invoices.save(
      invoices.create({
        serviceCenterId: job.serviceCenterId,
        jobId: job.id,
        customerId: job.customerId,
        customerProfileId: job.billingCustomerProfileId,
        invoiceNumber: generateReference('INV'),
        status: InvoiceStatus.DUE,
        subtotalInr: fromPaise(subtotal),
        adjustmentInr: fromPaise(adjustment),
        taxInr: '0.00',
        totalInr: fromPaise(total),
        paidInr: '0.00',
        seller: {
          name: center.displayName ?? center.name,
          gstin: center.gstin,
          phone: center.publicPhone,
          address: address || center.formattedAddress,
        },
        buyer: {
          name: job.intakeSnapshot?.customerName ?? null,
          phone: job.intakeSnapshot?.customerPhone ?? null,
          vehicleRegistration: job.intakeSnapshot?.vehicleRegistration ?? null,
          vehicleLabel: job.intakeSnapshot?.vehicleLabel ?? null,
        },
        notes: dto.notes?.trim() || null,
        issuedAt: new Date(),
        issuedByStaffProfileId: auth.staffProfileId,
      }),
    );

    const invoiceLines = manager.getRepository(InvoiceLineItem);
    const snapshot = lines.map((line, index) =>
      invoiceLines.create({
        invoiceId: invoice.id,
        sourceLineItemId: line.id,
        kind: line.kind,
        description: line.description,
        partType: line.partType,
        quantity: line.quantity,
        unitPriceInr: line.unitPriceInr,
        amountInr: line.amountInr,
        sortOrder: index,
      }),
    );
    if (adjustment !== 0) {
      snapshot.push(
        invoiceLines.create({
          invoiceId: invoice.id,
          kind: 'ADJUSTMENT',
          description:
            dto.adjustmentNote?.trim() ||
            ADJUSTMENT_LABELS[dto.adjustmentReason!],
          quantity: '1',
          unitPriceInr: fromPaise(adjustment),
          amountInr: fromPaise(adjustment),
          sortOrder: snapshot.length,
        }),
      );
    }
    await invoiceLines.save(snapshot);

    await this.eventsService.append(
      {
        jobId: job.id,
        serviceCenterId: job.serviceCenterId,
        type: JobEventType.INVOICE_ISSUED,
        payload: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          totalInr: invoice.totalInr,
          paidAtCounter: closing,
        },
        staffProfileId: auth.staffProfileId,
      },
      manager,
    );
    return invoice;
  }

  /** Returns the method used, or null for a zero bill that needs no payment. */
  private async recordPayment(
    manager: EntityManager,
    auth: AuthContext,
    job: ServiceJob,
    invoice: Invoice,
    payment: PaymentInputDto | undefined,
    now: Date,
  ): Promise<PaymentMethod | null> {
    const due = toPaise(invoice.totalInr);
    if (!payment) {
      if (due === 0) return null;
      throw new UnprocessableEntityException(
        `Record the payment of ₹${invoice.totalInr} to close the job`,
      );
    }
    if (toPaise(payment.amountInr) !== due) {
      throw new UnprocessableEntityException(
        `Payment of ₹${fromPaise(toPaise(payment.amountInr))} does not match the bill of ₹${invoice.totalInr}; correct the amount or give an adjustment reason`,
      );
    }
    const payments = manager.getRepository(Payment);
    const reference = payment.reference?.trim() || null;
    if (reference) {
      const clash = await payments.findOne({
        where: { method: payment.method, reference },
      });
      if (clash) {
        throw new ConflictException(
          'This payment reference is already recorded',
        );
      }
    }
    await payments.save(
      payments.create({
        invoiceId: invoice.id,
        serviceCenterId: job.serviceCenterId,
        method: payment.method,
        amountInr: invoice.totalInr,
        reference,
        receivedAt: now,
        receivedByStaffProfileId: auth.staffProfileId,
      }),
    );
    return payment.method;
  }

  private amountChanges(
    job: ServiceJob,
    dto: IssueInvoiceDto,
    invoice: Invoice,
  ): QueryDeepPartialEntity<ServiceJob> {
    const adjusted = toPaise(invoice.adjustmentInr) !== 0;
    return {
      finalAmountInr: invoice.totalInr,
      amountAdjustmentReason: adjusted ? (dto.adjustmentReason ?? null) : null,
      amountAdjustmentNote: adjusted
        ? dto.adjustmentNote?.trim() || null
        : null,
    };
  }

  private assertChecklist(
    job: ServiceJob,
    checklist: Record<string, boolean> | undefined,
  ): void {
    if (!job.skippedSteps?.length) return;
    const missing = CLOSE_CHECKLIST_KEYS.filter(
      (key) => checklist?.[key] !== true,
    );
    if (missing.length) {
      throw new UnprocessableEntityException(
        `Steps were skipped on this job, so the close checklist is required: ${missing.join(', ')}`,
      );
    }
  }

  private async returnedParts(
    job: ServiceJob,
    ids: string[] | undefined,
  ): Promise<string[]> {
    if (!ids?.length) return [];
    const parts = await this.dataSource.getRepository(JobLineItem).find({
      where: {
        id: In(ids),
        jobId: job.id,
        kind: JobLineKind.PART,
        status: In(BILLABLE),
        deletedAt: IsNull(),
      },
    });
    if (parts.length !== new Set(ids).size) {
      throw new UnprocessableEntityException(
        'Returned parts must be billed part lines on this job',
      );
    }
    return parts.map((part) => part.id);
  }
}
