import { InvoiceDocument } from './entities/invoice-document.entity';
import { createHash, randomUUID } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import { JobStatus } from '../../common/enums/job-status.enum';
import {
  JobApprovalStatus,
  JobLineKind,
  JobLineStatus,
} from '../../common/enums/job-work.enum';
import { InvoiceStatus } from '../../common/enums/ownership.enum';
import { istToday } from '../../common/time/ist';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { EventsService } from '../events/events.service';
import { JobEventType } from '../../common/enums/job-event-type.enum';
import {
  CommandMeta,
  withCommandReceipt,
} from '../idempotency/transactional-receipt';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { StaffProfile } from '../tenancy/entities/staff-profile.entity';
import { ServiceJob } from '../jobs/entities/service-job.entity';
import { JobLineItem } from '../jobs/entities/job-line-item.entity';
import { JobApproval } from '../jobs/entities/job-approval.entity';
import { JobStoreService } from '../jobs/job-store.service';
import { BillingConfigService } from './billing-config.service';
import { calculateInvoice, validateBuyer } from './billing-calculator';
import { InvoiceSelectionDto } from './dto/invoice-selection.dto';
import { CloseJobDto, IssueInvoiceDto } from './dto/billing.dto';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLineItem } from './entities/invoice-line-item.entity';
import { InvoiceSeries } from './entities/invoice-series.entity';
import { Payment } from './entities/payment.entity';
import { BookingItem } from '../bookings/entities/booking-item.entity';
import { JobsService } from '../jobs/jobs.service';
import { toInvoiceView } from './invoice-view';

const BILLABLE = [JobLineStatus.INCLUDED, JobLineStatus.APPROVED];
const fail = (code: string, message: string): never => {
  throw new UnprocessableEntityException({ code, message });
};

@Injectable()
export class InvoiceWorkflowService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly policies: BillingConfigService,
    private readonly events: EventsService,
    private readonly store: JobStoreService,
    private readonly jobs: JobsService,
  ) {}

  private receiptScope(command: string, auth: AuthContext) {
    return `billing:${command}:${createHash('sha256').update(`${auth.domainId}:${auth.userId}:${auth.serviceCenterId}`).digest('hex').slice(0, 48)}`;
  }

  get enabled() {
    return this.config.get<string>('BILLING_V2_ENABLED') === 'true';
  }
  private assertEnabled() {
    if (!this.enabled)
      fail('BILLING_ROLLOUT_DISABLED', 'The new invoicing flow is not enabled');
  }
  private async authorize(
    auth: AuthContext,
    manager: EntityManager,
    power: string,
  ) {
    if (
      auth.actorType !== 'staff' ||
      !auth.serviceCenterId ||
      !auth.staffProfileId ||
      !auth.roles.some((r) => ['admin', 'manager', 'advisor'].includes(r)) ||
      !auth.permissions.includes(power)
    )
      throw new ForbiddenException('Billing permission is required');
    const staff = await manager.getRepository(StaffProfile).findOneBy({
      id: auth.staffProfileId,
      serviceCenterId: auth.serviceCenterId,
      iamUserId: auth.userId,
      isActive: true,
      deletedAt: IsNull(),
    });
    if (!staff)
      throw new ForbiddenException('This staff profile is unavailable');
  }
  private async centerLock(manager: EntityManager, auth: AuthContext) {
    const center = await manager.getRepository(ServiceCenter).findOne({
      where: { id: auth.serviceCenterId!, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    if (!center) throw new NotFoundException();
  }
  private async job(
    manager: EntityManager,
    auth: AuthContext,
    id: string,
    version?: number,
    lock = false,
  ) {
    const job = await manager.getRepository(ServiceJob).findOne({
      where: {
        id,
        serviceCenterId: auth.serviceCenterId!,
        deletedAt: IsNull(),
      },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!job) throw new NotFoundException();
    if (version !== undefined && job.version !== version)
      throw new ConflictException({
        code: 'STALE_JOB_VERSION',
        currentVersion: job.version,
        message: 'Reload this job before billing',
      });
    return job;
  }
  private async sourceKinds(manager: EntityManager, lines: JobLineItem[]) {
    const ids = lines
      .map((l) => l.sourceBookingItemId)
      .filter((id): id is string => !!id);
    const sources = ids.length
      ? await manager.getRepository(BookingItem).findBy({ id: In(ids) })
      : [];
    const packages = new Set(
      sources.filter((s) => s.servicePackageId).map((s) => s.id),
    );
    return new Map(
      lines.map((l) => [
        l.id,
        l.billingSourceKind ??
          (packages.has(l.sourceBookingItemId!) || (l.scope?.length ?? 0) > 1
            ? ('PACKAGE' as const)
            : l.kind),
      ]),
    );
  }
  private async selection(
    manager: EntityManager,
    job: ServiceJob,
    selection: InvoiceSelectionDto,
    locked: boolean,
    issueDate = istToday(),
  ) {
    if (!selection?.buyer || !Array.isArray(selection.lineRules))
      fail(
        'BILLING_SELECTION_REQUIRED',
        'Confirm the buyer and each line classification',
      );
    const date = selection.supplyDate;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
      date > issueDate
    )
      fail(
        'BILLING_SUPPLY_DATE_INVALID',
        'Use a valid supply date no later than today',
      );
    if (
      !job.billingCustomerProfileId ||
      !job.intakeSnapshot?.customerName?.trim() ||
      !job.intakeSnapshot.customerPhone?.trim() ||
      !job.intakeSnapshot.vehicleRegistration?.trim()
    )
      fail(
        'VISIT_BILLING_IDENTITY_REQUIRED',
        'Review the visit customer and vehicle before issuing a bill',
      );
    const configuration = locked
      ? await this.policies.approved(manager, job.serviceCenterId, issueDate)
      : await this.policies.readActive(job.serviceCenterId, issueDate);
    const policy = configuration.policy;
    validateBuyer(selection.buyer, policy);
    if (
      date < policy.effectiveFrom ||
      (policy.effectiveTo && date > policy.effectiveTo)
    )
      fail(
        'BILLING_SUPPLY_RULE_UNAVAILABLE',
        'The approved rules do not cover this supply date',
      );
    const lines = await manager.getRepository(JobLineItem).find({
      where: { jobId: job.id, deletedAt: IsNull() },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    if (lines.some((l) => l.status === JobLineStatus.PENDING))
      fail(
        'BILLING_APPROVAL_PENDING',
        'Resolve pending work before issuing a bill',
      );
    const pending = await manager
      .getRepository(JobApproval)
      .find({ where: { jobId: job.id } });
    if (pending.some((a) => a.status === JobApprovalStatus.PENDING))
      fail(
        'BILLING_APPROVAL_PENDING',
        'Resolve pending approval before issuing a bill',
      );
    const billable = lines.filter((l) => BILLABLE.includes(l.status));
    if (!billable.length)
      fail('BILLING_EMPTY_SCOPE', 'There is no approved work to invoice');
    const mapping = new Map(
      selection.lineRules.map((row) => [row.lineItemId, row.ruleKey]),
    );
    if (
      mapping.size !== selection.lineRules.length ||
      mapping.size !== billable.length ||
      billable.some((line) => !mapping.has(line.id))
    )
      fail(
        'BILLING_LINE_MAPPING_REQUIRED',
        'Classify every billable line exactly once',
      );
    if (billable.some((l) => l.serviceCenterId !== job.serviceCenterId))
      fail(
        'BILLING_SCOPE_INVALID',
        'Review inconsistent job scope before billing',
      );
    const kinds = await this.sourceKinds(manager, billable);
    const calculated = calculateInvoice(
      policy,
      selection.buyer,
      billable.map((line) => ({
        id: line.id,
        kind: kinds.get(line.id)!,
        description: line.description,
        quantity: line.quantity,
        unitPriceInr: line.unitPriceInr,
        amountInr: line.amountInr,
        scope: line.scope,
        ruleKey: mapping.get(line.id)!,
        discountInr: selection.lineRules.find((r) => r.lineItemId === line.id)
          ?.discountInr,
        discountReason: selection.lineRules.find(
          (r) => r.lineItemId === line.id,
        )?.discountReason,
      })),
      {
        context: selection.supplyContext,
        ruleKey: selection.placeOfSupplyRuleKey,
      },
    );
    const snapshot = {
      configurationId: configuration.id,
      configurationVersion: configuration.version,
      seller: policy.seller,
      buyer: selection.buyer,
      supplyDate: date,
      jobId: job.id,
      jobVersion: job.version,
      recipientProfileId: job.billingCustomerProfileId,
      ...calculated,
      lines: calculated.lines.map((line) => ({
        ...line,
        sourceKind: billable.find((source) => source.id === line.id)!.kind,
      })),
    };
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex');
    return { configuration, calculated, snapshot, fingerprint, billable };
  }
  async options(auth: AuthContext, jobId: string) {
    this.assertEnabled();
    await this.authorize(auth, this.db.manager, 'billing:issue');
    const job = await this.job(this.db.manager, auth, jobId);
    const configuration = await this.policies.readActive(
      job.serviceCenterId,
      istToday(),
    );
    const lines = await this.db.getRepository(JobLineItem).find({
      where: { jobId, deletedAt: IsNull() },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const kinds = await this.sourceKinds(this.db.manager, lines);
    return {
      jobVersion: job.version,
      buyerModes: configuration.policy.buyerModes,
      discounts: configuration.policy.discounts
        ? {
            mode: configuration.policy.discounts.mode,
            maxBps: configuration.policy.discounts.maxBps,
          }
        : null,
      rules: configuration.policy.rules,
      placeOfSupplyRules: configuration.policy.placeOfSupplyRules.map(
        ({ key, context, buyerType, buyerStateCode, supplyStateCode }) => ({
          key,
          context,
          buyerType,
          buyerStateCode,
          supplyStateCode,
        }),
      ),
      lines: lines
        .filter((l) => BILLABLE.includes(l.status))
        .map((l) => ({
          id: l.id,
          description: l.description,
          kind: kinds.get(l.id),
          amountInr: l.amountInr,
        })),
      buyerName: job.intakeSnapshot?.customerName ?? '',
      supplyDate: istToday(),
    };
  }
  async preview(
    auth: AuthContext,
    jobId: string,
    selection: InvoiceSelectionDto,
  ) {
    this.assertEnabled();
    await this.authorize(auth, this.db.manager, 'billing:issue');
    const job = await this.job(this.db.manager, auth, jobId);
    this.store.assertStatus(
      job,
      [JobStatus.READY_FOR_PICKUP],
      'preview the invoice',
    );
    const result = await this.selection(this.db.manager, job, selection, false);
    return {
      ...result.calculated,
      fingerprint: result.fingerprint,
      jobVersion: job.version,
      seller: result.configuration.policy.seller,
      buyer: selection.buyer,
      documentKind: this.kind(
        result.configuration.policy.seller.registrationStatus,
      ),
      blockedReasons:
        selection.buyer.type === 'BUSINESS' &&
        result.configuration.policy.irp.businessMode === 'REQUIRED'
          ? ['BILLING_IRP_INTEGRATION_REQUIRED']
          : [],
    };
  }
  private kind(status: string) {
    return status === 'REGULAR'
      ? 'TAX_INVOICE'
      : status === 'COMPOSITION'
        ? 'BILL_OF_SUPPLY'
        : 'COMMERCIAL_BILL';
  }
  async issue(
    auth: AuthContext,
    id: string,
    dto: IssueInvoiceDto,
    meta: CommandMeta,
  ) {
    this.assertEnabled();
    return this.db.transaction(async (manager) => {
      await this.authorize(auth, manager, 'billing:issue');
      await this.centerLock(manager, auth);
      const receipt = await withCommandReceipt(
        manager,
        this.receiptScope('issue', auth),
        meta,
        async () => {
          const issuedAt = new Date();
          const issueDate = istToday(issuedAt.getTime());
          const job = await this.job(manager, auth, id, meta.version, true);
          this.store.assertStatus(
            job,
            [JobStatus.READY_FOR_PICKUP],
            'issue the invoice',
          );
          if (
            dto.finalAmountInr !== undefined ||
            dto.adjustmentReason ||
            dto.adjustmentNote
          )
            fail(
              'BILLING_ADJUSTMENT_UNSUPPORTED',
              'Add and approve changed work before invoicing; direct total overrides are unavailable',
            );
          if (
            await manager
              .getRepository(Invoice)
              .count({ where: { jobId: id, status: Not(InvoiceStatus.VOID) } })
          )
            throw new ConflictException({
              code: 'INVOICE_ALREADY_ISSUED',
              message:
                'An immutable invoice already exists; use the correction process',
            });
          const result = await this.selection(
            manager,
            job,
            dto.selection!,
            true,
            issueDate,
          );
          if (dto.previewFingerprint !== result.fingerprint)
            throw new ConflictException({
              code: 'INVOICE_PREVIEW_CHANGED',
              message: 'Review a fresh invoice preview',
            });
          const policy = result.configuration.policy;
          if (
            dto.selection!.buyer.type === 'BUSINESS' &&
            policy.irp.businessMode === 'REQUIRED'
          )
            fail(
              'BILLING_IRP_INTEGRATION_REQUIRED',
              'This business invoice requires IRP registration; issuance is unavailable until that integration is configured',
            );
          const today = issueDate;
          const year =
            Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
          const financialYear = `${year}-${year + 1}`;
          const sellerKey =
            policy.seller.gstin ?? `entity:${policy.seller.entityReference}`;
          const repo = manager.getRepository(InvoiceSeries);
          await repo
            .createQueryBuilder()
            .insert()
            .values({
              id: randomUUID(),
              serviceCenterId: job.serviceCenterId,
              sellerKey,
              financialYear,
              seriesPrefix: policy.seriesPrefix,
              nextNumber: policy.initialSequence,
            })
            .orIgnore()
            .execute();
          const series = await repo.findOneOrFail({
            where: {
              sellerKey,
              financialYear,
              seriesPrefix: policy.seriesPrefix,
            },
            lock: { mode: 'pessimistic_write' },
          });
          if (series.nextNumber < policy.initialSequence)
            fail(
              'INVOICE_SERIES_RECONCILIATION_REQUIRED',
              'Review the existing counter before changing the approved numbering cutover',
            );
          if (series.nextNumber > 999999)
            fail(
              'INVOICE_SERIES_EXHAUSTED',
              'Configure a new approved invoice series',
            );
          const invoiceNumber = `${policy.seriesPrefix}/${String(year).slice(-2)}${String(year + 1).slice(-2)}/${String(series.nextNumber).padStart(6, '0')}`;
          await repo.update(series.id, { nextNumber: series.nextNumber + 1 });
          // Freeze legacy inference at issue. Payment must never reclassify a
          // saved charge because its mutable booking/package pointer changed.
          for (const line of result.calculated.lines) {
            const source = result.billable.find(
              (source) => source.id === line.id,
            )!;
            if (!source.billingSourceKind)
              await manager
                .getRepository(JobLineItem)
                .update(
                  { id: source.id, billingSourceKind: IsNull() },
                  { billingSourceKind: line.kind },
                );
          }
          const cancelled = await manager.getRepository(Invoice).findOne({
            where: {
              jobId: id,
              status: InvoiceStatus.VOID,
              schemaVersion: 2,
            },
            order: { issuedAt: 'DESC', id: 'DESC' },
          });
          const invoice = await manager.getRepository(Invoice).save({
            replacementForInvoiceId: cancelled?.id ?? null,
            serviceCenterId: job.serviceCenterId,
            jobId: id,
            customerId: job.customerId,
            customerProfileId: job.billingCustomerProfileId,
            invoiceNumber,
            status: InvoiceStatus.DUE,
            schemaVersion: 2,
            documentKind: this.kind(policy.seller.registrationStatus),
            billingSnapshot: { ...result.snapshot, sellerKey, financialYear },
            snapshotHash: result.fingerprint,
            subtotalInr: result.calculated.subtotalInr,
            adjustmentInr: '0.00',
            taxInr: result.calculated.taxInr,
            totalInr: result.calculated.totalInr,
            paidInr: '0.00',
            seller: { ...policy.seller },
            buyer: {
              ...dto.selection!.buyer,
              phone: job.intakeSnapshot!.customerPhone,
              vehicleRegistration: job.intakeSnapshot!.vehicleRegistration,
              vehicleLabel: job.intakeSnapshot!.vehicleLabel,
            },
            notes: dto.notes?.trim() || null,
            issuedAt,
            issuedByStaffProfileId: auth.staffProfileId,
          });
          await manager
            .getRepository(InvoiceDocument)
            .save({ invoiceId: invoice.id, state: 'PENDING' });
          await manager.getRepository(InvoiceLineItem).save(
            result.calculated.lines.map((line, index) => ({
              invoiceId: invoice.id,
              sourceLineItemId: line.id,
              kind: result.billable.find((l) => l.id === line.id)!.kind,
              description: line.description,
              quantity: line.quantity,
              unitPriceInr: line.unitPriceInr,
              amountInr: line.netInr,
              taxRatePct: (line.rateBps / 100).toFixed(2),
              taxInr: line.taxInr,
              sortOrder: index,
              taxSnapshot: { ...line },
            })),
          );
          await this.store.commit(
            job,
            { finalAmountInr: invoice.totalInr },
            manager,
          );
          await this.events.append(
            {
              jobId: id,
              serviceCenterId: job.serviceCenterId,
              type: JobEventType.INVOICE_ISSUED,
              payload: {
                invoiceId: invoice.id,
                invoiceNumber,
                totalInr: invoice.totalInr,
              },
              staffProfileId: auth.staffProfileId,
            },
            manager,
          );
          await this.events.writeAuditLog(
            {
              serviceCenterId: job.serviceCenterId,
              entityType: 'Invoice',
              entityId: invoice.id,
              action: 'ISSUE',
              actorStaffProfileId: auth.staffProfileId,
              after: { invoiceNumber, snapshotHash: invoice.snapshotHash },
            },
            manager,
          );
          return { invoiceId: invoice.id, jobId: id };
        },
        async (ref) => {
          await this.job(manager, auth, ref.jobId);
        },
      );
      const invoice = await manager.getRepository(Invoice).findOneOrFail({
        where: {
          id: receipt.invoiceId,
          serviceCenterId: auth.serviceCenterId!,
        },
        relations: { lineItems: true, payments: true, serviceCenter: true },
      });
      return toInvoiceView(invoice);
    });
  }
  async close(
    auth: AuthContext,
    id: string,
    dto: CloseJobDto,
    meta: CommandMeta,
  ) {
    this.assertEnabled();
    await this.db.transaction(async (manager) => {
      await this.authorize(auth, manager, 'billing:record-payment');
      if (!auth.permissions.includes('jobs:update'))
        throw new ForbiddenException('Job update permission is required');
      await this.centerLock(manager, auth);
      return withCommandReceipt(
        manager,
        this.receiptScope('close', auth),
        meta,
        async () => {
          const job = await this.job(manager, auth, id, meta.version, true);
          this.store.assertStatus(
            job,
            [JobStatus.READY_FOR_PICKUP],
            'record payment and close',
          );
          if (!dto.invoiceId)
            fail(
              'INVOICE_REFERENCE_REQUIRED',
              'Choose the issued invoice to pay',
            );
          if (
            dto.finalAmountInr !== undefined ||
            dto.adjustmentReason ||
            dto.adjustmentNote ||
            dto.selection ||
            dto.previewFingerprint
          )
            fail(
              'INVOICE_IMMUTABLE',
              'An issued invoice cannot change during payment',
            );
          const invoice = await manager.getRepository(Invoice).findOne({
            where: {
              id: dto.invoiceId,
              jobId: id,
              serviceCenterId: job.serviceCenterId,
            },
            lock: { mode: 'pessimistic_write' },
          });
          if (!invoice || invoice.status !== InvoiceStatus.DUE)
            throw new ConflictException(
              'This invoice is unavailable or already paid',
            );
          if (invoice.schemaVersion === 2) {
            const live = (
              await manager.getRepository(JobLineItem).find({
                where: { jobId: id, deletedAt: IsNull() },
                order: { createdAt: 'ASC', id: 'ASC' },
              })
            ).filter((l) => BILLABLE.includes(l.status));
            const saved = invoice.billingSnapshot?.lines as
              | {
                  id: string;
                  kind: string;
                  sourceKind?: string;
                  description: string;
                  quantity: string;
                  unitPriceInr: string;
                  amountInr: string;
                  scope?: unknown[];
                }[]
              | undefined;
            const facts = (lines: typeof saved) =>
              JSON.stringify(
                lines?.map((l) => ({
                  id: l.id,
                  kind: l.kind,
                  sourceKind: l.sourceKind,
                  description: l.description,
                  quantity: l.quantity,
                  unitPriceInr: l.unitPriceInr,
                  amountInr: l.amountInr,
                  scope: l.scope ?? [],
                })),
              );
            const historicalLines = await manager
              .getRepository(InvoiceLineItem)
              .findBy({ invoiceId: invoice.id });
            const savedById = new Map(saved?.map((line) => [line.id, line]));
            const historicalKind = new Map(
              historicalLines
                .filter((line) => line.sourceLineItemId)
                .map((line) => [line.sourceLineItemId!, line.kind]),
            );
            const pending = await manager.getRepository(JobLineItem).countBy({
              jobId: id,
              status: JobLineStatus.PENDING,
              deletedAt: IsNull(),
            });
            if (
              !saved ||
              pending ||
              facts(
                live.map((l) => ({
                  ...l,
                  kind:
                    l.billingSourceKind ?? savedById.get(l.id)?.kind ?? l.kind,
                  sourceKind: l.kind,
                })),
              ) !==
                facts(
                  saved?.map((l) => ({
                    ...l,
                    sourceKind: l.sourceKind ?? historicalKind.get(l.id),
                  })),
                )
            )
              throw new ConflictException({
                code: 'INVOICE_SCOPE_CHANGED',
                message:
                  'The job scope changed after issue; review the invoice correction before collecting payment',
              });
          }
          if (
            job.skippedSteps?.length &&
            [
              'work_verified',
              'road_test',
              'no_tools_left',
              'customer_briefed',
            ].some((k) => dto.closeChecklist?.[k] !== true)
          )
            fail(
              'CLOSE_CHECKLIST_REQUIRED',
              'Complete the close checklist for skipped steps',
            );
          const returned = dto.returnedPartLineIds ?? [];
          if (new Set(returned).size !== returned.length)
            fail('RETURNED_PART_INVALID', 'Choose each returned part once');
          const parts = returned.length
            ? await manager.getRepository(JobLineItem).findBy({
                id: In(returned),
                jobId: id,
                kind: JobLineKind.PART,
                status: In(BILLABLE),
                deletedAt: IsNull(),
              })
            : [];
          if (parts.length !== returned.length)
            fail(
              'RETURNED_PART_INVALID',
              'Returned parts must belong to this invoice job',
            );
          const paise = (value: string) => BigInt(value.replace('.', ''));
          if (
            !/^\d+\.\d{2}$/.test(invoice.totalInr) ||
            !/^0(?:\.00)?$/.test(invoice.paidInr)
          )
            fail(
              'INVOICE_PAYMENT_STATE_INVALID',
              'Review the saved invoice payment state',
            );
          const amount = paise(invoice.totalInr);
          if (amount > 0n && !dto.payment)
            fail('PAYMENT_REQUIRED', 'Record the full counter payment');
          const now = new Date();
          if (dto.payment) {
            const value = dto.payment.amountInr.toFixed(2);
            if (paise(value) !== amount || amount === 0n)
              fail(
                'PAYMENT_AMOUNT_MISMATCH',
                'The payment must match the issued total',
              );
            const reference = dto.payment.reference?.trim() || null;
            if (
              reference &&
              (await manager
                .getRepository(Payment)
                .createQueryBuilder('p')
                .where(
                  'p.service_center_id = :center AND p.method = :method AND lower(trim(p.reference)) = :reference',
                  {
                    center: job.serviceCenterId,
                    method: dto.payment.method,
                    reference: reference.toLowerCase(),
                  },
                )
                .getCount())
            )
              throw new ConflictException({
                code: 'PAYMENT_REFERENCE_USED',
                message:
                  'This center has already recorded that payment reference',
              });
            const dedupeKey = reference
              ? createHash('sha256')
                  .update(
                    JSON.stringify([
                      job.serviceCenterId,
                      dto.payment.method,
                      reference.toLowerCase(),
                    ]),
                  )
                  .digest('hex')
              : null;
            await manager.getRepository(Payment).save({
              invoiceId: invoice.id,
              serviceCenterId: job.serviceCenterId,
              method: dto.payment.method,
              amountInr: invoice.totalInr,
              reference,
              dedupeKey,
              receivedAt: now,
              receivedByStaffProfileId: auth.staffProfileId,
            });
            await this.events.append(
              {
                jobId: id,
                serviceCenterId: job.serviceCenterId,
                type: JobEventType.PAYMENT_RECORDED,
                payload: {
                  invoiceNumber: invoice.invoiceNumber,
                  amountInr: invoice.totalInr,
                  method: dto.payment.method,
                },
                staffProfileId: auth.staffProfileId,
              },
              manager,
            );
          }
          await manager.getRepository(Invoice).update(invoice.id, {
            status: InvoiceStatus.PAID,
            paidInr: invoice.totalInr,
            paidAt: now,
          });
          if (returned.length)
            await manager
              .getRepository(JobLineItem)
              .update({ id: In(returned) }, { partReturnedAt: now });
          await this.store.commit(
            job,
            {
              status: JobStatus.COMPLETED,
              closedAt: now,
              finalAmountInr: invoice.totalInr,
              finalNotes: dto.finalNotes?.trim() || null,
              closeChecklist: dto.closeChecklist ?? null,
            },
            manager,
          );
          await this.events.appendStatusChange(
            {
              jobId: id,
              serviceCenterId: job.serviceCenterId,
              fromStatus: JobStatus.READY_FOR_PICKUP,
              toStatus: JobStatus.COMPLETED,
              staffProfileId: auth.staffProfileId,
            },
            manager,
          );
          await this.events.writeAuditLog(
            {
              serviceCenterId: job.serviceCenterId,
              entityType: 'Invoice',
              entityId: invoice.id,
              action: 'PAY_AND_CLOSE',
              actorStaffProfileId: auth.staffProfileId,
              after: {
                jobId: id,
                totalInr: invoice.totalInr,
                method: dto.payment?.method ?? null,
              },
            },
            manager,
          );
          return { id, invoiceId: invoice.id, version: job.version };
        },
        async (saved) => {
          await this.job(manager, auth, saved.id);
        },
      );
    });
    return this.jobs.findOne(auth, id);
  }
}
