import { istToday } from '../../common/time/ist';
import { BillingConfigService } from './billing-config.service';
import { createHash } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { IsString, Length } from 'class-validator';
import { InvoiceStatus } from '../../common/enums/ownership.enum';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { AuditLog } from '../events/entities/audit-log.entity';
import {
  CommandMeta,
  withCommandReceipt,
} from '../idempotency/transactional-receipt';
import { ServiceJob } from '../jobs/entities/service-job.entity';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { StaffProfile } from '../tenancy/entities/staff-profile.entity';
import { Invoice } from './entities/invoice.entity';
import { Payment } from './entities/payment.entity';
export class CancelInvoiceDto {
  @IsString() @Length(3, 500) reason: string;
}
@Injectable()
export class InvoiceCorrectionService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
    private readonly policies: BillingConfigService,
  ) {}
  async cancel(
    auth: AuthContext,
    id: string,
    dto: CancelInvoiceDto,
    meta: CommandMeta,
  ) {
    if (this.config.get('BILLING_V2_ENABLED') !== 'true')
      throw new ServiceUnavailableException(
        'Invoice corrections are not enabled',
      );
    if (
      auth.actorType !== 'staff' ||
      !auth.serviceCenterId ||
      !auth.staffProfileId ||
      !auth.roles.some((r) => ['admin', 'manager', 'advisor'].includes(r)) ||
      !auth.permissions.includes('billing:correct')
    )
      throw new ForbiddenException();
    if (!dto.reason?.trim() || dto.reason.trim().length < 3)
      throw new UnprocessableEntityException('Record a correction reason');
    return this.db.transaction(async (m) => {
      const center = await m.getRepository(ServiceCenter).findOne({
        where: {
          id: auth.serviceCenterId!,
          status: ServiceCenterStatus.ACTIVE,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !center ||
        !(await m.getRepository(StaffProfile).existsBy({
          id: auth.staffProfileId!,
          serviceCenterId: center.id,
          isActive: true,
          iamUserId: auth.userId,
        }))
      )
        throw new ForbiddenException();
      const loaded = await m
        .getRepository(Invoice)
        .findOneBy({ id, serviceCenterId: center.id });
      if (!loaded) throw new NotFoundException();
      return withCommandReceipt(
        m,
        `inv-cancel:${createHash('sha256').update(`${center.id}:${auth.userId}`).digest('hex')}`,
        meta,
        async () => {
          const job = await m.getRepository(ServiceJob).findOne({
            where: { id: loaded.jobId, serviceCenterId: center.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!job) throw new NotFoundException();
          if (job.version !== meta.version)
            throw new ConflictException({
              code: 'VERSION_CONFLICT',
              message:
                'The job changed. Refresh before correcting this invoice.',
            });
          const invoice = await m.getRepository(Invoice).findOne({
            where: { id, serviceCenterId: center.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!invoice) throw new NotFoundException();
          if (invoice.schemaVersion !== 2)
            throw new UnprocessableEntityException({
              code: 'LEGACY_CORRECTION_REQUIRES_REVIEW',
              message: 'Historical bills need a reviewed correction migration.',
            });
          const payments = await m
            .getRepository(Payment)
            .countBy({ invoiceId: id });
          if (
            invoice.status !== InvoiceStatus.DUE ||
            Number(invoice.paidInr) !== 0 ||
            payments
          )
            throw new ConflictException({
              code: 'INVOICE_CANCELLATION_NOT_ALLOWED',
              message:
                'Only an unpaid due invoice can be cancelled. Paid invoices require an approved financial correction note.',
            });
          const policy = (
            await this.policies.approved(m, center.id, istToday())
          ).policy;
          const age = Math.floor(
            (Date.parse(istToday()) -
              Date.parse(istToday(invoice.issuedAt.getTime()))) /
              86400000,
          );
          if (
            !policy.cancellation ||
            age < 0 ||
            age > policy.cancellation.maxAgeDays
          )
            throw new UnprocessableEntityException({
              code: 'INVOICE_CANCELLATION_POLICY_REQUIRED',
              message:
                'Finance must approve the cancellation policy and period for this bill',
            });
          if (
            policy.seller.gstin !== invoice.seller.gstin ||
            (!policy.seller.gstin &&
              policy.seller.entityReference !==
                (
                  invoice.billingSnapshot?.seller as {
                    entityReference?: string;
                  }
                )?.entityReference)
          )
            throw new UnprocessableEntityException({
              code: 'NOTE_SELLER_REVIEW_REQUIRED',
              message:
                'The current legal seller differs from the original invoice',
            });
          if (
            invoice.buyer.type === 'BUSINESS' &&
            policy.irp.businessMode === 'REQUIRED'
          )
            throw new UnprocessableEntityException({
              code: 'BILLING_IRP_INTEGRATION_REQUIRED',
              message: 'The approved IRP cancellation process is required',
            });
          invoice.status = InvoiceStatus.VOID;
          invoice.voidedAt = new Date();
          invoice.voidReason = dto.reason.trim();
          await m.getRepository(Invoice).save(invoice);
          job.version++;
          await m.getRepository(ServiceJob).save(job);
          await m.getRepository(AuditLog).save({
            serviceCenterId: center.id,
            entityType: 'INVOICE',
            entityId: id,
            action: 'INVOICE_CANCELLED',
            actorStaffProfileId: auth.staffProfileId,
            metadata: { reason: dto.reason.trim() },
            before: { status: 'DUE' },
            after: { status: 'VOID', jobVersion: job.version },
          });
          return {
            id,
            jobId: job.id,
            invoiceNumber: invoice.invoiceNumber,
            status: 'VOID',
            jobVersion: job.version,
          };
        },
        async () => {
          if (
            !(await m
              .getRepository(ServiceJob)
              .existsBy({ id: loaded.jobId, serviceCenterId: center.id }))
          )
            throw new NotFoundException();
        },
      );
    });
  }
}
