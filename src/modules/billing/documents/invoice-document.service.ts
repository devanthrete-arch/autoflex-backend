import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import type { AuthContext } from '../../auth/interfaces/auth-context.interface';
import { CustomerProfile } from '../../customers/entities/customer-profile.entity';
import { MeService } from '../../customers/me.service';
import { ServiceCenter } from '../../tenancy/entities/service-center.entity';
import { StaffProfile } from '../../tenancy/entities/staff-profile.entity';
import { ServiceCenterStatus } from '../../../common/enums/service-center-status.enum';
import { FinancialNote } from '../entities/financial-note.entity';
import { InvoiceLineItem } from '../entities/invoice-line-item.entity';
import { BillingConfigService } from '../billing-config.service';
import { Invoice, InvoiceParty } from '../entities/invoice.entity';
import { InvoiceDocument } from '../entities/invoice-document.entity';
import { noteMatchesInvoice } from '../financial-note-source';
import { PrivateInvoiceStorage } from './private-invoice-storage';
import { renderInvoicePdf } from './invoice-pdf';
@Injectable()
export class InvoiceDocumentService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private working = false;
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly storage: PrivateInvoiceStorage,
    private readonly me: MeService,
    private readonly policies: BillingConfigService,
  ) {}
  onModuleInit() {
    if (this.config.get('INVOICE_DOCUMENT_WORKER_ENABLED') === 'true') {
      this.timer = setInterval(
        () => void this.tick().catch(() => undefined),
        5000,
      );
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async authorize(
    auth: AuthContext,
    id: string,
    noteDocument = false,
  ): Promise<Invoice> {
    if (noteDocument) {
      const note = await this.db
        .getRepository(FinancialNote)
        .findOneBy({ id, state: 'ISSUED' });
      if (!note?.noteNumber || !note.issuedAt) throw new NotFoundException();
      const source = await this.authorize(auth, note.invoiceId);
      if (!noteMatchesInvoice(note, source)) throw new NotFoundException();
      return this.noteInvoice(note);
    }
    const invoice = await this.db
      .getRepository(Invoice)
      .findOne({ where: { id }, relations: { lineItems: true } });
    if (!invoice) throw new NotFoundException();
    if (auth.actorType === 'finance') {
      this.policies.finance(auth, 'billing:approve', true);
    } else if (auth.actorType === 'customer') {
      const p = await this.me.ensureProfile(auth);
      if (p.id !== invoice.customerProfileId) throw new NotFoundException();
      if (
        !(await this.db
          .getRepository(CustomerProfile)
          .existsBy({ id: p.id, iamUserId: auth.userId }))
      )
        throw new NotFoundException();
    } else if (
      auth.actorType === 'staff' &&
      auth.serviceCenterId === invoice.serviceCenterId &&
      auth.roles.some((r) => ['admin', 'manager', 'advisor'].includes(r)) &&
      auth.permissions.includes('jobs:read')
    ) {
      const [staff, center] = await Promise.all([
        this.db.getRepository(StaffProfile).existsBy({
          id: auth.staffProfileId!,
          serviceCenterId: invoice.serviceCenterId,
          isActive: true,
          iamUserId: auth.userId,
        }),
        this.db.getRepository(ServiceCenter).existsBy({
          id: invoice.serviceCenterId,
          status: ServiceCenterStatus.ACTIVE,
        }),
      ]);
      if (!staff || !center) throw new ForbiddenException();
    } else throw new NotFoundException();
    return invoice;
  }
  private noteInvoice(note: FinancialNote): Invoice {
    const snapshot = note.snapshot;
    const sum = (key: 'netInr' | 'taxInr') =>
      note.lines.reduce((s, l) => s + BigInt(l[key].replace('.', '')), 0n);
    const format = (n: bigint) =>
      `${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
    return Object.assign(new Invoice(), {
      id: note.id,
      schemaVersion: 2,
      documentKind: note.kind + '_NOTE',
      invoiceNumber: note.noteNumber!,
      issuedAt: note.issuedAt!,
      seller: snapshot.seller as InvoiceParty,
      buyer: snapshot.buyer as InvoiceParty,
      billingSnapshot: snapshot,
      snapshotHash: createHash('sha256')
        .update(JSON.stringify(snapshot))
        .digest('hex'),
      subtotalInr: format(sum('netInr')),
      taxInr: format(sum('taxInr')),
      totalInr: note.totalInr,
      notes: `Reference: ${String(snapshot.originalNumber)} (${String(snapshot.originalIssuedAt).slice(0, 10)}). ${note.reason}. ${note.kind === 'CREDIT' ? 'This credit note does not record a refund.' : 'Additional charge accepted by the original recipient; payment is recorded separately.'}`,
      lineItems: note.lines.map((l, index) =>
        Object.assign(new InvoiceLineItem(), {
          description: l.description,
          quantity: '1.00',
          unitPriceInr: l.netInr,
          amountInr: l.netInr,
          taxRatePct: (l.rateBps / 100).toFixed(2),
          taxInr: l.taxInr,
          sortOrder: index,
          taxSnapshot: { ...l, priceMode: 'EXCLUSIVE' },
        }),
      ),
    });
  }
  private target(id: string, noteDocument: boolean) {
    return noteDocument ? { noteId: id } : { invoiceId: id };
  }
  private project(row: InvoiceDocument | null) {
    return {
      state: row?.state ?? 'PENDING',
      retryAt: row?.retryAt ?? null,
      errorCode: row?.errorCode ?? null,
      storageReady: this.storage.ready,
      automaticRetryExhausted: (row?.attempts ?? 0) >= 10,
    };
  }
  async status(auth: AuthContext, id: string, noteDocument = false) {
    await this.authorize(auth, id, noteDocument);
    return this.project(
      await this.db
        .getRepository(InvoiceDocument)
        .findOneBy(this.target(id, noteDocument)),
    );
  }
  async request(auth: AuthContext, id: string, noteDocument = false) {
    const invoice = await this.authorize(auth, id, noteDocument);
    if (invoice.schemaVersion !== 2)
      throw new ConflictException({
        code: 'LEGACY_PDF_REQUIRES_REVIEW',
        message: 'This historical bill needs a reviewed document migration.',
      });
    if (!this.storage.ready)
      throw new ServiceUnavailableException({
        code: 'INVOICE_STORAGE_NOT_CONFIGURED',
        message: 'Private invoice storage is not configured.',
      });
    await this.db
      .getRepository(InvoiceDocument)
      .createQueryBuilder()
      .insert()
      .values({ ...this.target(id, noteDocument), state: 'PENDING' })
      .orIgnore()
      .execute();
    await this.render(id, noteDocument);
    await this.authorize(auth, id, noteDocument);
    return this.project(
      await this.db
        .getRepository(InvoiceDocument)
        .findOneBy(this.target(id, noteDocument)),
    );
  }
  async retry(auth: AuthContext, id: string, noteDocument = false) {
    await this.authorize(auth, id, noteDocument);
    if (
      auth.actorType !== 'staff' ||
      !auth.permissions.includes('billing:correct')
    )
      throw new ForbiddenException(
        'Invoice correction access is required to restart document processing',
      );
    // A current worker lease and an already sealed object are never replaced.
    await this.db
      .getRepository(InvoiceDocument)
      .createQueryBuilder()
      .update()
      .set({ state: 'PENDING', attempts: 0, retryAt: null, errorCode: null })
      .where(
        `${noteDocument ? 'note_id' : 'invoice_id'} = :id AND state = 'FAILED'`,
        { id },
      )
      .execute();
    return this.request(auth, id, noteDocument);
  }
  async tick() {
    if (this.working || !this.storage.ready) return;
    this.working = true;
    try {
      const rows = await this.db
        .getRepository(InvoiceDocument)
        .createQueryBuilder('d')
        .where(
          "(d.state IN ('PENDING','FAILED') AND (d.retry_at IS NULL OR d.retry_at <= NOW()) AND d.attempts < 10) OR (d.state = 'RENDERING' AND d.lease_until < NOW())",
        )
        .orderBy('d.created_at', 'ASC')
        .take(3)
        .getMany();
      for (const row of rows)
        await this.render((row.noteId ?? row.invoiceId)!, !!row.noteId);
    } finally {
      this.working = false;
    }
  }
  async render(invoiceId: string, noteDocument = false) {
    if (!this.storage.ready) return;
    const lease = randomUUID();
    const claimed = await this.db
      .getRepository(InvoiceDocument)
      .createQueryBuilder()
      .update()
      .set({
        state: 'RENDERING',
        leaseToken: lease,
        leaseUntil: new Date(Date.now() + 120000),
        attempts: () => 'attempts + 1',
        errorCode: null,
      })
      .where(`${noteDocument ? 'note_id' : 'invoice_id'} = :invoiceId`, {
        invoiceId,
      })
      .andWhere(
        "((state IN ('PENDING','FAILED') AND (retry_at IS NULL OR retry_at <= NOW()) AND attempts < 10) OR (state = 'RENDERING' AND lease_until < NOW()))",
      )
      .execute();
    if (claimed.affected !== 1) return;
    try {
      const invoice = noteDocument
        ? this.noteInvoice(
            await this.db
              .getRepository(FinancialNote)
              .findOneByOrFail({ id: invoiceId, state: 'ISSUED' }),
          )
        : await this.db.getRepository(Invoice).findOneOrFail({
            where: { id: invoiceId },
            relations: { lineItems: true },
          });
      const bytes = await renderInvoicePdf(invoice);
      if (bytes.length > 15_000_000) throw new Error('Document too large');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const storageKey = `invoices/${invoiceId}/${sha256}.pdf`;
      await this.storage.put(storageKey, bytes);
      await this.db.getRepository(InvoiceDocument).update(
        { ...this.target(invoiceId, noteDocument), leaseToken: lease },
        {
          state: 'READY',
          storageKey,
          sha256,
          leaseToken: null,
          leaseUntil: null,
          retryAt: null,
          errorCode: null,
        },
      );
    } catch (error) {
      const row = await this.db.getRepository(InvoiceDocument).findOneBy({
        ...this.target(invoiceId, noteDocument),
        leaseToken: lease,
      });
      if (row)
        await this.db.getRepository(InvoiceDocument).update(
          { id: row.id, leaseToken: lease },
          {
            state: 'FAILED',
            leaseToken: null,
            leaseUntil: null,
            errorCode:
              error instanceof Error &&
              error.message === 'INVOICE_FONT_COVERAGE_REQUIRED'
                ? 'INVOICE_FONT_COVERAGE_REQUIRED'
                : 'INVOICE_DOCUMENT_RENDER_FAILED',
            retryAt: new Date(
              Date.now() +
                Math.min(3600000, 5000 * 2 ** Math.min(row.attempts, 9)),
            ),
          },
        );
    }
  }
  async download(auth: AuthContext, id: string, noteDocument = false) {
    const invoice = await this.authorize(auth, id, noteDocument);
    const row = await this.db
      .getRepository(InvoiceDocument)
      .findOneBy({ ...this.target(id, noteDocument), state: 'READY' });
    if (!row?.storageKey || !row.sha256)
      throw new ConflictException({
        code: 'INVOICE_DOCUMENT_NOT_READY',
        message:
          'The invoice PDF is still preparing. Refresh its document status.',
      });
    const bytes = await this.storage.get(row.storageKey);
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256)
      throw new ServiceUnavailableException(
        'Private document integrity check failed',
      );
    await this.authorize(auth, id, noteDocument);
    return {
      bytes,
      filename: `${invoice.invoiceNumber.replace(/[^A-Za-z0-9_-]/g, '-')}.pdf`,
    };
  }
}
