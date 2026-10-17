import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { ServiceCenterStatus } from '../../common/enums/service-center-status.enum';
import { istToday } from '../../common/time/ist';
import { AuthContext } from '../auth/interfaces/auth-context.interface';
import { AuditLog } from '../events/entities/audit-log.entity';
import {
  CommandMeta,
  withCommandReceipt,
} from '../idempotency/transactional-receipt';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { validatePolicy } from './billing-calculator';
import { BillingConfiguration } from './entities/billing-configuration.entity';
import {
  ApproveBillingConfigurationDto,
  CreateBillingConfigurationDto,
  SuspendBillingConfigurationDto,
} from './dto/billing-config.dto';

/** All onboarding is an internal finance operation; center staff only see readiness. */
@Injectable()
export class BillingConfigService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  finance(auth: AuthContext, permission?: string, reviewer = false) {
    const app = this.config.get<string>('IAM_FINANCE_DOMAIN_APPLICATION_ID');
    const domain = this.config.get<string>('IAM_FINANCE_DOMAIN_ID');
    if (
      auth.actorType !== 'finance' ||
      !app ||
      !domain ||
      app === this.config.get<string>('IAM_CUSTOMER_DOMAIN_APPLICATION_ID') ||
      app === this.config.get<string>('IAM_SUPPORT_DOMAIN_APPLICATION_ID') ||
      domain === this.config.get<string>('IAM_SUPPORT_DOMAIN_ID') ||
      app !== auth.domainApplicationId ||
      domain !== auth.domainId ||
      !auth.roles.some((role) =>
        reviewer
          ? role === 'finance_reviewer'
          : ['finance_operator', 'finance_reviewer'].includes(role),
      ) ||
      (permission
        ? !auth.permissions.includes(permission)
        : !auth.permissions.some((value) =>
            ['billing:configure', 'billing:approve'].includes(value),
          ))
    ) {
      throw new ForbiddenException(
        'An authorized Autoflex finance account is required',
      );
    }
  }

  private principal(auth: AuthContext) {
    return `${auth.domainId}:${auth.userId}`;
  }
  private scope(auth: AuthContext) {
    return `finance:${createHash('sha256').update(this.principal(auth)).digest('hex')}`;
  }
  private async center(manager: EntityManager, centerId: string, lock = false) {
    const center = await manager.getRepository(ServiceCenter).findOne({
      where: { id: centerId, status: ServiceCenterStatus.ACTIVE },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!center) throw new NotFoundException('Service center unavailable');
    return center;
  }
  private async revision(manager: EntityManager, centerId: string) {
    const latest = await manager.getRepository(BillingConfiguration).findOne({
      where: { serviceCenterId: centerId },
      order: { version: 'DESC' },
    });
    return latest?.version ?? 1;
  }
  private checkVersion(actual: number, meta: CommandMeta) {
    if (!meta.key || !Number.isSafeInteger(meta.version) || meta.version! < 1)
      throw new BadRequestException(
        'One Idempotency-Key and If-Match version are required',
      );
    if (actual !== meta.version)
      throw new ConflictException({
        code: 'BILLING_CONFIGURATION_VERSION_CONFLICT',
        message: 'The billing configuration changed. Reload before continuing.',
      });
  }
  private async row(manager: EntityManager, centerId: string, id: string) {
    const row = await manager.getRepository(BillingConfiguration).findOne({
      where: { id, serviceCenterId: centerId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!row) throw new NotFoundException('Billing configuration unavailable');
    return row;
  }
  private response(row: BillingConfiguration) {
    return { id: row.id, version: row.version, status: row.status };
  }
  private async audit(
    manager: EntityManager,
    auth: AuthContext,
    row: BillingConfiguration,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    await manager.getRepository(AuditLog).save({
      serviceCenterId: row.serviceCenterId,
      entityType: 'BILLING_CONFIGURATION',
      entityId: row.id,
      action,
      actorStaffProfileId: null,
      metadata: { actor: this.principal(auth), ...metadata },
      before: null,
      after: { status: row.status, version: row.version },
    });
  }

  async list(auth: AuthContext, centerId: string) {
    this.finance(auth);
    await this.center(this.db.manager, centerId);
    const configurations = await this.db
      .getRepository(BillingConfiguration)
      .find({
        where: { serviceCenterId: centerId },
        order: { version: 'DESC' },
      });
    return { revision: configurations[0]?.version ?? 1, configurations };
  }

  async create(
    auth: AuthContext,
    centerId: string,
    dto: CreateBillingConfigurationDto,
    meta: CommandMeta,
  ) {
    this.finance(auth, 'billing:configure');
    validatePolicy(dto.policy);
    if (!dto.evidenceReference?.trim())
      throw new BadRequestException('A source evidence reference is required');
    return this.db.transaction(async (manager) => {
      await this.center(manager, centerId, true);
      return withCommandReceipt(manager, this.scope(auth), meta, async () => {
        const revision = await this.revision(manager, centerId);
        this.checkVersion(revision, meta);
        const row = await manager.getRepository(BillingConfiguration).save({
          serviceCenterId: centerId,
          version: revision + 1,
          status: 'DRAFT',
          policy: dto.policy,
          createdBy: this.principal(auth),
          approvedBy: null,
          evidenceReference: dto.evidenceReference.trim(),
          approvedAt: null,
        });
        await this.audit(manager, auth, row, 'BILLING_CONFIGURATION_DRAFTED', {
          evidenceReference: row.evidenceReference,
        });
        return this.response(row);
      });
    });
  }

  async approve(
    auth: AuthContext,
    centerId: string,
    id: string,
    dto: ApproveBillingConfigurationDto,
    meta: CommandMeta,
  ) {
    this.finance(auth, 'billing:approve', true);
    if (!dto.evidenceReference?.trim())
      throw new BadRequestException(
        'An approval evidence reference is required',
      );
    return this.db.transaction(async (manager) => {
      await this.center(manager, centerId, true);
      return withCommandReceipt(manager, this.scope(auth), meta, async () => {
        const row = await this.row(manager, centerId, id);
        this.checkVersion(row.version, meta);
        if (row.status !== 'DRAFT')
          throw new ConflictException(
            'Only a draft billing configuration can be approved',
          );
        if (row.createdBy === this.principal(auth))
          throw new ForbiddenException(
            'A different finance reviewer must approve this configuration',
          );
        validatePolicy(row.policy);
        if (!this.covers(row, istToday()))
          throw new UnprocessableEntityException({
            code: 'BILLING_CONFIGURATION_DATE_INVALID',
            message:
              'Approve a configuration whose effective period includes today. Future configurations must remain drafts until their start date.',
          });
        let revision = await this.revision(manager, centerId);
        const previous = await manager
          .getRepository(BillingConfiguration)
          .findOne({
            where: { serviceCenterId: centerId, status: 'APPROVED' },
            lock: { mode: 'pessimistic_write' },
          });
        if (previous) {
          previous.status = 'SUSPENDED';
          previous.version = ++revision;
          await manager.getRepository(BillingConfiguration).save(previous);
          await this.audit(
            manager,
            auth,
            previous,
            'BILLING_CONFIGURATION_REPLACED',
            { replacementId: row.id },
          );
        }
        row.status = 'APPROVED';
        row.version = ++revision;
        row.approvedBy = this.principal(auth);
        row.approvedAt = new Date();
        row.evidenceReference = dto.evidenceReference.trim();
        await manager.getRepository(BillingConfiguration).save(row);
        await this.audit(manager, auth, row, 'BILLING_CONFIGURATION_APPROVED', {
          evidenceReference: row.evidenceReference,
        });
        return this.response(row);
      });
    });
  }

  async suspend(
    auth: AuthContext,
    centerId: string,
    id: string,
    dto: SuspendBillingConfigurationDto,
    meta: CommandMeta,
  ) {
    this.finance(auth, 'billing:approve', true);
    if (!dto.reason?.trim())
      throw new BadRequestException('A suspension reason is required');
    return this.db.transaction(async (manager) => {
      await this.center(manager, centerId, true);
      return withCommandReceipt(manager, this.scope(auth), meta, async () => {
        const row = await this.row(manager, centerId, id);
        this.checkVersion(row.version, meta);
        if (row.status !== 'APPROVED')
          throw new ConflictException(
            'Only an approved billing configuration can be suspended',
          );
        row.status = 'SUSPENDED';
        row.version = (await this.revision(manager, centerId)) + 1;
        await manager.getRepository(BillingConfiguration).save(row);
        await this.audit(
          manager,
          auth,
          row,
          'BILLING_CONFIGURATION_SUSPENDED',
          { reason: dto.reason.trim() },
        );
        return this.response(row);
      });
    });
  }

  private covers(row: BillingConfiguration, date: string) {
    return (
      row.policy.effectiveFrom <= date &&
      (!row.policy.effectiveTo || date <= row.policy.effectiveTo)
    );
  }
  private date(date: string) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
    )
      throw new BadRequestException(
        'A valid billing calendar date is required',
      );
  }
  private async active(
    manager: EntityManager,
    centerId: string,
    date: string,
    lock: boolean,
  ) {
    this.date(date);
    await this.center(manager, centerId, lock);
    const row = await manager.getRepository(BillingConfiguration).findOne({
      where: { serviceCenterId: centerId, status: 'APPROVED' },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!row || !this.covers(row, date))
      throw new UnprocessableEntityException({
        code: 'BILLING_CONFIGURATION_REQUIRED',
        message:
          'An approved billing configuration effective on this date is required.',
      });
    validatePolicy(row.policy);
    return row;
  }

  /** Final issue already holds the center lock; re-locking preserves one global order. */
  approved(
    manager: EntityManager,
    centerId: string,
    date: string,
  ): Promise<BillingConfiguration> {
    return this.active(manager, centerId, date, true);
  }
  /** Preview never queues behind a center write lock. Final issue revalidates. */
  readActive(centerId: string, date: string): Promise<BillingConfiguration> {
    return this.active(this.db.manager, centerId, date, false);
  }

  async readiness(auth: AuthContext) {
    if (
      auth.actorType !== 'staff' ||
      !auth.serviceCenterId ||
      !auth.staffProfileId ||
      !auth.roles.some((role) =>
        ['admin', 'manager', 'advisor'].includes(role),
      ) ||
      !auth.permissions.includes('jobs:read')
    )
      throw new ForbiddenException('Center desk access is required');
    await this.center(this.db.manager, auth.serviceCenterId);
    const row = await this.db.getRepository(BillingConfiguration).findOne({
      where: { serviceCenterId: auth.serviceCenterId, status: 'APPROVED' },
    });
    const enabled = this.config.get<string>('BILLING_V2_ENABLED') === 'true';
    const blockedReasons: string[] = [];
    if (!enabled) blockedReasons.push('BILLING_ROLLOUT_DISABLED');
    if (!row || !this.covers(row, istToday()))
      blockedReasons.push('BILLING_CONFIGURATION_REQUIRED');
    if (row) {
      try {
        validatePolicy(row.policy);
      } catch {
        blockedReasons.push('BILLING_CONFIGURATION_INVALID');
      }
    }
    return {
      ready: blockedReasons.length === 0,
      enabled,
      configured:
        (await this.db
          .getRepository(BillingConfiguration)
          .countBy({ serviceCenterId: auth.serviceCenterId })) > 0,
      configuration: row
        ? {
            id: row.id,
            version: row.version,
            status: row.status,
            effectiveFrom: row.policy.effectiveFrom,
            effectiveTo: row.policy.effectiveTo ?? null,
            registrationStatus: row.policy.seller.registrationStatus,
            buyerModes: row.policy.buyerModes,
          }
        : null,
      blockedReasons,
    };
  }
}
