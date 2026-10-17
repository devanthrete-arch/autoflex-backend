import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createMemoryDataSource } from '../../database/memory-db';
import { istToday } from '../../common/time/ist';
import type { AuthContext } from '../auth/interfaces/auth-context.interface';
import { commandMeta } from '../idempotency/transactional-receipt';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { BillingConfigService } from './billing-config.service';
import type { BillingPolicy } from './billing-calculator';

const domainId = 'finance-domain';
const applicationId = 'finance-app';
function actor(userId = 'operator', reviewer = false): AuthContext {
  return {
    actorType: 'finance',
    userId,
    domainId,
    domainApplicationId: applicationId,
    roles: [reviewer ? 'finance_reviewer' : 'finance_operator'],
    permissions: reviewer
      ? ['billing:approve', 'billing:configure']
      : ['billing:configure'],
    serviceCenterId: null,
    staffProfileId: null,
    customerProfileId: null,
  };
}
function policy(): BillingPolicy {
  return {
    seller: {
      name: 'Synthetic Garage',
      address: 'Test Road, Bengaluru',
      stateCode: '29',
      pin: '560001',
      gstin: '29ABCDE1234F1ZW',
      registrationStatus: 'REGULAR',
      signatory: 'Synthetic Reviewer',
    },
    placeOfSupplyRules: [
      {
        key: 'individual-29',
        buyerType: 'INDIVIDUAL',
        buyerStateCode: '29',
        context: 'AT_CENTER',
        supplyStateCode: '29',
        basisReference: 'SYNTHETIC-ONLY',
      },
    ],
    buyerModes: ['INDIVIDUAL'],
    irp: {
      businessMode: 'NOT_APPLICABLE',
      basisReference: 'SYNTHETIC-EXAMPLE',
    },
    effectiveFrom: '2020-01-01',
    financialYearStartMonth: 4,
    seriesPrefix: 'TEST',
    initialSequence: 1,
    rules: [
      {
        key: 'labour',
        kind: 'LABOUR',
        classificationCode: '998714',
        treatment: 'TAXABLE',
        rateBps: 1800,
        priceMode: 'EXCLUSIVE',
      },
    ],
  };
}
function meta(
  body: unknown,
  version: number,
  key = randomUUID(),
  path = '/configuration',
) {
  return commandMeta(
    {
      method: 'POST',
      originalUrl: path,
      body,
      headers: { 'idempotency-key': key, 'if-match': String(version) },
    },
    body,
  );
}

describe('internal billing configuration', () => {
  let db: DataSource;
  let service: BillingConfigService;
  let centerId: string;
  beforeAll(async () => {
    ({ dataSource: db } = await createMemoryDataSource());
    service = new BillingConfigService(
      db,
      new ConfigService({
        IAM_FINANCE_DOMAIN_APPLICATION_ID: applicationId,
        IAM_FINANCE_DOMAIN_ID: domainId,
      }),
    );
  });
  beforeEach(async () => {
    const center = await db
      .getRepository(ServiceCenter)
      .save({ name: 'Synthetic center', iamDomainId: randomUUID() });
    centerId = center.id;
  });
  afterAll(async () => {
    await db?.destroy();
  });

  it.each(['staff', 'customer', 'support'] as const)(
    'refuses %s actors even when claims include finance permissions',
    async (actorType) => {
      await expect(
        service.list({ ...actor('reviewer', true), actorType }, centerId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('requires a configured finance domain/application and authoritative permission', async () => {
    await expect(
      service.list({ ...actor(), domainId: 'other' }, centerId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.list({ ...actor(), permissions: [] }, centerId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const disabled = new BillingConfigService(db, new ConfigService({}));
    await expect(disabled.list(actor(), centerId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('validates the whole policy before saving a draft', async () => {
    const dto = {
      policy: { ...policy(), implicitRate: 18 },
      evidenceReference: 'paper-intake',
    };
    await expect(
      service.create(actor(), centerId, dto, meta(dto, 1)),
    ).rejects.toMatchObject({ status: 422 });
    expect((await service.list(actor(), centerId)).configurations).toHaveLength(
      0,
    );
  });

  it('replays the same draft receipt but rejects changing its body or stale revision', async () => {
    const dto = { policy: policy(), evidenceReference: 'paper-intake' };
    const request = meta(dto, 1);
    const draft = await service.create(actor(), centerId, dto, request);
    expect(draft).toMatchObject({ version: 2, status: 'DRAFT' });
    expect(await service.create(actor(), centerId, dto, request)).toEqual(
      draft,
    );
    const changed = { ...dto, evidenceReference: 'changed-evidence' };
    await expect(
      service.create(actor(), centerId, changed, meta(changed, 1, request.key)),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.create(actor(), centerId, dto, meta(dto, 1)),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.readActive(centerId, istToday()),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('requires a different finance reviewer, preserves the active config while drafting, and suspends atomically', async () => {
    const dto = { policy: policy(), evidenceReference: 'paper-intake' };
    const draft = await service.create(actor(), centerId, dto, meta(dto, 1));
    const approval = { evidenceReference: 'accountant-example-pack' };
    await expect(
      service.approve(
        actor('operator', true),
        centerId,
        draft.id,
        approval,
        meta(approval, draft.version),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.approve(
        actor(),
        centerId,
        draft.id,
        approval,
        meta(approval, draft.version),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const approved = await service.approve(
      actor('reviewer', true),
      centerId,
      draft.id,
      approval,
      meta(approval, draft.version),
    );
    expect(await service.readActive(centerId, istToday())).toMatchObject({
      id: draft.id,
      version: approved.version,
      status: 'APPROVED',
    });
    const latest = await service.list(actor(), centerId);
    await service.create(actor(), centerId, dto, meta(dto, latest.revision));
    expect(await service.readActive(centerId, istToday())).toMatchObject({
      id: draft.id,
      version: approved.version,
    });
    const suspension = { reason: 'Finance has requested an immediate review' };
    await expect(
      service.suspend(
        actor('reviewer', true),
        centerId,
        draft.id,
        suspension,
        meta(suspension, draft.version),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await service.suspend(
      actor('reviewer', true),
      centerId,
      draft.id,
      suspension,
      meta(suspension, approved.version),
    );
    await expect(
      service.readActive(centerId, istToday()),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('does not replace the current configuration by approving a future-dated draft', async () => {
    const dto = { policy: policy(), evidenceReference: 'paper-intake' };
    const draft = await service.create(actor(), centerId, dto, meta(dto, 1));
    const approval = { evidenceReference: 'accountant-example-pack' };
    await service.approve(
      actor('reviewer', true),
      centerId,
      draft.id,
      approval,
      meta(approval, draft.version),
    );
    const next = {
      policy: { ...policy(), effectiveFrom: '2099-01-01' },
      evidenceReference: 'future',
    };
    const revision = (await service.list(actor(), centerId)).revision;
    const future = await service.create(
      actor(),
      centerId,
      next,
      meta(next, revision),
    );
    await expect(
      service.approve(
        actor('reviewer', true),
        centerId,
        future.id,
        approval,
        meta(approval, future.version),
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(await service.readActive(centerId, istToday())).toMatchObject({
      id: draft.id,
    });
  });

  it('returns only safe readiness and keeps rollout disabled by default', async () => {
    const staff: AuthContext = {
      ...actor(),
      actorType: 'staff',
      roles: ['advisor'],
      permissions: ['jobs:read'],
      serviceCenterId: centerId,
      staffProfileId: randomUUID(),
    };
    const result = await service.readiness(staff);
    expect(result).toEqual({
      ready: false,
      enabled: false,
      configured: false,
      configuration: null,
      blockedReasons: [
        'BILLING_ROLLOUT_DISABLED',
        'BILLING_CONFIGURATION_REQUIRED',
      ],
    });
    await expect(
      service.readiness({ ...staff, roles: ['technician'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
