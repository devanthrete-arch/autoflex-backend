import { randomBytes, randomUUID } from 'crypto';
import { Server } from 'http';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ENTITIES } from '../src/database/entities';
import { MIGRATIONS } from '../src/database/migration-list';
import { JobStatus } from '../src/common/enums/job-status.enum';
import { JobLineKind, JobLineStatus } from '../src/common/enums/job-work.enum';
import { istToday } from '../src/common/time/ist';
import { BillingPolicy } from '../src/modules/billing/billing-calculator';
import { BillingConfiguration } from '../src/modules/billing/entities/billing-configuration.entity';
import { InvoiceSeries } from '../src/modules/billing/entities/invoice-series.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { InvoiceLineItem } from '../src/modules/billing/entities/invoice-line-item.entity';
import { Payment } from '../src/modules/billing/entities/payment.entity';
import { GarageVehicle } from '../src/modules/customers/entities/garage-vehicle.entity';
import { Booking } from '../src/modules/bookings/entities/booking.entity';
import { BookingItem } from '../src/modules/bookings/entities/booking-item.entity';
import { ServicePackage } from '../src/modules/offerings/entities/service-package.entity';
import { BookingMode } from '../src/common/enums/booking-mode.enum';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { VehicleType } from '../src/common/enums/vehicle-type.enum';
import { EventsService } from '../src/modules/events/events.service';
import { AuditLog } from '../src/modules/events/entities/audit-log.entity';
import { ServiceJobEvent } from '../src/modules/events/entities/service-job-event.entity';
import { CommandIdempotency } from '../src/modules/idempotency/command-idempotency.entity';
import { ServiceJob } from '../src/modules/jobs/entities/service-job.entity';
import { JobLineItem } from '../src/modules/jobs/entities/job-line-item.entity';
import { createJwtTestFixture } from '../src/test-utils/jwt-test.helper';
import { createApiApp } from './helpers/e2e-app.helper';
import { seedReturningWalkIn } from './helpers/returning-walk-in.helper';
import {
  seedTestTenancy,
  TEST_DOMAIN_ID,
  TEST_IAM_USER_ID,
  TEST_OTHER_DOMAIN_ID,
  TEST_OTHER_USER_ID,
} from './helpers/test-db.helper';

const suite =
  process.env.AF019_POSTGRES_TEST === 'true' ? describe : describe.skip;

/** Synthetic tax examples only. This is not an approved operating garage. */
function policy(): BillingPolicy {
  return {
    seller: {
      name: 'Synthetic Invoice Test Garage',
      address: 'Synthetic Road, Bengaluru',
      pin: '560001',
      stateCode: '29',
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
      {
        key: 'individual-27',
        buyerType: 'INDIVIDUAL',
        buyerStateCode: '27',
        context: 'AT_CENTER',
        supplyStateCode: '27',
        basisReference: 'SYNTHETIC-ONLY',
      },
      {
        key: 'business-29',
        buyerType: 'BUSINESS',
        buyerStateCode: '29',
        context: 'AT_CENTER',
        supplyStateCode: '29',
        basisReference: 'SYNTHETIC-ONLY',
      },
      {
        key: 'business-27',
        buyerType: 'BUSINESS',
        buyerStateCode: '27',
        context: 'AT_CENTER',
        supplyStateCode: '27',
        basisReference: 'SYNTHETIC-ONLY',
      },
    ],
    buyerModes: ['INDIVIDUAL', 'BUSINESS'],
    irp: { businessMode: 'NOT_APPLICABLE', basisReference: 'SYNTHETIC-ONLY' },
    effectiveFrom: '2020-04-01',
    seriesPrefix: 'TEST',
    initialSequence: 1,
    financialYearStartMonth: 4,
    rules: [
      {
        key: 'labour',
        kind: 'LABOUR',
        classificationCode: '998714',
        treatment: 'TAXABLE',
        rateBps: 1800,
        priceMode: 'EXCLUSIVE',
      },
      {
        key: 'parts',
        kind: 'PART',
        classificationCode: '8708',
        treatment: 'TAXABLE',
        rateBps: 1800,
        priceMode: 'INCLUSIVE',
      },
      {
        key: 'package',
        kind: 'PACKAGE',
        classificationCode: '998714',
        treatment: 'TAXABLE',
        rateBps: 1800,
        priceMode: 'EXCLUSIVE',
      },
    ],
  };
}

suite('AF-019 isolated PostgreSQL invoice workflow', () => {
  let admin: DataSource;
  let db: DataSource;
  let app: INestApplication;
  let centerId: string;
  let staff: string;
  let oldBillingPermission: string;
  let readOnlyStaff: string;
  let technician: string;
  let otherCenterStaff: string;
  let configRow: BillingConfiguration;
  let intake: Awaited<ReturnType<typeof seedReturningWalkIn>>;
  let events: EventsService;
  let createdDatabase = false;
  const databaseName = `af019_test_${randomBytes(12).toString('hex')}`;
  const originalEnabled = process.env.BILLING_V2_ENABLED;
  const originalJwks = process.env.LOCAL_JWKS_JSON;
  const http = () => request(app.getHttpServer() as Server);
  const as = (token: string, test: request.Test) =>
    test.set('Authorization', `Bearer ${token}`);
  const loadJob = (id: string) =>
    db.getRepository(ServiceJob).findOneByOrFail({ id });
  const options = (id: string, token = staff) =>
    as(token, http().get(`/v1/jobs/${id}/invoice-options`));
  const preview = (id: string, selection: object, token = staff) =>
    as(token, http().post(`/v1/jobs/${id}/invoice-preview`)).send(selection);
  const issue = (
    id: string,
    version: number,
    body: object,
    key = randomUUID(),
    token = staff,
  ) =>
    as(token, http().post(`/v1/jobs/${id}/invoice`))
      .set('If-Match', String(version))
      .set('Idempotency-Key', key)
      .send(body);
  const pay = (
    id: string,
    version: number,
    body: object,
    key = randomUUID(),
    token = staff,
  ) =>
    as(token, http().post(`/v1/jobs/${id}/close`))
      .set('If-Match', String(version))
      .set('Idempotency-Key', key)
      .send(body);

  async function createReadyJob(amount = '100.00') {
    const job = await db.getRepository(ServiceJob).save({
      serviceCenterId: centerId,
      customerId: intake.customer.id,
      vehicleId: intake.vehicle.id,
      billingCustomerProfileId: intake.profile.id,
      status: JobStatus.READY_FOR_PICKUP,
      publicToken: randomBytes(32).toString('base64url'),
      serviceType: 'Synthetic invoice test',
      intakeSnapshot: {
        customerName: 'Synthetic Customer',
        customerPhone: '+919876543210',
        vehicleRegistration: 'KA01AB1234',
        vehicleLabel: 'Honda Activa',
        garageVehicleId: null,
      },
    });
    const line = await db.getRepository(JobLineItem).save({
      jobId: job.id,
      serviceCenterId: centerId,
      kind: JobLineKind.LABOUR,
      description: 'Synthetic approved labour',
      quantity: '1.00',
      unitPriceInr: amount,
      amountInr: amount,
      status: JobLineStatus.INCLUDED,
      scope: [],
    });
    const selection = {
      buyer: {
        type: 'INDIVIDUAL',
        name: 'Synthetic Buyer',
        address: 'Synthetic Customer Road, Bengaluru',
        pin: '560001',
        stateCode: '29',
      },
      supplyDate: istToday(),
      supplyContext: 'AT_CENTER',
      placeOfSupplyRuleKey: 'individual-29',
      lineRules: [{ lineItemId: line.id, ruleKey: 'labour' }],
    };
    return { job, line, selection };
  }

  async function previewBody(jobId: string, selection: object) {
    const result = await preview(jobId, selection).expect(200);
    return { selection, previewFingerprint: result.body.fingerprint as string };
  }

  beforeAll(async () => {
    process.env.BILLING_V2_ENABLED = 'true';
    const jwt = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = jwt.jwksJson;
    const base = {
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['advisor'],
    };
    staff = await jwt.signAccessToken({
      ...base,
      permissions: [
        'jobs:read',
        'jobs:update',
        'billing:issue',
        'billing:record-payment',
      ],
    });
    oldBillingPermission = await jwt.signAccessToken({
      ...base,
      permissions: ['jobs:read', 'billing:manage'],
    });
    readOnlyStaff = await jwt.signAccessToken({
      ...base,
      permissions: ['jobs:read'],
    });
    technician = await jwt.signAccessToken({
      ...base,
      roles: ['technician'],
      permissions: ['jobs:read', 'billing:issue'],
    });
    otherCenterStaff = await jwt.signAccessToken({
      sub: TEST_OTHER_USER_ID,
      domainId: TEST_OTHER_DOMAIN_ID,
      roles: ['advisor'],
      permissions: ['jobs:read', 'billing:issue'],
    });
    admin = new DataSource({
      type: 'postgres',
      url:
        process.env.AF019_TEST_ADMIN_URL ??
        'postgresql://autoflex:autoflex@127.0.0.1:5432/postgres',
      entities: [],
      synchronize: false,
      logging: false,
    });
    await admin.initialize();
    if (!/^af019_test_[a-f0-9]{24}$/.test(databaseName))
      throw new Error('Invalid disposable test database name');
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    createdDatabase = true;
    db = new DataSource({
      ...admin.options,
      database: databaseName,
      url: undefined,
      host: new URL(
        process.env.AF019_TEST_ADMIN_URL ??
          'postgresql://autoflex:autoflex@127.0.0.1:5432/postgres',
      ).hostname,
      port: Number(
        new URL(
          process.env.AF019_TEST_ADMIN_URL ??
            'postgresql://autoflex:autoflex@127.0.0.1:5432/postgres',
        ).port || 5432,
      ),
      username: decodeURIComponent(
        new URL(
          process.env.AF019_TEST_ADMIN_URL ??
            'postgresql://autoflex:autoflex@127.0.0.1:5432/postgres',
        ).username,
      ),
      password: decodeURIComponent(
        new URL(
          process.env.AF019_TEST_ADMIN_URL ??
            'postgresql://autoflex:autoflex@127.0.0.1:5432/postgres',
        ).password,
      ),
      entities: ENTITIES,
      migrations: MIGRATIONS,
    });
    await db.initialize();
    const [{ name }] = await db.query('SELECT current_database() AS name');
    if (name !== databaseName)
      throw new Error('Refusing to migrate a non-disposable database');
    await db.runMigrations();
    app = await createApiApp(db);
    app.useLogger(false);
    events = app.get(EventsService);
    await app.listen(0, '127.0.0.1');
  });

  beforeEach(async () => {
    await db.query(
      'TRUNCATE service_centers, customer_profiles, command_idempotency CASCADE',
    );
    centerId = (await seedTestTenancy(db)).serviceCenter.id;
    intake = await seedReturningWalkIn(db, centerId);
    configRow = await db.getRepository(BillingConfiguration).save({
      serviceCenterId: centerId,
      version: 2,
      status: 'APPROVED',
      policy: policy(),
      createdBy: 'synthetic:operator',
      approvedBy: 'synthetic:reviewer',
      approvedAt: new Date(),
      evidenceReference: 'SYNTHETIC-TEST-EXAMPLES',
    });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
    if (createdDatabase && admin?.isInitialized) {
      await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    }
    if (admin?.isInitialized) await admin.destroy();
    if (originalEnabled === undefined) delete process.env.BILLING_V2_ENABLED;
    else process.env.BILLING_V2_ENABLED = originalEnabled;
    if (originalJwks === undefined) delete process.env.LOCAL_JWKS_JSON;
    else process.env.LOCAL_JWKS_JSON = originalJwks;
  });

  it('offers explicit classifications and previews exact approved work without consuming a number', async () => {
    const { job, line, selection } = await createReadyJob();
    const configured = await options(job.id).expect(200);
    expect(configured.body).toMatchObject({
      jobVersion: 1,
      buyerModes: ['INDIVIDUAL', 'BUSINESS'],
      lines: [{ id: line.id, kind: 'LABOUR', amountInr: '100.00' }],
    });
    expect(
      configured.body.rules.map((rule: { key: string }) => rule.key),
    ).toEqual(['labour', 'parts', 'package']);
    const result = await preview(job.id, selection).expect(200);
    expect(result.body).toMatchObject({
      subtotalInr: '100.00',
      taxInr: '18.00',
      totalInr: '118.00',
      jobVersion: 1,
      documentKind: 'TAX_INVOICE',
      blockedReasons: [],
      lines: [{ cgstInr: '9.00', sgstInr: '9.00', igstInr: '0.00' }],
    });
    expect(result.body.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(await db.getRepository(Invoice).count()).toBe(0);
    expect(await db.getRepository(InvoiceSeries).count()).toBe(0);
    expect((await loadJob(job.id)).version).toBe(1);
  });

  it('issues one immutable snapshot and replays the exact command without another number', async () => {
    const { job, line, selection } = await createReadyJob();
    const body = await previewBody(job.id, selection);
    const key = randomUUID();
    const first = await issue(job.id, job.version, body, key).expect(201);
    const replay = await issue(job.id, job.version, body, key).expect(201);
    expect(replay.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      subtotalInr: '100.00',
      taxInr: '18.00',
      totalInr: '118.00',
      buyer: { name: 'Synthetic Buyer', vehicleRegistration: 'KA01AB1234' },
    });
    expect(first.body.invoiceNumber).toMatch(/^TEST\/\d{4}\/000001$/);
    const saved = await db
      .getRepository(Invoice)
      .findOneByOrFail({ jobId: job.id });
    expect(saved).toMatchObject({
      schemaVersion: 2,
      documentKind: 'TAX_INVOICE',
      snapshotHash: body.previewFingerprint,
    });
    expect(saved.billingSnapshot).toMatchObject({
      configurationId: configRow.id,
      configurationVersion: 2,
      buyer: selection.buyer,
      jobVersion: 1,
    });
    expect(
      (
        await db
          .getRepository(InvoiceLineItem)
          .findOneByOrFail({ invoiceId: saved.id })
      ).sourceLineItemId,
    ).toBe(line.id);
    expect((await loadJob(job.id)).version).toBe(2);
    expect(await db.getRepository(Invoice).count()).toBe(1);
    expect(
      (
        await db
          .getRepository(InvoiceSeries)
          .findOneByOrFail({ serviceCenterId: centerId })
      ).nextNumber,
    ).toBe(2);
    expect(
      await db
        .getRepository(CommandIdempotency)
        .countBy({ idempotencyKey: key }),
    ).toBe(1);
    expect(
      await db
        .getRepository(AuditLog)
        .countBy({ entityId: saved.id, action: 'ISSUE' }),
    ).toBe(1);
    await issue(
      job.id,
      job.version,
      { ...body, notes: 'Changed request' },
      key,
    ).expect(422);
  });

  it('requires both headers and split issue permission, including on a valid receipt replay', async () => {
    const { job, selection } = await createReadyJob();
    const body = await previewBody(job.id, selection);
    await as(staff, http().post(`/v1/jobs/${job.id}/invoice`))
      .send(body)
      .expect(400);
    await as(staff, http().post(`/v1/jobs/${job.id}/invoice`))
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(400);
    for (const token of [oldBillingPermission, readOnlyStaff, technician]) {
      await options(job.id, token).expect(403);
      await preview(job.id, selection, token).expect(403);
      await issue(job.id, job.version, body, randomUUID(), token).expect(403);
    }
    const key = randomUUID();
    await issue(job.id, job.version, body, key).expect(201);
    await issue(job.id, job.version, body, key, oldBillingPermission).expect(
      403,
    );
  });

  it('keeps another center outside options, preview, issue and receipt recovery', async () => {
    const { job, selection } = await createReadyJob();
    const body = await previewBody(job.id, selection);
    await options(job.id, otherCenterStaff).expect(404);
    await preview(job.id, selection, otherCenterStaff).expect(404);
    await issue(
      job.id,
      job.version,
      body,
      randomUUID(),
      otherCenterStaff,
    ).expect(404);
    expect(await db.getRepository(Invoice).count()).toBe(0);
  });

  it('blocks unconfigured/suspended rules before preview or issuance', async () => {
    const { job, selection } = await createReadyJob();
    const body = await previewBody(job.id, selection);
    await db
      .getRepository(BillingConfiguration)
      .update(configRow.id, { status: 'SUSPENDED' });
    expect((await preview(job.id, selection).expect(422)).body.code).toBe(
      'BILLING_CONFIGURATION_REQUIRED',
    );
    expect((await issue(job.id, job.version, body).expect(422)).body.code).toBe(
      'BILLING_CONFIGURATION_REQUIRED',
    );
    expect(await db.getRepository(Invoice).count()).toBe(0);
    expect(await db.getRepository(InvoiceSeries).count()).toBe(0);
  });

  it('rejects changed job versions and same-total scope changes without a saved receipt or number', async () => {
    const { job, line, selection } = await createReadyJob();
    const body = await previewBody(job.id, selection);
    await db.getRepository(ServiceJob).update(job.id, { version: 2 });
    const stale = await issue(job.id, 1, body).expect(409);
    expect(stale.body.code).toBe('STALE_JOB_VERSION');
    await db.getRepository(ServiceJob).update(job.id, { version: 1 });
    await db.getRepository(JobLineItem).update(line.id, {
      description: 'Different approved activity at the same price',
    });
    const key = randomUUID();
    expect((await issue(job.id, 1, body, key).expect(409)).body.code).toBe(
      'INVOICE_PREVIEW_CHANGED',
    );
    expect(
      await db
        .getRepository(CommandIdempotency)
        .countBy({ idempotencyKey: key }),
    ).toBe(0);
    expect(await db.getRepository(InvoiceSeries).count()).toBe(0);
  });

  it('requires every approved line exactly once and refuses pending work or direct total overrides', async () => {
    const { job, line, selection } = await createReadyJob();
    expect(
      (
        await preview(job.id, {
          ...selection,
          lineRules: [...selection.lineRules, ...selection.lineRules],
        }).expect(422)
      ).body.code,
    ).toBe('BILLING_LINE_MAPPING_REQUIRED');
    const body = await previewBody(job.id, selection);
    expect(
      (await issue(job.id, 1, { ...body, finalAmountInr: 90 }).expect(422)).body
        .code,
    ).toBe('BILLING_ADJUSTMENT_UNSUPPORTED');
    await db
      .getRepository(JobLineItem)
      .update(line.id, { status: JobLineStatus.PENDING });
    expect((await preview(job.id, selection).expect(422)).body.code).toBe(
      'BILLING_APPROVAL_PENDING',
    );
    expect(await db.getRepository(Invoice).count()).toBe(0);
  });

  it('shows IRP-required business preview as blocked and never issues a substitute invoice', async () => {
    const { job, selection } = await createReadyJob();
    const configured = policy();
    configured.irp.businessMode = 'REQUIRED';
    await db
      .getRepository(BillingConfiguration)
      .update(configRow.id, { policy: configured });
    const business = {
      ...selection,
      placeOfSupplyRuleKey: 'business-29',
      buyer: { ...selection.buyer, type: 'BUSINESS', gstin: '29ABCDE1234F1ZW' },
    };
    const result = await preview(job.id, business).expect(200);
    expect(result.body.blockedReasons).toEqual([
      'BILLING_IRP_INTEGRATION_REQUIRED',
    ]);
    const body = {
      selection: business,
      previewFingerprint: result.body.fingerprint,
    };
    expect((await issue(job.id, 1, body).expect(422)).body.code).toBe(
      'BILLING_IRP_INTEGRATION_REQUIRED',
    );
    expect(await db.getRepository(Invoice).count()).toBe(0);
    expect(await db.getRepository(InvoiceSeries).count()).toBe(0);
  });

  it('rolls an audit failure back with snapshot, sequence, job version, event and receipt', async () => {
    const { job, selection } = await createReadyJob();
    const body = await previewBody(job.id, selection);
    const key = randomUUID();
    jest
      .spyOn(events, 'writeAuditLog')
      .mockRejectedValueOnce(new Error('Synthetic audit failure'));
    await issue(job.id, 1, body, key).expect(500);
    expect(await db.getRepository(Invoice).count()).toBe(0);
    expect(await db.getRepository(InvoiceLineItem).count()).toBe(0);
    expect(await db.getRepository(InvoiceSeries).count()).toBe(0);
    expect(
      await db.getRepository(ServiceJobEvent).countBy({ jobId: job.id }),
    ).toBe(0);
    expect(
      await db
        .getRepository(CommandIdempotency)
        .countBy({ idempotencyKey: key }),
    ).toBe(0);
    expect((await loadJob(job.id)).version).toBe(1);
    expect(
      (await issue(job.id, 1, body, key).expect(201)).body.invoiceNumber,
    ).toMatch(/000001$/);
  });

  it('serializes two commands competing for one version and allocates only one number', async () => {
    const { job, selection } = await createReadyJob();
    const body = await previewBody(job.id, selection);
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const atAudit = new Promise<void>((resolve) => (entered = resolve));
    const original = events.writeAuditLog.bind(events);
    jest
      .spyOn(events, 'writeAuditLog')
      .mockImplementationOnce(async (...args) => {
        entered();
        await blocked;
        return original(...args);
      });
    const first = issue(job.id, 1, body).then((response) => response);
    await atAudit;
    const second = issue(job.id, 1, body).then((response) => response);
    release();
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await db.getRepository(Invoice).count()).toBe(1);
    expect(
      (
        await db
          .getRepository(InvoiceSeries)
          .findOneByOrFail({ serviceCenterId: centerId })
      ).nextNumber,
    ).toBe(2);
    expect((await loadJob(job.id)).version).toBe(2);
  });

  it('keeps an issued invoice unchanged on a fresh command after work changes', async () => {
    const { job, line, selection } = await createReadyJob();
    const body = await previewBody(job.id, selection);
    await issue(job.id, 1, body).expect(201);
    const before = await db.getRepository(Invoice).findOneOrFail({
      where: { jobId: job.id },
      relations: { lineItems: true },
    });
    await db
      .getRepository(JobLineItem)
      .update(line.id, { amountInr: '200.00', unitPriceInr: '200.00' });
    const newBody = await previewBody(job.id, selection);
    expect((await issue(job.id, 2, newBody).expect(409)).body.code).toBe(
      'INVOICE_ALREADY_ISSUED',
    );
    const after = await db.getRepository(Invoice).findOneOrFail({
      where: { id: before.id },
      relations: { lineItems: true },
    });
    expect(after).toEqual(before);
    expect(after.status).toBe('DUE');
    expect(
      (
        await db
          .getRepository(InvoiceSeries)
          .findOneByOrFail({ serviceCenterId: centerId })
      ).nextNumber,
    ).toBe(2);
  });

  it('records full payment and closes against the exact invoice once, including receipt retry', async () => {
    const { job, selection } = await createReadyJob();
    const invoice = (
      await issue(job.id, 1, await previewBody(job.id, selection)).expect(201)
    ).body;
    const before = await db
      .getRepository(Invoice)
      .findOneByOrFail({ id: invoice.id });
    const body = {
      invoiceId: invoice.id,
      payment: { method: 'CASH', amountInr: 118 },
    };
    const key = randomUUID();
    const first = await pay(job.id, 2, body, key).expect(200);
    expect(first.body).toMatchObject({
      id: job.id,
      version: 3,
      status: 'COMPLETED',
      invoice: { id: invoice.id, status: 'PAID' },
    });
    const repeated = await pay(job.id, 2, body, key).expect(200);
    expect(repeated.body.version).toBe(3);
    const after = await db
      .getRepository(Invoice)
      .findOneByOrFail({ id: invoice.id });
    expect(after.invoiceNumber).toBe(before.invoiceNumber);
    expect(after.billingSnapshot).toEqual(before.billingSnapshot);
    expect(after.snapshotHash).toBe(before.snapshotHash);
    expect(
      await db.getRepository(Payment).countBy({ invoiceId: invoice.id }),
    ).toBe(1);
    expect(await db.getRepository(Invoice).count()).toBe(1);
    await pay(job.id, 3, body).expect(409);
    await pay(job.id, 2, body, key, oldBillingPermission).expect(403);
  });

  it('refuses wrong invoice, changed scope, and amount overrides before payment', async () => {
    const { job, line, selection } = await createReadyJob();
    const invoice = (
      await issue(job.id, 1, await previewBody(job.id, selection)).expect(201)
    ).body;
    const body = {
      invoiceId: invoice.id,
      payment: { method: 'CASH', amountInr: 118 },
    };
    await pay(job.id, 2, { ...body, invoiceId: randomUUID() }).expect(409);
    await pay(job.id, 2, { ...body, finalAmountInr: 118 }).expect(422);
    await pay(job.id, 2, {
      ...body,
      payment: { method: 'CASH', amountInr: 100 },
    }).expect(422);
    await db
      .getRepository(JobLineItem)
      .update(line.id, { description: 'Changed scope, same total' });
    expect((await pay(job.id, 2, body).expect(409)).body.code).toBe(
      'INVOICE_SCOPE_CHANGED',
    );
    expect(await db.getRepository(Payment).count()).toBe(0);
    expect((await loadJob(job.id)).status).toBe('READY_FOR_PICKUP');
  });

  it('rolls payment, close and receipt back when its audit fails', async () => {
    const { job, selection } = await createReadyJob();
    const invoice = (
      await issue(job.id, 1, await previewBody(job.id, selection)).expect(201)
    ).body;
    const body = {
      invoiceId: invoice.id,
      payment: { method: 'UPI', amountInr: 118, reference: 'SYNTHETIC-UPI' },
    };
    const key = randomUUID();
    jest
      .spyOn(events, 'writeAuditLog')
      .mockRejectedValueOnce(new Error('Synthetic payment audit fault'));
    await pay(job.id, 2, body, key).expect(500);
    expect(await db.getRepository(Payment).count()).toBe(0);
    expect(
      (await db.getRepository(Invoice).findOneByOrFail({ id: invoice.id }))
        .status,
    ).toBe('DUE');
    expect((await loadJob(job.id)).version).toBe(2);
    expect(
      await db
        .getRepository(CommandIdempotency)
        .countBy({ idempotencyKey: key }),
    ).toBe(0);
    await pay(job.id, 2, body, key).expect(200);
  });

  it('normalizes a center payment reference and refuses its reuse on another invoice', async () => {
    const a = await createReadyJob();
    const b = await createReadyJob();
    const ai = (
      await issue(a.job.id, 1, await previewBody(a.job.id, a.selection)).expect(
        201,
      )
    ).body;
    const bi = (
      await issue(b.job.id, 1, await previewBody(b.job.id, b.selection)).expect(
        201,
      )
    ).body;
    await pay(a.job.id, 2, {
      invoiceId: ai.id,
      payment: { method: 'UPI', amountInr: 118, reference: ' Shared-REF ' },
    }).expect(200);
    expect(
      (
        await pay(b.job.id, 2, {
          invoiceId: bi.id,
          payment: { method: 'UPI', amountInr: 118, reference: 'shared-ref' },
        }).expect(409)
      ).body.code,
    ).toBe('PAYMENT_REFERENCE_USED');
    expect(await db.getRepository(Payment).count()).toBe(1);
  });

  it('keeps a single-activity package classified and charged as one package', async () => {
    const { job, line, selection } = await createReadyJob();
    await db.getRepository(JobLineItem).update(line.id, {
      billingSourceKind: 'PACKAGE',
      scope: [
        {
          offeringId: randomUUID(),
          serviceDefinitionId: null,
          name: 'One included activity',
          description: null,
          quantity: 1,
        },
      ],
    });
    selection.lineRules[0].ruleKey = 'package';
    expect((await options(job.id).expect(200)).body.lines[0].kind).toBe(
      'PACKAGE',
    );
    const body = await previewBody(job.id, selection);
    const result = await issue(job.id, 1, body).expect(201);
    expect(result.body.totalInr).toBe('118.00');
    expect(result.body.lineItems).toHaveLength(1);
    expect(result.body.lineItems[0].taxSnapshot.scope).toHaveLength(1);
    await pay(job.id, 2, {
      invoiceId: result.body.id,
      payment: { method: 'CASH', amountInr: 118 },
    }).expect(200);
  });

  it('starts a fresh series at the explicitly approved cutover number', async () => {
    const configured = policy();
    configured.initialSequence = 41;
    await db
      .getRepository(BillingConfiguration)
      .update(configRow.id, { policy: configured });
    const { job, selection } = await createReadyJob();
    const first = await issue(
      job.id,
      1,
      await previewBody(job.id, selection),
    ).expect(201);
    expect(first.body.invoiceNumber).toMatch(/000041$/);
    expect(
      (
        await db
          .getRepository(InvoiceSeries)
          .findOneByOrFail({ serviceCenterId: centerId })
      ).nextNumber,
    ).toBe(42);
  });

  it('rejects inconsistent source arithmetic in preview and again at final issue before numbering', async () => {
    const { job, line, selection } = await createReadyJob();
    const body = await previewBody(job.id, selection);
    await db.getRepository(JobLineItem).update(line.id, {
      quantity: '2',
      unitPriceInr: '100.00',
      amountInr: '50.00',
    });
    expect((await preview(job.id, selection).expect(422)).body.code).toBe(
      'BILLING_LINE_AMOUNT_MISMATCH',
    );
    expect((await issue(job.id, 1, body).expect(422)).body.code).toBe(
      'BILLING_LINE_AMOUNT_MISMATCH',
    );
    expect(await db.getRepository(InvoiceSeries).count()).toBe(0);
    expect(
      (await db.getRepository(JobLineItem).findOneByOrFail({ id: line.id }))
        .amountInr,
    ).toBe('50.00');
  });

  it('requires a matching approved context and saves the explicit supply decision', async () => {
    const { job, selection } = await createReadyJob();
    expect(
      (
        await preview(job.id, {
          ...selection,
          supplyContext: 'PICKUP_DROP',
        }).expect(422)
      ).body.code,
    ).toBe('BILLING_PLACE_OF_SUPPLY_REQUIRED');
    await preview(job.id, { ...selection, supplyStateCode: '27' }).expect(400);
    const invoice = (
      await issue(job.id, 1, await previewBody(job.id, selection)).expect(201)
    ).body;
    expect(invoice.placeOfSupply).toEqual({
      context: 'AT_CENTER',
      stateCode: '29',
    });
    const saved = await db
      .getRepository(Invoice)
      .findOneByOrFail({ id: invoice.id });
    expect(saved.billingSnapshot?.placeOfSupply).toMatchObject({
      stateCode: '29',
      ruleKey: 'individual-29',
      basisReference: 'SYNTHETIC-ONLY',
    });
  });

  it('invalidates the preview when a supply basis changes before issue', async () => {
    const { job, selection } = await createReadyJob();
    const body = await previewBody(job.id, selection);
    const configured = policy();
    configured.placeOfSupplyRules[0].supplyStateCode = '27';
    await db
      .getRepository(BillingConfiguration)
      .update(configRow.id, { policy: configured });
    expect((await issue(job.id, 1, body).expect(409)).body.code).toBe(
      'INVOICE_PREVIEW_CHANGED',
    );
    expect(await db.getRepository(InvoiceSeries).count()).toBe(0);
  });

  it.each([false, true])(
    'settles a legacy package after its booking reference changes (older snapshot: %s)',
    async (olderSnapshot) => {
      const { job, line, selection } = await createReadyJob();
      const garage = await db.getRepository(GarageVehicle).save({
        customerProfileId: intake.profile.id,
        make: 'Honda',
        model: 'Activa',
        registrationNumber: 'KA01TEST',
        vehicleType: VehicleType.TWO_WHEELER,
      });
      const booking = await db.getRepository(Booking).save({
        serviceCenterId: centerId,
        customerProfileId: intake.profile.id,
        vehicleId: garage.id,
        mode: BookingMode.SELF_CHECKIN,
        status: BookingStatus.CONFIRMED,
        slotStart: new Date(),
        slotEnd: new Date(Date.now() + 3600000),
      });
      const pkg = await db.getRepository(ServicePackage).save({
        serviceCenterId: centerId,
        name: 'Synthetic one-service package',
        vehicleType: VehicleType.TWO_WHEELER,
        priceInr: '100.00',
        durationMinutes: 60,
        components: [],
      });
      const source = await db.getRepository(BookingItem).save({
        bookingId: booking.id,
        servicePackageId: pkg.id,
        name: pkg.name,
        priceInr: '100.00',
        durationMinutes: 60,
        scope: [],
      });
      await db.getRepository(JobLineItem).update(line.id, {
        sourceBookingItemId: source.id,
        billingSourceKind: null,
        scope: [
          {
            offeringId: randomUUID(),
            serviceDefinitionId: null,
            name: 'Single included service',
            description: null,
            quantity: 1,
          },
        ],
      });
      selection.lineRules[0].ruleKey = 'package';
      const invoice = (
        await issue(job.id, 1, await previewBody(job.id, selection)).expect(201)
      ).body;
      expect(
        (await db.getRepository(JobLineItem).findOneByOrFail({ id: line.id }))
          .billingSourceKind,
      ).toBe('PACKAGE');
      if (olderSnapshot) {
        const row = await db
          .getRepository(Invoice)
          .findOneByOrFail({ id: invoice.id });
        const snapshot = row.billingSnapshot!;
        snapshot.lines = (snapshot.lines as Record<string, unknown>[]).map(
          (line) => {
            const copy = { ...line };
            delete copy.sourceKind;
            return copy;
          },
        );
        await db
          .getRepository(Invoice)
          .update(row.id, { billingSnapshot: snapshot });
        await db
          .getRepository(JobLineItem)
          .update(line.id, { billingSourceKind: null });
      }
      await db
        .getRepository(BookingItem)
        .update(source.id, { servicePackageId: null });
      await pay(job.id, 2, {
        invoiceId: invoice.id,
        payment: { method: 'CASH', amountInr: 118 },
      }).expect(200);
      expect(
        await db.getRepository(Payment).countBy({ invoiceId: invoice.id }),
      ).toBe(1);
    },
  );

  it('still blocks an actual operational or explicitly saved charge-kind edit after issue', async () => {
    const { job, line, selection } = await createReadyJob();
    const invoice = (
      await issue(job.id, 1, await previewBody(job.id, selection)).expect(201)
    ).body;
    await db
      .getRepository(JobLineItem)
      .update(line.id, { kind: JobLineKind.FEE });
    expect(
      (
        await pay(job.id, 2, {
          invoiceId: invoice.id,
          payment: { method: 'CASH', amountInr: 118 },
        }).expect(409)
      ).body.code,
    ).toBe('INVOICE_SCOPE_CHANGED');
    expect(await db.getRepository(Payment).count()).toBe(0);
  });

  it('lets only one of two competing counter-payment commands close the job', async () => {
    const { job, selection } = await createReadyJob();
    const invoice = (
      await issue(job.id, 1, await previewBody(job.id, selection)).expect(201)
    ).body;
    const body = {
      invoiceId: invoice.id,
      payment: { method: 'CASH', amountInr: 118 },
    };
    const results = await Promise.all([
      pay(job.id, 2, body),
      pay(job.id, 2, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.getRepository(Payment).count()).toBe(1);
    expect((await loadJob(job.id)).version).toBe(3);
  });

  it('keeps configured centers off legacy issue when rollout is disabled', async () => {
    const { job } = await createReadyJob();
    process.env.BILLING_V2_ENABLED = 'false';
    try {
      const response = await issue(
        job.id,
        1,
        {},
        randomUUID(),
        oldBillingPermission,
      ).expect(422);
      expect(response.body.code).toBe('BILLING_ROLLOUT_DISABLED');
      expect(await db.getRepository(Invoice).count()).toBe(0);
    } finally {
      process.env.BILLING_V2_ENABLED = 'true';
    }
  });
});
