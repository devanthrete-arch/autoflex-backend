import { InvoiceSeries } from '../src/modules/billing/entities/invoice-series.entity';
import { ReceptionIdentityService } from '../src/modules/reception/reception-identity.service';
import { UnprocessableEntityException } from '@nestjs/common';
import { CustomerNotification } from '../src/modules/notifications/entities/customer-notification.entity';
import { FinancialNote } from '../src/modules/billing/entities/financial-note.entity';
import { Payment } from '../src/modules/billing/entities/payment.entity';
import { InvoiceDocumentService } from '../src/modules/billing/documents/invoice-document.service';
import { randomBytes, randomUUID, createHash } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { SignJWT } from 'jose';
import request from 'supertest';
import type { Server } from 'http';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ENTITIES } from '../src/database/entities';
import { MIGRATIONS } from '../src/database/migration-list';
import {
  createJwtTestFixture,
  type JwtTestFixture,
} from '../src/test-utils/jwt-test.helper';
import { createApiApp } from './helpers/e2e-app.helper';
import {
  seedTestTenancy,
  TEST_DOMAIN_ID,
  TEST_IAM_USER_ID,
  TEST_OTHER_DOMAIN_ID,
  TEST_OTHER_USER_ID,
  TEST_CUSTOMER_APP_ID,
  TEST_CUSTOMER_DOMAIN_ID,
} from './helpers/test-db.helper';
import { CustomerProfile } from '../src/modules/customers/entities/customer-profile.entity';
import { Customer } from '../src/modules/customers/entities/customer.entity';
import { Vehicle } from '../src/modules/customers/entities/vehicle.entity';
import { ServiceJob } from '../src/modules/jobs/entities/service-job.entity';
import { JobLineItem } from '../src/modules/jobs/entities/job-line-item.entity';
import { JobCustomerAccess } from '../src/modules/jobs/entities/job-customer-access.entity';
import { RegistrationSession } from '../src/modules/reception/entities/registration-session.entity';
import { AuditLog } from '../src/modules/events/entities/audit-log.entity';
import { Invoice } from '../src/modules/billing/entities/invoice.entity';
import { InvoiceDocument } from '../src/modules/billing/entities/invoice-document.entity';
import { BillingConfiguration } from '../src/modules/billing/entities/billing-configuration.entity';
import { PrivateInvoiceStorage } from '../src/modules/billing/documents/private-invoice-storage';
import { seedReturningWalkIn } from './helpers/returning-walk-in.helper';
import { syntheticBillingPolicy } from './helpers/billing-policy.helper';
import { JobStatus } from '../src/common/enums/job-status.enum';
import { JobLineKind, JobLineStatus } from '../src/common/enums/job-work.enum';
import { InvoiceStatus } from '../src/common/enums/ownership.enum';
import { istToday } from '../src/common/time/ist';
const suite =
  process.env.AF_COMPLETION_POSTGRES_TEST === 'true' ? describe : describe.skip;
suite('Reception and invoice completion on isolated PostgreSQL', () => {
  let admin: DataSource,
    db: DataSource,
    app: INestApplication,
    jwt: JwtTestFixture,
    staff: string,
    otherStaff: string,
    finance: string,
    limited: string,
    technician: string,
    customer: string,
    otherCustomer: string,
    centerId: string,
    profileId: string,
    localDir: string;
  const name = `af_completion_${randomBytes(10).toString('hex')}`;
  const subject = randomUUID();
  const keys = [
    'BILLING_V2_ENABLED',
    'IAM_FINANCE_DOMAIN_ID',
    'IAM_FINANCE_DOMAIN_APPLICATION_ID',
    'IAM_CUSTOMER_DOMAIN_APPLICATION_ID',
    'RECEPTION_CHALLENGE_KEY',
    'RECEPTION_IDENTITY_ISSUER',
    'RECEPTION_IDENTITY_AUDIENCE',
    'RECEPTION_IDENTITY_LOCAL_JWKS',
    'LOCAL_JWKS_JSON',
    'INVOICE_STORAGE_DRIVER',
    'INVOICE_LOCAL_DIRECTORY',
    'INVOICE_DOCUMENT_WORKER_ENABLED',
  ];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const http = () => request(app.getHttpServer() as Server);
  const as = (token: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`);
  const post = (
    token: string,
    path: string,
    body: object,
    version?: number,
    key = randomUUID(),
  ) => {
    const r = as(token, http().post(path)).set('Idempotency-Key', key);
    if (version) r.set('If-Match', String(version));
    return r.send(body);
  };
  const start = async (phone = '+919876543211') =>
    (
      await post(staff, '/v1/center/registration-sessions', { phone }).expect(
        201,
      )
    ).body;
  const challenge = (session: { handoffPath: string }) =>
    new URLSearchParams(session.handoffPath.split('#')[1]).get('challenge')!;
  const proof = async (id: string, phone = '+919876543211', sub = subject) =>
    new SignJWT({
      purpose: 'reception-registration',
      sessionId: id,
      phone,
      verifiedAt: Math.floor(Date.now() / 1000),
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-primary' })
      .setIssuer('test-reception')
      .setAudience('reception')
      .setSubject(sub)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(jwt.privateKey);
  async function consent(session: any, phone?: string) {
    return post(
      customer,
      `/v1/me/reception-sessions/${session.id}/consent`,
      {
        challenge: challenge(session),
        name: 'Synthetic New Customer',
        consent: true,
        verificationAssertion: await proof(session.id, phone),
      },
      session.version,
    ).expect(200);
  }
  beforeAll(async () => {
    localDir = await mkdtemp(join(tmpdir(), 'autoflex-pdf-test-'));
    jwt = await createJwtTestFixture();
    Object.assign(process.env, {
      BILLING_V2_ENABLED: 'true',
      IAM_FINANCE_DOMAIN_ID: 'completion-finance-domain',
      IAM_FINANCE_DOMAIN_APPLICATION_ID: 'completion-finance-app',
      IAM_CUSTOMER_DOMAIN_APPLICATION_ID: TEST_CUSTOMER_APP_ID,
      RECEPTION_CHALLENGE_KEY: randomBytes(32).toString('hex'),
      RECEPTION_IDENTITY_ISSUER: 'test-reception',
      RECEPTION_IDENTITY_AUDIENCE: 'reception',
      RECEPTION_IDENTITY_LOCAL_JWKS: jwt.jwksJson,
      LOCAL_JWKS_JSON: jwt.jwksJson,
      INVOICE_STORAGE_DRIVER: 'filesystem',
      INVOICE_LOCAL_DIRECTORY: localDir,
      INVOICE_DOCUMENT_WORKER_ENABLED: 'false',
    });
    const base = {
      domainId: TEST_DOMAIN_ID,
      sub: TEST_IAM_USER_ID,
      roles: ['manager'],
    };
    finance = await jwt.signAccessToken({
      sub: randomUUID(),
      domainId: 'completion-finance-domain',
      domainApplicationId: 'completion-finance-app',
      roles: ['finance_reviewer'],
      permissions: ['billing:approve'],
    });
    staff = await jwt.signAccessToken({
      ...base,
      permissions: [
        'jobs:read',
        'jobs:create',
        'jobs:update',
        'customers:register',
        'billing:issue',
        'billing:record-payment',
        'billing:correct',
      ],
    });
    limited = await jwt.signAccessToken({
      ...base,
      permissions: ['jobs:read', 'jobs:create'],
    });
    technician = await jwt.signAccessToken({
      ...base,
      roles: ['technician'],
      permissions: ['jobs:read'],
    });
    otherStaff = await jwt.signAccessToken({
      ...base,
      domainId: TEST_OTHER_DOMAIN_ID,
      sub: TEST_OTHER_USER_ID,
      permissions: ['jobs:read', 'jobs:create', 'customers:register'],
    });
    customer = await jwt.signAccessToken({
      sub: subject,
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      mobile: '9876543211',
      roles: ['customer'],
      permissions: [],
    });
    otherCustomer = await jwt.signAccessToken({
      sub: randomUUID(),
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      mobile: '9876543222',
      roles: ['customer'],
      permissions: [],
    });
    const url = new URL(
      process.env.AF_COMPLETION_TEST_ADMIN_URL ??
        'postgresql://autoflex:autoflex@127.0.0.1:5432/postgres',
    );
    const connection = {
      type: 'postgres' as const,
      connectTimeoutMS: 5000,
      host: url.hostname,
      port: Number(url.port || 5432),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
    admin = new DataSource({ ...connection, database: url.pathname.slice(1) });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${name}"`);
    db = new DataSource({
      ...connection,
      database: name,
      entities: ENTITIES,
      migrations: MIGRATIONS,
    });
    await db.initialize();
    if ((await db.query('SELECT current_database() AS name'))[0].name !== name)
      throw new Error('Not disposable');
    await db.runMigrations();
    app = await createApiApp(db);
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    await db.query(
      'TRUNCATE service_centers, customer_profiles, command_idempotency CASCADE',
    );
    centerId = (await seedTestTenancy(db)).serviceCenter.id;
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.destroy();
    }
    if (localDir) await rm(localDir, { recursive: true, force: true });
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  });
  it('registers a first-time customer, replays consent/link and opens a privately granted visit', async () => {
    const s = await start();
    expect(s).not.toHaveProperty('customerProfileId');
    expect(await db.getRepository(Customer).count()).toBe(0);
    const body = {
      challenge: challenge(s),
      name: 'Synthetic New Customer',
      consent: true,
      verificationAssertion: await proof(s.id),
    };
    const key = randomUUID();
    const c = await post(
      customer,
      `/v1/me/reception-sessions/${s.id}/consent`,
      body,
      s.version,
      key,
    ).expect(200);
    await post(
      customer,
      `/v1/me/reception-sessions/${s.id}/consent`,
      body,
      s.version,
      key,
    ).expect(200);
    const fk = randomUUID();
    const result = await post(
      staff,
      `/v1/center/registration-sessions/${s.id}/finalize`,
      {},
      c.body.version,
      fk,
    ).expect(200);
    await post(
      staff,
      `/v1/center/registration-sessions/${s.id}/finalize`,
      {},
      c.body.version,
      fk,
    ).expect(200);
    expect(await db.getRepository(Customer).count()).toBe(1);
    expect(await db.getRepository(JobCustomerAccess).count()).toBe(0);
    const create = {
      customerId: result.body.customer.id,
      customerRevision: result.body.customer.revision,
      newVehicle: {
        registrationNumber: 'KA01DE9001',
        vehicleType: 'TWO_WHEELER',
        makeModel: 'Synthetic Scooter',
      },
      serviceType: 'Synthetic inspection',
    };
    const job = await post(staff, '/v1/jobs', create).expect(201);
    expect(await db.getRepository(JobCustomerAccess).count()).toBe(1);
    await as(customer, http().get(`/v1/me/jobs/${job.body.id}`)).expect(200);
    await as(otherCustomer, http().get(`/v1/me/jobs/${job.body.id}`)).expect(
      404,
    );
  });
  it('does not substitute editable profile data for a signed phone assertion', async () => {
    const s = await start();
    await post(
      customer,
      `/v1/me/reception-sessions/${s.id}/consent`,
      {
        challenge: challenge(s),
        name: 'User',
        consent: true,
        verificationAssertion: 'not-a-real-signed-token',
      },
      s.version,
    ).expect(422);
    expect(await db.getRepository(Customer).count()).toBe(0);
  });
  it('rejects proof for a different phone/session/subject', async () => {
    const s = await start();
    for (const assertion of [
      await proof(s.id, '+919876543222'),
      await proof(randomUUID()),
      await proof(s.id, undefined, randomUUID()),
    ])
      await post(
        customer,
        `/v1/me/reception-sessions/${s.id}/consent`,
        {
          challenge: challenge(s),
          name: 'User',
          consent: true,
          verificationAssertion: assertion,
        },
        s.version,
      ).expect(422);
  });
  it('protects staff authority and center-scoped recovery', async () => {
    await post(limited, '/v1/center/registration-sessions', {
      phone: '9876543211',
    }).expect(403);
    const s = await start();
    await as(
      otherStaff,
      http().get(`/v1/center/registration-sessions/${s.id}`),
    ).expect(404);
    await as(
      technician,
      http().get(`/v1/center/registration-sessions/${s.id}`),
    ).expect(403);
  });
  it('refuses to replace an existing account phone even with valid session-bound proof', async () => {
    const p = await db.getRepository(CustomerProfile).save({
      iamUserId: subject,
      phone: '+919876543211',
      displayName: 'Existing customer',
    });
    const s = await start('+919876543222');
    const broker = jest.spyOn(app.get(ReceptionIdentityService), 'acquire');
    expect(
      (
        await post(customer, `/v1/me/reception-sessions/${s.id}/verification`, {
          challenge: challenge(s),
        }).expect(409)
      ).body.code,
    ).toBe('REGISTRATION_ACCOUNT_PHONE_MISMATCH');
    expect(broker).not.toHaveBeenCalled();
    const result = await post(
      customer,
      `/v1/me/reception-sessions/${s.id}/consent`,
      {
        challenge: challenge(s),
        name: 'Changed name',
        consent: true,
        verificationAssertion: await proof(s.id, '+919876543222'),
      },
      s.version,
    ).expect(409);
    expect(result.body.code).toBe('REGISTRATION_ACCOUNT_PHONE_MISMATCH');
    expect(
      await db.getRepository(CustomerProfile).findOneByOrFail({ id: p.id }),
    ).toMatchObject({ phone: p.phone, displayName: p.displayName });
    expect(
      await db.getRepository(RegistrationSession).findOneByOrFail({ id: s.id }),
    ).toMatchObject({ state: 'WAITING_CUSTOMER', customerProfileId: null });
    expect(await db.getRepository(Customer).count()).toBe(0);
    expect(
      await db
        .getRepository(AuditLog)
        .countBy({ action: 'RECEPTION_CUSTOMER_CONSENTED' }),
    ).toBe(0);
  });
  it('rechecks account phone after external verification and before saving consent', async () => {
    const p = await db.getRepository(CustomerProfile).save({
      iamUserId: subject,
      phone: '+919876543211',
    });
    const s = await start();
    const identity = app.get(ReceptionIdentityService);
    const verify = identity.verify.bind(identity);
    jest.spyOn(identity, 'verify').mockImplementationOnce(async (...args) => {
      const result = await verify(...args);
      await db
        .getRepository(CustomerProfile)
        .update(p.id, { phone: '+919876543222' });
      return result;
    });
    await post(
      customer,
      `/v1/me/reception-sessions/${s.id}/consent`,
      {
        challenge: challenge(s),
        name: 'Customer',
        consent: true,
        verificationAssertion: await proof(s.id),
      },
      s.version,
    ).expect(409);
    expect(
      (await db.getRepository(CustomerProfile).findOneByOrFail({ id: p.id }))
        .phone,
    ).toBe('+919876543222');
    expect(
      (
        await db
          .getRepository(RegistrationSession)
          .findOneByOrFail({ id: s.id })
      ).state,
    ).toBe('WAITING_CUSTOMER');
  });
  it('preserves an equivalent existing phone and refuses finalization after that phone changes', async () => {
    const p = await db.getRepository(CustomerProfile).save({
      iamUserId: subject,
      phone: '9876543211',
    });
    const s = await start();
    const accepted = await consent(s);
    expect(
      (await db.getRepository(CustomerProfile).findOneByOrFail({ id: p.id }))
        .phone,
    ).toBe('9876543211');
    await db
      .getRepository(CustomerProfile)
      .update(p.id, { phone: '+919876543222' });
    await post(
      staff,
      `/v1/center/registration-sessions/${s.id}/finalize`,
      {},
      accepted.body.version,
    ).expect(409);
    expect(await db.getRepository(Customer).count()).toBe(0);
    await post(
      staff,
      `/v1/center/registration-sessions/${s.id}/cancel`,
      {},
      accepted.body.version,
    ).expect(200);
  });
  it('initializes a missing account phone only after valid proof and consent', async () => {
    const noPhoneToken = await jwt.signAccessToken({
      sub: subject,
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      roles: ['customer'],
      permissions: [],
    });
    const p = await db
      .getRepository(CustomerProfile)
      .save({ iamUserId: subject });
    const s = await start();
    await post(
      noPhoneToken,
      `/v1/me/reception-sessions/${s.id}/consent`,
      {
        challenge: challenge(s),
        name: 'Customer',
        consent: true,
        verificationAssertion: await proof(s.id),
      },
      s.version,
    ).expect(200);
    expect(
      (await db.getRepository(CustomerProfile).findOneByOrFail({ id: p.id }))
        .phone,
    ).toBe('+919876543211');
  });
  it('rejects incomplete and expired requests', async () => {
    const s = await start();
    await post(
      staff,
      `/v1/center/registration-sessions/${s.id}/finalize`,
      {},
      s.version,
    ).expect(422);
    await db
      .getRepository(RegistrationSession)
      .update(s.id, { expiresAt: new Date(Date.now() - 1000) });
    await post(customer, `/v1/me/reception-sessions/${s.id}/context`, {
      challenge: challenge(s),
    }).expect(422);
  });
  it('converges concurrent registrations on one active center customer', async () => {
    const a = await start();
    const b = await start();
    const ca = await consent(a);
    const cb = await consent(b);
    const rows = await Promise.all([
      post(
        staff,
        `/v1/center/registration-sessions/${a.id}/finalize`,
        {},
        ca.body.version,
      ),
      post(
        staff,
        `/v1/center/registration-sessions/${b.id}/finalize`,
        {},
        cb.body.version,
      ),
    ]);
    expect(rows.map((r) => r.status)).toEqual([200, 200]);
    expect(rows[0].body.customer.id).toBe(rows[1].body.customer.id);
    expect(await db.getRepository(Customer).count()).toBe(1);
  });
  it('never links an unlinked contact with historical vehicle records', async () => {
    const s = await start();
    const c = await consent(s);
    const legacy = await db.getRepository(Customer).save({
      serviceCenterId: centerId,
      phone: '+919876543211',
      phoneCanonical: '+919876543211',
      name: 'Historical contact',
    });
    await db.getRepository(Vehicle).save({
      serviceCenterId: centerId,
      customerId: legacy.id,
      registrationNumber: 'KA01DE9001',
    });
    const response = await post(
      staff,
      `/v1/center/registration-sessions/${s.id}/finalize`,
      {},
      c.body.version,
    ).expect(422);
    expect(response.body.code).toBe('REGISTRATION_LEGACY_REVIEW_REQUIRED');
    expect(
      (await db.getRepository(Customer).findOneByOrFail({ id: legacy.id }))
        .customerProfileId,
    ).toBeNull();
  });
  it('serializes cancellation against finalization', async () => {
    const s = await start();
    const c = await consent(s);
    const rows = await Promise.all([
      post(
        staff,
        `/v1/center/registration-sessions/${s.id}/cancel`,
        {},
        c.body.version,
      ),
      post(
        staff,
        `/v1/center/registration-sessions/${s.id}/finalize`,
        {},
        c.body.version,
      ),
    ]);
    expect(rows.map((r) => r.status).sort()).toEqual([200, 409]);
    const saved = await db
      .getRepository(RegistrationSession)
      .findOneByOrFail({ id: s.id });
    expect(await db.getRepository(Customer).count()).toBe(
      saved.state === 'COMPLETED' ? 1 : 0,
    );
  });
  it('rolls account linking back if private audit fails', async () => {
    const s = await start();
    const c = await consent(s);
    await db.query(
      `CREATE FUNCTION fail_registration_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='RECEPTION_ACCOUNT_LINKED' THEN RAISE EXCEPTION 'test audit fault'; END IF; RETURN NEW; END $$`,
    );
    await db.query(
      'CREATE TRIGGER fail_registration_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_registration_audit()',
    );
    try {
      await post(
        staff,
        `/v1/center/registration-sessions/${s.id}/finalize`,
        {},
        c.body.version,
      ).expect(500);
      expect(await db.getRepository(Customer).count()).toBe(0);
      expect(
        (
          await db
            .getRepository(RegistrationSession)
            .findOneByOrFail({ id: s.id })
        ).state,
      ).toBe('CONSENTED');
    } finally {
      await db.query('DROP TRIGGER fail_registration_audit ON audit_logs');
      await db.query('DROP FUNCTION fail_registration_audit()');
    }
  });
  it('rejects a changed start body under the original key', async () => {
    const key = randomUUID();
    await post(
      staff,
      '/v1/center/registration-sessions',
      { phone: '9876543211' },
      undefined,
      key,
    ).expect(201);
    await post(
      staff,
      '/v1/center/registration-sessions',
      { phone: '9876543212' },
      undefined,
      key,
    ).expect(422);
  });
  async function readyInvoice() {
    const intake = await seedReturningWalkIn(db, centerId, {
      profileId: undefined,
    });
    profileId = intake.profile.id;
    await db
      .getRepository(CustomerProfile)
      .update(profileId, { iamUserId: subject });
    const job = await db.getRepository(ServiceJob).save({
      serviceCenterId: centerId,
      customerId: intake.customer.id,
      vehicleId: intake.vehicle.id,
      billingCustomerProfileId: profileId,
      status: JobStatus.READY_FOR_PICKUP,
      publicToken: randomBytes(32).toString('base64url'),
      serviceType: 'Synthetic invoice',
      intakeSnapshot: {
        customerName: 'Synthetic Buyer',
        customerPhone: '+919876543210',
        vehicleRegistration: 'KA01AB1234',
        vehicleLabel: 'Synthetic Scooter',
        garageVehicleId: null,
      },
    });
    const line = await db.getRepository(JobLineItem).save({
      jobId: job.id,
      serviceCenterId: centerId,
      kind: JobLineKind.LABOUR,
      billingSourceKind: 'LABOUR',
      description: 'Synthetic labour',
      quantity: '1.00',
      unitPriceInr: '100.00',
      amountInr: '100.00',
      status: JobLineStatus.INCLUDED,
      scope: [],
    });
    await db.getRepository(BillingConfiguration).save({
      serviceCenterId: centerId,
      version: 2,
      status: 'APPROVED',
      policy: syntheticBillingPolicy(),
      createdBy: 'synthetic:operator',
      approvedBy: 'synthetic:reviewer',
      approvedAt: new Date(),
      evidenceReference: 'SYNTHETIC-ONLY',
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
    const preview = await post(
      staff,
      `/v1/jobs/${job.id}/invoice-preview`,
      selection,
    ).expect(200);
    const invoice = await post(
      staff,
      `/v1/jobs/${job.id}/invoice`,
      { selection, previewFingerprint: preview.body.fingerprint },
      job.version,
    ).expect(201);
    return { job, line, selection, invoice: invoice.body };
  }
  it('renders one private PDF and enforces original-recipient/desk access', async () => {
    const { invoice } = await readyInvoice();
    expect(await db.getRepository(InvoiceDocument).count()).toBe(1);
    await post(
      otherCustomer,
      `/v1/me/invoices/${invoice.id}/document`,
      {},
    ).expect(404);
    await as(
      technician,
      http().get(`/v1/center/invoices/${invoice.id}/pdf`),
    ).expect(403);
    await post(customer, `/v1/me/invoices/${invoice.id}/document`, {}).expect(
      200,
    );
    const bytes = await as(
      customer,
      http().get(`/v1/me/invoices/${invoice.id}/pdf`),
    ).expect(200);
    expect(bytes.headers['content-type']).toContain('application/pdf');
    const row = await db
      .getRepository(InvoiceDocument)
      .findOneByOrFail({ invoiceId: invoice.id });
    expect(row.state).toBe('READY');
    expect(createHash('sha256').update(bytes.body).digest('hex')).toBe(
      row.sha256,
    );
    await post(staff, `/v1/center/invoices/${invoice.id}/document`, {}).expect(
      200,
    );
    expect(
      (
        await db
          .getRepository(InvoiceDocument)
          .findOneByOrFail({ invoiceId: invoice.id })
      ).attempts,
    ).toBe(1);
  });
  it('recovers render failure without changing the invoice', async () => {
    const { invoice } = await readyInvoice();
    const storage = app.get(PrivateInvoiceStorage);
    jest
      .spyOn(storage, 'put')
      .mockRejectedValueOnce(new Error('synthetic fault'));
    await post(customer, `/v1/me/invoices/${invoice.id}/document`, {}).expect(
      200,
    );
    const row = await db
      .getRepository(InvoiceDocument)
      .findOneByOrFail({ invoiceId: invoice.id });
    expect(row.state).toBe('FAILED');
    expect(
      (await db.getRepository(Invoice).findOneByOrFail({ id: invoice.id }))
        .totalInr,
    ).toBe('118.00');
    await db
      .getRepository(InvoiceDocument)
      .update(row.id, { retryAt: new Date(0) });
    await post(customer, `/v1/me/invoices/${invoice.id}/document`, {}).expect(
      200,
    );
    expect(
      (
        await db
          .getRepository(InvoiceDocument)
          .findOneByOrFail({ invoiceId: invoice.id })
      ).state,
    ).toBe('READY');
  });
  it('retains a cancelled invoice and allocates a new replacement number', async () => {
    const { job, invoice, selection } = await readyInvoice();
    const loaded = await db
      .getRepository(ServiceJob)
      .findOneByOrFail({ id: job.id });
    const key = randomUUID();
    await post(
      staff,
      `/v1/center/invoices/${invoice.id}/cancel`,
      { reason: 'Synthetic billing correction' },
      loaded.version,
      key,
    ).expect(200);
    await post(
      staff,
      `/v1/center/invoices/${invoice.id}/cancel`,
      { reason: 'Synthetic billing correction' },
      loaded.version,
      key,
    ).expect(200);
    await as(customer, http().get(`/v1/me/invoices/${invoice.id}`)).expect(200);
    const p = await post(
      staff,
      `/v1/jobs/${job.id}/invoice-preview`,
      selection,
    ).expect(200);
    const replacement = await post(
      staff,
      `/v1/jobs/${job.id}/invoice`,
      { selection, previewFingerprint: p.body.fingerprint },
      p.body.jobVersion,
    ).expect(201);
    expect(replacement.body.invoiceNumber).not.toBe(invoice.invoiceNumber);
    expect(replacement.body.replacementForInvoiceId).toBe(invoice.id);
    expect(await db.getRepository(Invoice).count()).toBe(2);
  });
  it('never cancels a paid invoice', async () => {
    const { job, invoice } = await readyInvoice();
    const version = (
      await db.getRepository(ServiceJob).findOneByOrFail({ id: job.id })
    ).version;
    await post(
      staff,
      `/v1/jobs/${job.id}/close`,
      { invoiceId: invoice.id, payment: { method: 'CASH', amountInr: 118 } },
      version,
    ).expect(200);
    const current = (
      await db.getRepository(ServiceJob).findOneByOrFail({ id: job.id })
    ).version;
    await post(
      staff,
      `/v1/center/invoices/${invoice.id}/cancel`,
      { reason: 'Not allowed' },
      current,
    ).expect(409);
    expect(
      (await db.getRepository(Invoice).findOneByOrFail({ id: invoice.id }))
        .status,
    ).toBe('PAID');
  });
  async function paidInvoice() {
    const setup = await readyInvoice();
    const current = await db
      .getRepository(ServiceJob)
      .findOneByOrFail({ id: setup.job.id });
    await post(
      staff,
      `/v1/jobs/${current.id}/close`,
      {
        invoiceId: setup.invoice.id,
        payment: { method: 'CASH', amountInr: 118 },
      },
      current.version,
    ).expect(200);
    return {
      ...setup,
      current: await db
        .getRepository(ServiceJob)
        .findOneByOrFail({ id: current.id }),
      saved: await db.getRepository(Invoice).findOneOrFail({
        where: { id: setup.invoice.id },
        relations: { lineItems: true },
      }),
    };
  }
  it('keeps discounts in the snapshot and pays the discounted saved scope', async () => {
    const { job, line, invoice, selection } = await readyInvoice();
    const current = await db
      .getRepository(ServiceJob)
      .findOneByOrFail({ id: job.id });
    await post(
      staff,
      `/v1/center/invoices/${invoice.id}/cancel`,
      { reason: 'Synthetic discount example' },
      current.version,
    ).expect(200);
    const discounted = {
      ...selection,
      lineRules: [
        {
          lineItemId: line.id,
          ruleKey: 'labour',
          discountInr: '10.00',
          discountReason: 'Synthetic goodwill',
        },
      ],
    };
    const p = await post(
      staff,
      `/v1/jobs/${job.id}/invoice-preview`,
      discounted,
    ).expect(200);
    expect(p.body.totalInr).toBe('106.20');
    const issued = await post(
      staff,
      `/v1/jobs/${job.id}/invoice`,
      { selection: discounted, previewFingerprint: p.body.fingerprint },
      p.body.jobVersion,
    ).expect(201);
    const v = await db
      .getRepository(ServiceJob)
      .findOneByOrFail({ id: job.id });
    await post(
      staff,
      `/v1/jobs/${job.id}/close`,
      {
        invoiceId: issued.body.id,
        payment: { method: 'CASH', amountInr: 106.2 },
      },
      v.version,
    ).expect(200);
  });
  it('issues a retained credit note once, with capped original tax and a private PDF', async () => {
    const { saved, current } = await paidInvoice();
    const input = {
      kind: 'CREDIT',
      reason: 'Synthetic overcharge correction',
      lines: [{ sourceLineId: saved.lineItems[0].id, netInr: '40.00' }],
    };
    const key = randomUUID();
    const proposed = await post(
      staff,
      `/v1/center/invoices/${saved.id}/notes`,
      input,
      current.version,
      key,
    ).expect(201);
    const replay = await post(
      staff,
      `/v1/center/invoices/${saved.id}/notes`,
      input,
      current.version,
      key,
    ).expect(201);
    expect(replay.body.id).toBe(proposed.body.id);
    const issued = await post(
      finance,
      `/v1/internal/financial-notes/${proposed.body.id}/issue`,
      { evidenceReference: 'SYNTHETIC-accountant-evidence' },
      proposed.body.version,
    ).expect(200);
    expect(issued.body.noteNumber).toMatch(/^TC\//);
    expect(issued.body.totalInr).toBe('47.20');
    await post(
      customer,
      `/v1/me/financial-notes/${issued.body.id}/document`,
      {},
    ).expect(200);
    await as(
      customer,
      http().get(`/v1/me/financial-notes/${issued.body.id}/pdf`),
    ).expect(200);
    await as(
      otherCustomer,
      http().get(`/v1/me/financial-notes/${issued.body.id}/pdf`),
    ).expect(404);
    expect(
      (await db.getRepository(Invoice).findOneByOrFail({ id: saved.id }))
        .totalInr,
    ).toBe('118.00');
    expect(await db.getRepository(Payment).count()).toBe(1);
    await post(
      staff,
      `/v1/center/invoices/${saved.id}/notes`,
      {
        ...input,
        lines: [{ sourceLineId: saved.lineItems[0].id, netInr: '60.01' }],
      },
      current.version,
    ).expect(422);
  });
  it('checks a note’s own recipient and center on status, rendering and both download authorizations', async () => {
    const { saved, current } = await paidInvoice();
    const proposed = await post(
      staff,
      `/v1/center/invoices/${saved.id}/notes`,
      {
        kind: 'CREDIT',
        reason: 'Synthetic correction',
        lines: [{ sourceLineId: saved.lineItems[0].id, netInr: '10.00' }],
      },
      current.version,
    ).expect(201);
    const issued = await post(
      finance,
      `/v1/internal/financial-notes/${proposed.body.id}/issue`,
      {
        evidenceReference: 'SYNTHETIC',
      },
      proposed.body.version,
    ).expect(200);
    const id = issued.body.id;
    await post(customer, `/v1/me/financial-notes/${id}/document`, {}).expect(
      200,
    );
    const p = await db
      .getRepository(CustomerProfile)
      .save({ iamUserId: randomUUID() });
    const recipient = await jwt.signAccessToken({
      sub: p.iamUserId,
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      roles: ['customer'],
      permissions: [],
    });
    await db
      .getRepository(FinancialNote)
      .update(id, { customerProfileId: p.id });
    const storage = app.get(PrivateInvoiceStorage);
    const fetch = jest.spyOn(storage, 'get');
    for (const token of [customer, recipient]) {
      await as(
        token,
        http().get(`/v1/me/financial-notes/${id}/document`),
      ).expect(404);
      await post(token, `/v1/me/financial-notes/${id}/document`, {}).expect(
        404,
      );
      await as(token, http().get(`/v1/me/financial-notes/${id}/pdf`)).expect(
        404,
      );
    }
    await as(staff, http().get(`/v1/center/financial-notes/${id}/pdf`)).expect(
      404,
    );
    await post(
      staff,
      `/v1/center/financial-notes/${id}/document/retry`,
      {},
    ).expect(404);
    expect(fetch).not.toHaveBeenCalled();
    const list = await as(
      customer,
      http().get(`/v1/me/invoices/${saved.id}/notes`),
    ).expect(200);
    expect(list.body.notes).toEqual([]);
    const bill = await as(
      customer,
      http().get(`/v1/me/invoices/${saved.id}`),
    ).expect(200);
    expect(bill.body.corrections.issuedCreditInr).toBe('0.00');
    const [otherCenter] = await db.query(
      'SELECT id FROM service_centers WHERE id <> $1 LIMIT 1',
      [centerId],
    );
    await db.getRepository(FinancialNote).update(id, {
      customerProfileId: saved.customerProfileId!,
      serviceCenterId: otherCenter.id,
    });
    await as(customer, http().get(`/v1/me/financial-notes/${id}/pdf`)).expect(
      404,
    );
    await as(staff, http().get(`/v1/center/financial-notes/${id}/pdf`)).expect(
      404,
    );
    await db
      .getRepository(FinancialNote)
      .update(id, { serviceCenterId: centerId });
    fetch.mockRestore();
    const get = storage.get.bind(storage);
    jest.spyOn(storage, 'get').mockImplementationOnce(async (key) => {
      const bytes = await get(key);
      await db
        .getRepository(FinancialNote)
        .update(id, { customerProfileId: p.id });
      return bytes;
    });
    await as(customer, http().get(`/v1/me/financial-notes/${id}/pdf`)).expect(
      404,
    );
  });
  it.each(['recipient', 'center'] as const)(
    'refuses to number a correction with a mismatched %s',
    async (field) => {
      const { saved, current } = await paidInvoice();
      const proposal = await post(
        staff,
        `/v1/center/invoices/${saved.id}/notes`,
        {
          kind: 'CREDIT',
          reason: 'Synthetic correction',
          lines: [{ sourceLineId: saved.lineItems[0].id, netInr: '10.00' }],
        },
        current.version,
      ).expect(201);
      const p = await db
        .getRepository(CustomerProfile)
        .save({ iamUserId: randomUUID() });
      const [otherCenter] = await db.query(
        'SELECT id FROM service_centers WHERE id <> $1 LIMIT 1',
        [centerId],
      );
      await db
        .getRepository(FinancialNote)
        .update(
          proposal.body.id,
          field === 'recipient'
            ? { customerProfileId: p.id }
            : { serviceCenterId: otherCenter.id },
        );
      const series = await db.getRepository(InvoiceSeries).find();
      const result = await post(
        finance,
        `/v1/internal/financial-notes/${proposal.body.id}/issue`,
        {
          evidenceReference: 'SYNTHETIC',
        },
        proposal.body.version,
      ).expect(422);
      expect(result.body.code).toBe('NOTE_SOURCE_MISMATCH');
      expect(await db.getRepository(InvoiceSeries).find()).toEqual(series);
      expect(
        (
          await db
            .getRepository(FinancialNote)
            .findOneByOrFail({ id: proposal.body.id })
        ).noteNumber,
      ).toBeNull();
      expect(
        await db
          .getRepository(InvoiceDocument)
          .countBy({ noteId: proposal.body.id }),
      ).toBe(0);
    },
  );
  it('requires original-recipient debit acceptance and independently reviewed issue before collection', async () => {
    const { saved, current } = await paidInvoice();
    const proposed = await post(
      staff,
      `/v1/center/invoices/${saved.id}/notes`,
      {
        kind: 'DEBIT',
        reason: 'Synthetic approved price correction',
        lines: [{ sourceLineId: saved.lineItems[0].id, netInr: '10.00' }],
      },
      current.version,
    ).expect(201);
    const id = proposed.body.id;
    await post(
      staff,
      `/v1/center/financial-notes/${id}/payment`,
      { method: 'CASH', reference: '', amountInr: '11.80' },
      proposed.body.version,
    ).expect(409);
    await post(
      finance,
      `/v1/internal/financial-notes/${id}/issue`,
      { evidenceReference: 'SYNTHETIC' },
      proposed.body.version,
    ).expect(409);
    await post(
      otherCustomer,
      `/v1/me/financial-notes/${id}/decision`,
      { decision: 'ACCEPT' },
      proposed.body.version,
    ).expect(404);
    const decisionKey = randomUUID();
    const accepted = await post(
      customer,
      `/v1/me/financial-notes/${id}/decision`,
      { decision: 'ACCEPT' },
      proposed.body.version,
      decisionKey,
    ).expect(200);
    await post(
      customer,
      `/v1/me/financial-notes/${id}/decision`,
      { decision: 'ACCEPT' },
      proposed.body.version,
      decisionKey,
    ).expect(200);
    await post(
      staff,
      `/v1/internal/financial-notes/${id}/issue`,
      { evidenceReference: 'SYNTHETIC' },
      accepted.body.version,
    ).expect(403);
    const issued = await post(
      finance,
      `/v1/internal/financial-notes/${id}/issue`,
      { evidenceReference: 'SYNTHETIC' },
      accepted.body.version,
    ).expect(200);
    const beforePayment = await as(
      customer,
      http().get(`/v1/me/invoices/${saved.id}`),
    ).expect(200);
    expect(beforePayment.body.corrections.outstandingDebitInr).toBe('11.80');
    expect(beforePayment.body.balanceInr).toBe('0.00');
    expect(
      await db
        .getRepository(CustomerNotification)
        .countBy({ title: 'Review an additional charge' }),
    ).toBe(1);
    const payKey = randomUUID();
    const payment = {
      method: 'UPI',
      reference: 'SYNTHETIC-NOTE-TXN',
      amountInr: '11.80',
    };
    const mismatch = await db
      .getRepository(CustomerProfile)
      .save({ iamUserId: randomUUID() });
    await db
      .getRepository(FinancialNote)
      .update(id, { customerProfileId: mismatch.id });
    expect(
      (
        await post(
          staff,
          `/v1/center/financial-notes/${id}/payment`,
          payment,
          issued.body.version,
        ).expect(422)
      ).body.code,
    ).toBe('NOTE_SOURCE_MISMATCH');
    expect(await db.getRepository(Payment).countBy({ noteId: id })).toBe(0);
    await db
      .getRepository(FinancialNote)
      .update(id, { customerProfileId: saved.customerProfileId! });
    await post(
      staff,
      `/v1/center/financial-notes/${id}/payment`,
      payment,
      issued.body.version,
      payKey,
    ).expect(200);
    await post(
      staff,
      `/v1/center/financial-notes/${id}/payment`,
      payment,
      issued.body.version,
      payKey,
    ).expect(200);
    expect(await db.getRepository(Payment).countBy({ noteId: id })).toBe(1);
    const afterPayment = await as(
      customer,
      http().get(`/v1/me/invoices/${saved.id}`),
    ).expect(200);
    expect(afterPayment.body.corrections.outstandingDebitInr).toBe('0.00');
    expect(
      await db
        .getRepository(CustomerNotification)
        .countBy({ title: 'Correction payment recorded' }),
    ).toBe(1);
    expect(
      (await db.getRepository(Invoice).findOneByOrFail({ id: saved.id }))
        .paidInr,
    ).toBe('118.00');
  });
  it('serializes concurrent credit issuance and refuses over-credit without consuming a number', async () => {
    const { saved, current } = await paidInvoice();
    const input = {
      kind: 'CREDIT',
      reason: 'Synthetic concurrent credit',
      lines: [{ sourceLineId: saved.lineItems[0].id, netInr: '60.00' }],
    };
    const a = await post(
      staff,
      `/v1/center/invoices/${saved.id}/notes`,
      input,
      current.version,
    ).expect(201);
    const b = await post(
      staff,
      `/v1/center/invoices/${saved.id}/notes`,
      input,
      current.version,
    ).expect(201);
    const results = await Promise.all(
      [a, b].map((n) =>
        post(
          finance,
          `/v1/internal/financial-notes/${n.body.id}/issue`,
          { evidenceReference: 'SYNTHETIC' },
          n.body.version,
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(
      await db.getRepository(FinancialNote).countBy({ state: 'ISSUED' }),
    ).toBe(1);
  });
  it('serializes invoice cancellation against collection', async () => {
    const { job, invoice } = await readyInvoice();
    const v = await db
      .getRepository(ServiceJob)
      .findOneByOrFail({ id: job.id });
    const results = await Promise.all([
      post(
        staff,
        `/v1/jobs/${job.id}/close`,
        { invoiceId: invoice.id, payment: { method: 'CASH', amountInr: 118 } },
        v.version,
      ),
      post(
        staff,
        `/v1/center/invoices/${invoice.id}/cancel`,
        { reason: 'Synthetic concurrent cancellation' },
        v.version,
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const paid =
      (await db.getRepository(Invoice).findOneByOrFail({ id: invoice.id }))
        .status === InvoiceStatus.PAID;
    expect(await db.getRepository(Payment).count()).toBe(paid ? 1 : 0);
  });
  it('allows only one current render lease and keeps sealed bytes after payment and cancellation', async () => {
    const { invoice } = await readyInvoice();
    const docs = app.get(InvoiceDocumentService);
    const storage = app.get(PrivateInvoiceStorage);
    const put = jest.spyOn(storage, 'put');
    await Promise.all([docs.render(invoice.id), docs.render(invoice.id)]);
    expect(put).toHaveBeenCalledTimes(1);
    const beforePdf = await as(
      customer,
      http().get(`/v1/me/invoices/${invoice.id}/pdf`),
    ).expect(200);
    const job = await db
      .getRepository(ServiceJob)
      .findOneByOrFail({ id: invoice.jobId });
    await post(
      staff,
      `/v1/center/invoices/${invoice.id}/cancel`,
      { reason: 'Synthetic retained original' },
      job.version,
    ).expect(200);
    const afterPdf = await as(
      customer,
      http().get(`/v1/me/invoices/${invoice.id}/pdf`),
    ).expect(200);
    expect(afterPdf.body.equals(beforePdf.body)).toBe(true);
  });
  it('recovers a saved consent after verification evidence expires, but denies a deleted profile', async () => {
    const s = await start();
    const body = {
      challenge: challenge(s),
      name: 'Synthetic Customer',
      consent: true,
      verificationAssertion: await proof(s.id),
    };
    const key = randomUUID();
    await post(
      customer,
      `/v1/me/reception-sessions/${s.id}/consent`,
      body,
      s.version,
      key,
    ).expect(200);
    jest
      .spyOn(app.get(ReceptionIdentityService), 'verify')
      .mockRejectedValue(
        new UnprocessableEntityException('Expired synthetic assertion'),
      );
    await post(
      customer,
      `/v1/me/reception-sessions/${s.id}/consent`,
      body,
      s.version,
      key,
    ).expect(200);
    const profile = await db
      .getRepository(CustomerProfile)
      .findOneByOrFail({ iamUserId: subject });
    await db.getRepository(CustomerProfile).softDelete(profile.id);
    const result = await post(
      customer,
      `/v1/me/reception-sessions/${s.id}/consent`,
      body,
      s.version,
      key,
    );
    expect([403, 404, 410]).toContain(result.status);
  });
  it('rolls back note numbering, document intent and issue when audit persistence fails', async () => {
    const { saved, current } = await paidInvoice();
    const proposed = await post(
      staff,
      `/v1/center/invoices/${saved.id}/notes`,
      {
        kind: 'CREDIT',
        reason: 'Synthetic audit rollback',
        lines: [{ sourceLineId: saved.lineItems[0].id, netInr: '10.00' }],
      },
      current.version,
    ).expect(201);
    await db.query(
      `CREATE FUNCTION fail_note_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='FINANCIAL_NOTE_ISSUED' THEN RAISE EXCEPTION 'synthetic audit fault'; END IF; RETURN NEW; END $$`,
    );
    await db.query(
      'CREATE TRIGGER fail_note_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_note_audit()',
    );
    try {
      await post(
        finance,
        `/v1/internal/financial-notes/${proposed.body.id}/issue`,
        { evidenceReference: 'SYNTHETIC' },
        proposed.body.version,
      ).expect(500);
      expect(
        (
          await db
            .getRepository(FinancialNote)
            .findOneByOrFail({ id: proposed.body.id })
        ).state,
      ).toBe('PROPOSED');
      expect(
        await db
          .getRepository(InvoiceDocument)
          .countBy({ noteId: proposed.body.id }),
      ).toBe(0);
      expect(
        await db.getRepository(InvoiceSeries).countBy({ seriesPrefix: 'TC' }),
      ).toBe(0);
    } finally {
      await db.query('DROP TRIGGER fail_note_audit ON audit_logs');
      await db.query('DROP FUNCTION fail_note_audit()');
    }
  });
  it('recovers an expired render lease and lets authorized staff restart exhausted processing', async () => {
    const { invoice } = await readyInvoice();
    await db.getRepository(InvoiceDocument).update(
      { invoiceId: invoice.id },
      {
        state: 'RENDERING',
        leaseToken: randomUUID(),
        leaseUntil: new Date(0),
        attempts: 3,
      },
    );
    await app.get(InvoiceDocumentService).render(invoice.id);
    let row = await db
      .getRepository(InvoiceDocument)
      .findOneByOrFail({ invoiceId: invoice.id });
    expect(row.state).toBe('READY');
    expect(row.attempts).toBe(4);
    await db.getRepository(InvoiceDocument).update(row.id, {
      state: 'FAILED',
      attempts: 10,
      retryAt: new Date(0),
      storageKey: null,
      sha256: null,
    });
    await post(customer, `/v1/me/invoices/${invoice.id}/document`, {}).expect(
      200,
    );
    row = await db
      .getRepository(InvoiceDocument)
      .findOneByOrFail({ id: row.id });
    expect(row.state).toBe('FAILED');
    await post(
      limited,
      `/v1/center/invoices/${invoice.id}/document/retry`,
      {},
    ).expect(403);
    await post(
      staff,
      `/v1/center/invoices/${invoice.id}/document/retry`,
      {},
    ).expect(200);
    row = await db
      .getRepository(InvoiceDocument)
      .findOneByOrFail({ id: row.id });
    expect(row.state).toBe('READY');
    expect(row.attempts).toBe(1);
  });
  it('blocks unapproved discounts and missing cancellation/correction policies on the server', async () => {
    const { job, line, invoice, selection } = await readyInvoice();
    const c = await db
      .getRepository(BillingConfiguration)
      .findOneByOrFail({ serviceCenterId: centerId });
    const next = { ...c.policy };
    delete next.discounts;
    delete next.cancellation;
    delete next.corrections;
    await db.getRepository(BillingConfiguration).update(c.id, { policy: next });
    await post(staff, `/v1/jobs/${job.id}/invoice-preview`, {
      ...selection,
      lineRules: [
        {
          lineItemId: line.id,
          ruleKey: 'labour',
          discountInr: '1.00',
          discountReason: 'Synthetic discount',
        },
      ],
    }).expect(422);
    const current = await db
      .getRepository(ServiceJob)
      .findOneByOrFail({ id: job.id });
    await post(
      staff,
      `/v1/center/invoices/${invoice.id}/cancel`,
      { reason: 'Synthetic cancellation' },
      current.version,
    ).expect(422);
  });
});
