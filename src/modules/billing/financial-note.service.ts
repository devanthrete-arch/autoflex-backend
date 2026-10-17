import { CustomerNotification } from '../notifications/entities/customer-notification.entity';
import { NotificationCategory } from '../../common/enums/ownership.enum';
import { createHash, randomUUID } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import {
  InvoiceStatus,
  PaymentMethod,
} from '../../common/enums/ownership.enum';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { istToday } from '../../common/time/ist';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { MeService } from '../customers/me.service';
import { AuditLog } from '../events/entities/audit-log.entity';
import {
  CommandMeta,
  withCommandReceipt,
} from '../idempotency/transactional-receipt';
import { ServiceJob } from '../jobs/entities/service-job.entity';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { StaffProfile } from '../tenancy/entities/staff-profile.entity';
import { BillingConfigService } from './billing-config.service';
import {
  IssueNoteDto,
  NoteDecisionDto,
  NotePaymentDto,
  ProposeNoteDto,
} from './dto/financial-note.dto';
import { FinancialNote, NoteLine } from './entities/financial-note.entity';
import { Invoice } from './entities/invoice.entity';
import { InvoiceDocument } from './entities/invoice-document.entity';
import { InvoiceSeries } from './entities/invoice-series.entity';
import { Payment } from './entities/payment.entity';
import { noteMatchesInvoice } from './financial-note-source';

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
const fail = (code: string, message: string): never => {
  throw new UnprocessableEntityException({ code, message });
};
const minor = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value))
    return fail(
      'NOTE_AMOUNT_INVALID',
      'Use a nonnegative INR amount with at most two decimal places',
    );
  const [whole, part = ''] = value.split('.');
  const amount = BigInt(whole) * 100n + BigInt(part.padEnd(2, '0'));
  if (amount > 999999999999n)
    return fail('NOTE_AMOUNT_INVALID', 'Amount exceeds the supported range');
  return amount;
};
const money = (amount: bigint) => {
  if (amount < 0n || amount > 999999999999n)
    return fail('NOTE_AMOUNT_INVALID', 'Amount exceeds the supported range');
  return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
};
const round = (n: bigint, d: bigint) => (n + d / 2n) / d;

@Injectable()
export class FinancialNoteService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly policies: BillingConfigService,
    private readonly me: MeService,
  ) {}
  private principal(a: AuthContext) {
    return `${a.domainId}:${a.userId}`;
  }
  private scope(a: AuthContext) {
    return `note:${createHash('sha256').update(this.principal(a)).digest('hex')}`;
  }
  private enabled() {
    if (this.config.get('BILLING_V2_ENABLED') !== 'true')
      fail('BILLING_ROLLOUT_DISABLED', 'Financial notes are not enabled');
  }
  private async center(m: EntityManager, id: string, lock = false) {
    const center = await m.getRepository(ServiceCenter).findOne({
      where: { id, status: ServiceCenterStatus.ACTIVE },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!center) throw new NotFoundException();
  }
  private async staff(a: AuthContext, m: EntityManager, permission: string) {
    if (
      a.actorType !== 'staff' ||
      !a.staffProfileId ||
      !a.serviceCenterId ||
      !a.roles.some((r) => ['admin', 'manager', 'advisor'].includes(r)) ||
      !a.permissions.includes(permission)
    )
      throw new ForbiddenException();
    if (
      !(await m.getRepository(StaffProfile).existsBy({
        id: a.staffProfileId,
        iamUserId: a.userId,
        serviceCenterId: a.serviceCenterId,
        isActive: true,
      }))
    )
      throw new ForbiddenException();
  }
  private async source(m: EntityManager, id: string) {
    const invoice = await m
      .getRepository(Invoice)
      .findOne({ where: { id }, relations: { lineItems: true } });
    if (!invoice) throw new NotFoundException();
    return invoice;
  }
  private async access(a: AuthContext, invoice: Invoice, m: EntityManager) {
    if (a.actorType === 'finance') this.policies.finance(a);
    else if (a.actorType === 'staff') {
      await this.staff(a, m, 'jobs:read');
      if (a.serviceCenterId !== invoice.serviceCenterId)
        throw new NotFoundException();
      await this.center(m, invoice.serviceCenterId);
    } else if (a.actorType === 'customer') {
      const p = await this.me.ensureProfile(a);
      if (
        p.id !== invoice.customerProfileId ||
        !(await m
          .getRepository(CustomerProfile)
          .existsBy({ id: p.id, iamUserId: a.userId }))
      )
        throw new NotFoundException();
    } else throw new NotFoundException();
  }
  private version(row: FinancialNote, meta: CommandMeta) {
    if (row.version !== meta.version)
      throw new ConflictException({
        code: 'NOTE_VERSION_CONFLICT',
        message: 'The correction changed. Refresh before continuing.',
      });
  }
  private async policy(m: EntityManager, invoice: Invoice) {
    const configuration = await this.policies.approved(
      m,
      invoice.serviceCenterId,
      istToday(),
    );
    const p = configuration.policy;
    if (!p.corrections)
      fail(
        'NOTE_POLICY_REQUIRED',
        'Autoflex finance must approve correction rules and separate number series',
      );
    if (
      invoice.schemaVersion !== 2 ||
      invoice.status !== InvoiceStatus.PAID ||
      !invoice.snapshotHash ||
      !invoice.customerProfileId
    )
      fail(
        'NOTE_SOURCE_UNSUPPORTED',
        'Only a paid snapshot invoice can receive a financial note',
      );
    if (
      p.seller.gstin !== invoice.seller.gstin ||
      p.seller.registrationStatus !==
        (invoice.billingSnapshot?.seller as { registrationStatus?: string })
          ?.registrationStatus ||
      (!p.seller.gstin &&
        p.seller.entityReference !==
          (invoice.billingSnapshot?.seller as { entityReference?: string })
            ?.entityReference)
    )
      fail(
        'NOTE_SELLER_REVIEW_REQUIRED',
        'The current legal seller differs from the original invoice',
      );
    const days = Math.floor(
      (Date.parse(istToday()) -
        Date.parse(istToday(invoice.issuedAt.getTime()))) /
        86400000,
    );
    if (days < 0 || days > p.corrections!.maxAgeDays)
      fail(
        'NOTE_PERIOD_REVIEW_REQUIRED',
        'The original invoice is outside this center’s approved correction period',
      );
    if (invoice.buyer.type === 'BUSINESS' && p.irp.businessMode === 'REQUIRED')
      fail(
        'BILLING_IRP_INTEGRATION_REQUIRED',
        'This correction requires IRP registration; no note number has been allocated',
      );
    return configuration;
  }
  private async calculate(
    m: EntityManager,
    invoice: Invoice,
    dto: ProposeNoteDto,
  ): Promise<NoteLine[]> {
    if (
      !['CREDIT', 'DEBIT'].includes(dto.kind) ||
      !dto.reason?.trim() ||
      !dto.lines?.length ||
      dto.lines.length > 200 ||
      new Set(dto.lines.map((l) => l.sourceLineId)).size !== dto.lines.length
    )
      fail(
        'NOTE_LINES_INVALID',
        'Choose each original invoice line once and record a reason',
      );
    const credits =
      dto.kind === 'CREDIT'
        ? await m
            .getRepository(FinancialNote)
            .findBy({ invoiceId: invoice.id, kind: 'CREDIT', state: 'ISSUED' })
        : [];
    return dto.lines.map((input) => {
      const original = invoice.lineItems.find(
        (l) => l.id === input.sourceLineId,
      );
      const saved = original?.taxSnapshot;
      if (!original || !saved)
        return fail(
          'NOTE_LINE_UNAVAILABLE',
          'Every correction must reference an original classified invoice line',
        );
      const net = minor(input.netInr);
      if (!net)
        return fail(
          'NOTE_AMOUNT_INVALID',
          'Correction amounts must be positive',
        );
      const originalNet = minor(saved.netInr);
      const prior = credits
        .flatMap((c) => c.lines)
        .filter((l) => l.sourceLineId === input.sourceLineId);
      const creditedNet = prior.reduce((s, l) => s + minor(l.netInr), 0n);
      if (
        dto.kind === 'CREDIT' &&
        (originalNet === 0n || creditedNet + net > originalNet)
      )
        return fail(
          'NOTE_CREDIT_LIMIT',
          'Cumulative credits cannot exceed an original line’s net amount',
        );
      const parts = { cgstInr: 0n, sgstInr: 0n, igstInr: 0n };
      if (dto.kind === 'CREDIT') {
        for (const key of ['cgstInr', 'sgstInr', 'igstInr'] as const) {
          const used = prior.reduce((s, l) => s + minor(l[key]), 0n);
          // Cumulative allocation preserves every original component, including odd paisa.
          parts[key] =
            round((creditedNet + net) * minor(saved[key]), originalNet) - used;
        }
      } else if (saved.treatment === 'TAXABLE') {
        const rate = saved.rateBps;
        if (
          !Number.isSafeInteger(rate) ||
          Number(rate) < 0 ||
          Number(rate) > 10000
        )
          return fail(
            'NOTE_SOURCE_UNSUPPORTED',
            'The original tax rate needs review',
          );
        const tax = round(net * BigInt(Number(rate)), 10000n);
        const supply = invoice.billingSnapshot?.placeOfSupply as {
          stateCode: string;
        };
        if (!supply?.stateCode)
          return fail(
            'NOTE_SOURCE_UNSUPPORTED',
            'Original place of supply is missing',
          );
        if (invoice.seller.stateCode !== supply.stateCode) parts.igstInr = tax;
        else {
          parts.cgstInr = tax / 2n;
          parts.sgstInr = tax - parts.cgstInr;
        }
      }
      const tax = parts.cgstInr + parts.sgstInr + parts.igstInr;
      return {
        sourceLineId: input.sourceLineId,
        description: original.description,
        classificationCode: String(saved.classificationCode),
        netInr: money(net),
        cgstInr: money(parts.cgstInr),
        sgstInr: money(parts.sgstInr),
        igstInr: money(parts.igstInr),
        taxInr: money(tax),
        totalInr: money(net + tax),
        rateBps: Number(saved.rateBps),
        treatment: String(saved.treatment),
      };
    });
  }
  private view(note: FinancialNote) {
    return {
      id: note.id,
      invoiceId: note.invoiceId,
      kind: note.kind,
      state: note.state,
      version: note.version,
      reason: note.reason,
      lines: note.lines,
      totalInr: note.totalInr,
      noteNumber: note.noteNumber,
      issuedAt: note.issuedAt,
      paidAt: note.paidAt,
      createdAt: note.createdAt,
      paymentState:
        note.kind === 'CREDIT'
          ? 'NO_REFUND_RECORDED'
          : note.state !== 'ISSUED'
            ? 'NOT_PAYABLE'
            : note.paidAt
              ? 'PAID'
              : 'DUE',
    };
  }
  private async audit(
    m: EntityManager,
    a: AuthContext,
    row: FinancialNote,
    action: string,
  ) {
    const notify =
      (action === 'FINANCIAL_NOTE_PROPOSED' && row.kind === 'DEBIT') ||
      [
        'FINANCIAL_NOTE_ISSUED',
        'FINANCIAL_NOTE_PAID',
        'FINANCIAL_NOTE_WITHDRAWN',
      ].includes(action);
    if (
      notify &&
      (await m
        .getRepository(CustomerProfile)
        .existsBy({ id: row.customerProfileId }))
    ) {
      await m.getRepository(CustomerNotification).save({
        customerProfileId: row.customerProfileId,
        category: NotificationCategory.PAYMENT,
        title:
          action === 'FINANCIAL_NOTE_PROPOSED'
            ? 'Review an additional charge'
            : action === 'FINANCIAL_NOTE_PAID'
              ? 'Correction payment recorded'
              : action === 'FINANCIAL_NOTE_WITHDRAWN'
                ? 'Correction proposal withdrawn'
                : 'Invoice correction issued',
        body: `${row.kind === 'CREDIT' ? 'Credit' : 'Additional charge'} of INR ${row.totalInr}. ${row.kind === 'CREDIT' ? 'No refund has been recorded.' : 'Open your bill to review the saved details.'}`,
        href: `/payments/${row.invoiceId}`,
        jobId: null,
        bookingId: null,
        readAt: null,
      });
    }
    await m.getRepository(AuditLog).save({
      serviceCenterId: row.serviceCenterId,
      entityType: 'FINANCIAL_NOTE',
      entityId: row.id,
      action,
      actorStaffProfileId: a.actorType === 'staff' ? a.staffProfileId : null,
      metadata: { actor: this.principal(a) },
      before: null,
      after: {
        state: row.state,
        version: row.version,
        noteNumber: row.noteNumber,
      },
    });
  }
  async list(a: AuthContext, invoiceId: string) {
    const invoice = await this.source(this.db.manager, invoiceId);
    await this.access(a, invoice, this.db.manager);
    const saved = await this.db
      .getRepository(FinancialNote)
      .find({ where: { invoiceId }, order: { createdAt: 'ASC', id: 'ASC' } });
    const rows = saved.filter(
      (note) => a.actorType === 'finance' || noteMatchesInvoice(note, invoice),
    );
    const job = await this.db
      .getRepository(ServiceJob)
      .findOneBy({ id: invoice.jobId });
    return {
      jobVersion: job?.version,
      lines: invoice.lineItems.map((l) => ({
        id: l.id,
        description: l.description,
        netInr: l.amountInr,
      })),
      notes: rows.map((n) => this.view(n)),
      ...(a.actorType === 'finance'
        ? {
            financeReview: {
              seller: invoice.seller,
              buyer: invoice.buyer,
              sourceNumber: invoice.invoiceNumber,
              sourceHash: invoice.snapshotHash,
              issuedAt: invoice.issuedAt,
              originalCalculation: invoice.billingSnapshot,
              proposals: rows.map((n) => ({
                id: n.id,
                proposedBy: n.proposedBy,
                snapshot: n.snapshot,
                evidenceReference: n.evidenceReference,
              })),
            },
          }
        : {}),
    };
  }
  async propose(
    a: AuthContext,
    invoiceId: string,
    dto: ProposeNoteDto,
    meta: CommandMeta,
  ) {
    this.enabled();
    return this.db.transaction(async (m) => {
      await this.staff(a, m, 'billing:correct');
      await this.center(m, a.serviceCenterId!, true);
      const invoice = await this.source(m, invoiceId);
      if (invoice.serviceCenterId !== a.serviceCenterId)
        throw new NotFoundException();
      const ref = await withCommandReceipt(m, this.scope(a), meta, async () => {
        const job = await m
          .getRepository(ServiceJob)
          .findOneBy({ id: invoice.jobId });
        if (!job || job.version !== meta.version)
          throw new ConflictException(
            'Refresh the source job before proposing a correction',
          );
        const configuration = await this.policy(m, invoice);
        const lines = await this.calculate(m, invoice, dto);
        const totalInr = money(
          lines.reduce((sum, l) => sum + minor(l.totalInr), 0n),
        );
        const note = await m.getRepository(FinancialNote).save({
          invoiceId,
          serviceCenterId: invoice.serviceCenterId,
          customerProfileId: invoice.customerProfileId!,
          kind: dto.kind,
          state: 'PROPOSED',
          reason: dto.reason.trim(),
          lines,
          totalInr,
          proposedBy: this.principal(a),
          snapshot: {
            originalNumber: invoice.invoiceNumber,
            originalHash: invoice.snapshotHash,
            originalIssuedAt: invoice.issuedAt,
            seller: invoice.seller,
            buyer: invoice.buyer,
            placeOfSupply: invoice.billingSnapshot?.placeOfSupply,
            supplyDate: invoice.billingSnapshot?.supplyDate,
            policy: configuration.policy.corrections,
            configurationId: configuration.id,
            configurationVersion: configuration.version,
          },
        });
        await this.audit(m, a, note, 'FINANCIAL_NOTE_PROPOSED');
        return { id: note.id };
      });
      return this.view(
        await m.getRepository(FinancialNote).findOneByOrFail({ id: ref.id }),
      );
    });
  }
  async decision(
    a: AuthContext,
    id: string,
    dto: NoteDecisionDto,
    meta: CommandMeta,
  ) {
    this.enabled();
    const loaded = await this.db.getRepository(FinancialNote).findOneBy({ id });
    if (!loaded) throw new NotFoundException();
    const invoice = await this.source(this.db.manager, loaded.invoiceId);
    await this.access(a, invoice, this.db.manager);
    if (!noteMatchesInvoice(loaded, invoice)) throw new NotFoundException();
    if (a.actorType !== 'customer') throw new ForbiddenException();
    return this.db.transaction(async (m) => {
      await this.center(m, loaded.serviceCenterId, true);
      return withCommandReceipt(
        m,
        this.scope(a),
        meta,
        async () => {
          const p = await m.getRepository(CustomerProfile).findOne({
            where: { id: loaded.customerProfileId, iamUserId: a.userId },
            lock: { mode: 'pessimistic_read' },
          });
          if (!p) throw new NotFoundException();
          const row = await m.getRepository(FinancialNote).findOneOrFail({
            where: { id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!noteMatchesInvoice(row, invoice)) throw new NotFoundException();
          this.version(row, meta);
          if (row.kind !== 'DEBIT' || row.state !== 'PROPOSED')
            throw new ConflictException(
              'Only a proposed additional charge can be decided',
            );
          row.state = dto.decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
          row.acceptedAt = dto.decision === 'ACCEPT' ? new Date() : null;
          row.version++;
          await m.getRepository(FinancialNote).save(row);
          await this.audit(m, a, row, 'FINANCIAL_NOTE_CUSTOMER_DECISION');
          return this.view(row);
        },
        async () => {
          if (
            !(await m.getRepository(CustomerProfile).findOne({
              where: { id: loaded.customerProfileId, iamUserId: a.userId },
              lock: { mode: 'pessimistic_read' },
            }))
          )
            throw new NotFoundException();
        },
      );
    });
  }
  async issue(
    a: AuthContext,
    id: string,
    dto: IssueNoteDto,
    meta: CommandMeta,
  ) {
    this.enabled();
    this.policies.finance(a, 'billing:approve', true);
    const loaded = await this.db.getRepository(FinancialNote).findOneBy({ id });
    if (!loaded) throw new NotFoundException();
    return this.db.transaction(async (m) => {
      await this.center(m, loaded.serviceCenterId, true);
      return withCommandReceipt(m, this.scope(a), meta, async () => {
        const row = await m.getRepository(FinancialNote).findOneOrFail({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        this.version(row, meta);
        if (row.proposedBy === this.principal(a))
          throw new ForbiddenException(
            'A different finance reviewer must issue this note',
          );
        if (!dto.evidenceReference?.trim())
          fail(
            'NOTE_EVIDENCE_REQUIRED',
            'Record the reviewed accounting evidence',
          );
        if (
          (row.kind === 'CREDIT' && row.state !== 'PROPOSED') ||
          (row.kind === 'DEBIT' &&
            (row.state !== 'ACCEPTED' || !row.acceptedAt))
        )
          throw new ConflictException(
            'An additional charge requires the original recipient’s explicit acceptance',
          );
        const invoice = await this.source(m, row.invoiceId);
        if (!noteMatchesInvoice(row, invoice))
          fail(
            'NOTE_SOURCE_MISMATCH',
            'The correction recipient or center does not match the source invoice. Authorized review is required.',
          );
        if (
          row.kind === 'DEBIT' &&
          !(await m
            .getRepository(CustomerProfile)
            .existsBy({ id: row.customerProfileId }))
        )
          throw new ConflictException(
            'The original recipient account is unavailable',
          );
        const configuration = await this.policy(m, invoice);
        if (
          invoice.snapshotHash !== row.snapshot.originalHash ||
          canonical(configuration.policy.corrections) !==
            canonical(row.snapshot.policy)
        )
          throw new ConflictException(
            'Correction policy changed; withdraw this proposal and create a reviewed one',
          );
        const recalculated = await this.calculate(m, invoice, {
          kind: row.kind,
          reason: row.reason,
          lines: row.lines.map((l) => ({
            sourceLineId: l.sourceLineId,
            netInr: l.netInr,
          })),
        });
        if (canonical(recalculated) !== canonical(row.lines))
          throw new ConflictException(
            'Prior corrections changed the permitted amounts; create a fresh proposal',
          );
        const today = istToday();
        const year =
          Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
        const policy = configuration.policy;
        const c = policy.corrections!;
        const prefix = row.kind === 'CREDIT' ? c.creditPrefix : c.debitPrefix;
        const sellerKey =
          policy.seller.gstin ?? `entity:${policy.seller.entityReference}`;
        const financialYear = `${year}-${year + 1}`;
        const seriesRepo = m.getRepository(InvoiceSeries);
        await seriesRepo
          .createQueryBuilder()
          .insert()
          .values({
            id: randomUUID(),
            serviceCenterId: row.serviceCenterId,
            sellerKey,
            financialYear,
            seriesPrefix: prefix,
            nextNumber: c.initialSequence,
          })
          .orIgnore()
          .execute();
        const series = await seriesRepo.findOneOrFail({
          where: { sellerKey, financialYear, seriesPrefix: prefix },
          lock: { mode: 'pessimistic_write' },
        });
        if (series.nextNumber < c.initialSequence || series.nextNumber > 999999)
          fail(
            'INVOICE_SERIES_RECONCILIATION_REQUIRED',
            'Review the correction series counter',
          );
        row.noteNumber = `${prefix}/${String(year).slice(-2)}${String(year + 1).slice(-2)}/${String(series.nextNumber).padStart(6, '0')}`;
        await seriesRepo.update(series.id, {
          nextNumber: series.nextNumber + 1,
        });
        row.state = 'ISSUED';
        row.issuedAt = new Date();
        row.issuedBy = this.principal(a);
        row.evidenceReference = dto.evidenceReference.trim();
        row.version++;
        row.snapshot = {
          ...row.snapshot,
          issuedConfigurationId: configuration.id,
          issuedConfigurationVersion: configuration.version,
          sellerKey,
          financialYear,
        };
        await m.getRepository(FinancialNote).save(row);
        await m
          .getRepository(InvoiceDocument)
          .save({ noteId: row.id, state: 'PENDING' });
        await this.audit(m, a, row, 'FINANCIAL_NOTE_ISSUED');
        return this.view(row);
      });
    });
  }
  async withdraw(a: AuthContext, id: string, meta: CommandMeta) {
    this.enabled();
    return this.db.transaction(async (m) => {
      await this.staff(a, m, 'billing:correct');
      await this.center(m, a.serviceCenterId!, true);
      const loaded = await m
        .getRepository(FinancialNote)
        .findOneBy({ id, serviceCenterId: a.serviceCenterId! });
      if (!loaded) throw new NotFoundException();
      return withCommandReceipt(m, this.scope(a), meta, async () => {
        const row = await m.getRepository(FinancialNote).findOneOrFail({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        this.version(row, meta);
        if (row.state === 'ISSUED' || row.state === 'WITHDRAWN')
          throw new ConflictException('Issued notes cannot be withdrawn');
        row.state = 'WITHDRAWN';
        row.version++;
        await m.getRepository(FinancialNote).save(row);
        await this.audit(m, a, row, 'FINANCIAL_NOTE_WITHDRAWN');
        return this.view(row);
      });
    });
  }
  async pay(
    a: AuthContext,
    id: string,
    dto: NotePaymentDto,
    meta: CommandMeta,
  ) {
    this.enabled();
    return this.db.transaction(async (m) => {
      await this.staff(a, m, 'billing:record-payment');
      await this.center(m, a.serviceCenterId!, true);
      const loaded = await m
        .getRepository(FinancialNote)
        .findOneBy({ id, serviceCenterId: a.serviceCenterId! });
      if (!loaded) throw new NotFoundException();
      return withCommandReceipt(m, this.scope(a), meta, async () => {
        const row = await m.getRepository(FinancialNote).findOneOrFail({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        this.version(row, meta);
        if (row.kind !== 'DEBIT' || row.state !== 'ISSUED' || row.paidAt)
          throw new ConflictException(
            'Only an unpaid issued debit note accepts payment',
          );
        if (!noteMatchesInvoice(row, await this.source(m, row.invoiceId)))
          fail(
            'NOTE_SOURCE_MISMATCH',
            'The correction recipient or center does not match the source invoice. Authorized review is required.',
          );
        if (minor(dto.amountInr) !== minor(row.totalInr))
          fail(
            'PAYMENT_AMOUNT_MISMATCH',
            'Record the full saved debit-note amount',
          );
        const reference = dto.reference?.trim() || null;
        const method = dto.method as PaymentMethod;
        if (!['CASH', 'UPI', 'CARD'].includes(method))
          fail('PAYMENT_METHOD_INVALID', 'Choose a counter payment method');
        if (
          reference &&
          (await m
            .getRepository(Payment)
            .createQueryBuilder('p')
            .where(
              'p.service_center_id = :center AND p.method = :method AND lower(trim(p.reference)) = :reference',
              {
                center: row.serviceCenterId,
                method,
                reference: reference.toLowerCase(),
              },
            )
            .getCount())
        )
          throw new ConflictException({
            code: 'PAYMENT_REFERENCE_USED',
            message: 'That payment reference is already recorded',
          });
        const dedupeKey = reference
          ? createHash('sha256')
              .update(
                JSON.stringify([
                  row.serviceCenterId,
                  method,
                  reference.toLowerCase(),
                ]),
              )
              .digest('hex')
          : null;
        const now = new Date();
        await m.getRepository(Payment).save({
          noteId: row.id,
          serviceCenterId: row.serviceCenterId,
          method,
          reference,
          dedupeKey,
          amountInr: row.totalInr,
          receivedAt: now,
          receivedByStaffProfileId: a.staffProfileId,
        });
        row.paidAt = now;
        row.version++;
        await m.getRepository(FinancialNote).save(row);
        await this.audit(m, a, row, 'FINANCIAL_NOTE_PAID');
        return this.view(row);
      });
    });
  }
}
