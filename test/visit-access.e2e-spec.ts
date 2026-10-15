import { randomUUID } from 'crypto';
import { inspectVisitAccess } from '../src/scripts/visit-access-preflight';
import { Server } from 'http';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ENTITIES } from '../src/database/entities';
import { MIGRATIONS } from '../src/database/migration-list';
import { VisitCustomerAccess1730000000013 } from '../src/database/migrations/1730000000013-VisitCustomerAccess';
import { Customer } from '../src/modules/customers/entities/customer.entity';
import { CustomerProfile } from '../src/modules/customers/entities/customer-profile.entity';
import { Vehicle } from '../src/modules/customers/entities/vehicle.entity';
import { JobCustomerAccess } from '../src/modules/jobs/entities/job-customer-access.entity';
import { ServiceJob } from '../src/modules/jobs/entities/service-job.entity';
import { JobApproval } from '../src/modules/jobs/entities/job-approval.entity';
import { JobLineItem } from '../src/modules/jobs/entities/job-line-item.entity';
import { JobStatus } from '../src/common/enums/job-status.enum';
import { JobLineStatus } from '../src/common/enums/job-work.enum';
import { JobEstimateService } from '../src/modules/jobs/job-estimate.service';
import { CommandIdempotency } from '../src/modules/idempotency/command-idempotency.entity';
import { CustomerNotification } from '../src/modules/notifications/entities/customer-notification.entity';
import { NotificationDelivery } from '../src/modules/notifications/entities/notification-delivery.entity';
import { createJwtTestFixture } from '../src/test-utils/jwt-test.helper';
import { createApiApp, createE2eApp } from './helpers/e2e-app.helper';
import { seedReturningWalkIn } from './helpers/returning-walk-in.helper';
import {
  seedTestTenancy,
  TEST_IAM_USER_ID,
  TEST_DOMAIN_ID,
  TEST_CUSTOMER_APP_ID,
  TEST_CUSTOMER_DOMAIN_ID,
  TEST_CUSTOMER_IAM_USER_ID,
} from './helpers/test-db.helper';

const postgres = process.env.AF006_ACCESS_POSTGRES_TEST === 'true';
const pgIt = postgres ? it : it.skip;
const otherUser = '88888888-8888-4888-8888-888888888888';
describe(`Visit access (${postgres ? 'PostgreSQL' : 'memory'})`, () => {
  let db: DataSource;
  let app: INestApplication;
  let reset: () => void;
  let staff: string;
  let owner: string;
  let stranger: string;
  let centerId: string;
  let profile: CustomerProfile;
  let other: CustomerProfile;
  let intake: Awaited<ReturnType<typeof seedReturningWalkIn>>;
  const http = () => request(app.getHttpServer() as Server);
  const as = (token: string, test: request.Test) =>
    test.set('Authorization', `Bearer ${token}`);
  const body = () => ({
    ...intake.selection,
    serviceType: 'Periodic service',
    customerRequest: 'Check brakes',
  });
  const create = (key = randomUUID()) =>
    as(staff, http().post('/v1/jobs')).set('Idempotency-Key', key).send(body());
  const get = (id: string, token = owner) =>
    as(token, http().get(`/v1/me/jobs/${id}`));
  const grant = (id: string) =>
    db
      .getRepository(JobCustomerAccess)
      .findOneByOrFail({ jobId: id, customerProfileId: profile.id });
  const decide = (
    jobId: string,
    approvalId: string,
    key = randomUUID(),
    token = owner,
    data: object = { approved: true },
  ) =>
    as(
      token,
      http().post(`/v1/me/jobs/${jobId}/approvals/${approvalId}/decision`),
    )
      .set('Idempotency-Key', key)
      .send(data);
  const support = (jobId: string, token = owner) =>
    as(token, http().post('/v1/me/support-requests'))
      .set('Idempotency-Key', randomUUID())
      .send({
        jobId,
        category: 'SERVICE',
        subject: 'Visit assistance',
        message: 'Please help with this visit.',
      });
  async function pending() {
    const job = (await create().expect(201)).body as { id: string };
    await db
      .getRepository(ServiceJob)
      .update(job.id, { status: JobStatus.INSPECTION });
    const response = await as(
      staff,
      http().post(`/v1/jobs/${job.id}/approvals`),
    )
      .send({
        items: [
          {
            kind: 'LABOUR',
            description: 'Brake inspection',
            quantity: 1,
            unitPriceInr: 500,
          },
          {
            kind: 'LABOUR',
            description: 'Oil change',
            quantity: 1,
            unitPriceInr: 400,
          },
        ],
      })
      .expect(201);
    return {
      id: job.id,
      approvalId: response.body.pendingApprovalId as string,
    };
  }
  async function fixtures() {
    centerId = (await seedTestTenancy(db)).serviceCenter.id;
    profile = await db.getRepository(CustomerProfile).save({
      iamUserId: TEST_CUSTOMER_IAM_USER_ID,
      displayName: 'Original visitor',
      phone: '+919876543210',
    });
    other = await db.getRepository(CustomerProfile).save({
      iamUserId: otherUser,
      displayName: 'Another visitor',
      phone: '+919123456780',
    });
    intake = await seedReturningWalkIn(db, centerId, {
      profileId: profile.id,
      name: 'Original visitor',
    });
  }
  beforeAll(async () => {
    process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID = TEST_CUSTOMER_APP_ID;
    const jwt = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = jwt.jwksJson;
    staff = await jwt.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['manager'],
      permissions: [
        'jobs:create',
        'jobs:read',
        'jobs:update',
        'billing:manage',
      ],
    });
    const claims = {
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      roles: ['customer'],
      permissions: [],
    };
    owner = await jwt.signAccessToken({
      ...claims,
      sub: TEST_CUSTOMER_IAM_USER_ID,
    });
    stranger = await jwt.signAccessToken({ ...claims, sub: otherUser });
    if (postgres) {
      db = new DataSource({
        type: 'postgres',
        host: '127.0.0.1',
        port: 55416,
        username: 'af006_access_test',
        password: 'af006_access_test',
        database: 'af006_access_test',
        entities: ENTITIES,
        migrations: MIGRATIONS,
        synchronize: false,
      });
      await db.initialize();
      const [identity] = await db.query('SELECT current_database() AS name');
      if (identity.name !== 'af006_access_test')
        throw new Error('Refusing to reset a non-disposable database');
      await db.query('DROP SCHEMA public CASCADE');
      await db.query('CREATE SCHEMA public');
      await db.runMigrations();
      app = await createApiApp(db);
    } else {
      const ctx = await createE2eApp();
      db = ctx.dataSource;
      app = ctx.app;
      await fixtures();
      const backup = ctx.memoryDb.backup();
      reset = () => backup.restore();
    }
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    if (postgres) {
      await db.query(
        'TRUNCATE service_centers, customer_profiles, command_idempotency CASCADE',
      );
      await fixtures();
    } else reset();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
  });

  it('creates one grant and snapshot atomically with a recoverable walk-in', async () => {
    const key = randomUUID();
    const job = (await create(key).expect(201)).body as { id: string };
    expect((await create(key).expect(201)).body).toEqual(job);
    expect(
      await db.getRepository(JobCustomerAccess).countBy({ jobId: job.id }),
    ).toBe(1);
    expect(await grant(job.id)).toMatchObject({
      source: 'WALK_IN',
      canView: true,
      canDecide: true,
    });
    const saved = await db
      .getRepository(ServiceJob)
      .findOneByOrFail({ id: job.id });
    expect(saved.billingCustomerProfileId).toBe(profile.id);
    expect(saved.intakeSnapshot).toMatchObject({
      customerName: 'Original visitor',
      vehicleRegistration: 'KA01AB1234',
    });
    await get(job.id).expect(200);
    await get(job.id, stranger).expect(404);
  });

  it('contact and vehicle relinking cannot transfer old history or future invoice responsibility', async () => {
    const id = (await create().expect(201)).body.id as string;
    await db.getRepository(Customer).update(intake.customer.id, {
      customerProfileId: other.id,
      name: 'Replacement name',
      phone: '+919123456780',
    });
    await db.getRepository(Vehicle).update(intake.vehicle.id, {
      registrationNumber: 'MH01ZZ9999',
      makeModel: 'Replacement vehicle',
    });
    expect((await get(id).expect(200)).body.vehicle).toMatchObject({
      registrationNumber: 'KA01AB1234',
      makeModel: 'Honda Activa',
    });
    expect(
      (await as(owner, http().get('/v1/me/jobs')).expect(200)).body.map(
        (j: { id: string }) => j.id,
      ),
    ).toContain(id);
    expect(
      (await as(stranger, http().get('/v1/me/jobs')).expect(200)).body,
    ).toEqual([]);
    await get(id, stranger).expect(404);
    await support(id).expect(201);
    await support(id, stranger).expect(422);
    await db
      .getRepository(ServiceJob)
      .update(id, { status: JobStatus.READY_FOR_PICKUP });
    const invoice = await as(staff, http().post(`/v1/jobs/${id}/invoice`))
      .send({})
      .expect(201);
    expect(invoice.body.buyer).toMatchObject({
      name: 'Original visitor',
      phone: '+919876543210',
      vehicleRegistration: 'KA01AB1234',
    });
    const invoiceId = invoice.body.id as string;
    await as(owner, http().get(`/v1/me/invoices/${invoiceId}`)).expect(200);
    await as(stranger, http().get(`/v1/me/invoices/${invoiceId}`)).expect(404);
    await db.getRepository(JobCustomerAccess).insert({
      jobId: id,
      customerProfileId: other.id,
      source: 'WALK_IN',
      customerRevision: 1,
      canView: true,
      canDecide: false,
    });
    expect((await get(id, stranger).expect(200)).body.invoice).toBeNull();
  });

  it('a phone match and a later link never create access to an ungranted legacy visit', async () => {
    const job = await db.getRepository(ServiceJob).save({
      serviceCenterId: centerId,
      customerId: intake.customer.id,
      vehicleId: intake.vehicle.id,
      serviceType: 'Legacy visit',
      publicToken: randomUUID(),
    });
    await db
      .getRepository(CustomerProfile)
      .update(other.id, { phone: profile.phone });
    await get(job.id).expect(404);
    await get(job.id, stranger).expect(404);
    await db
      .getRepository(Customer)
      .update(intake.customer.id, { customerProfileId: other.id });
    await get(job.id, stranger).expect(404);
    await support(job.id, stranger).expect(422);
    await db
      .getRepository(ServiceJob)
      .update(job.id, { status: JobStatus.READY_FOR_PICKUP });
    const bill = await as(staff, http().post(`/v1/jobs/${job.id}/invoice`))
      .send({})
      .expect(422);
    expect(bill.body.code).toBe('VISIT_BILLING_IDENTITY_REQUIRED');
  });

  it('returns an accepted decision even if access is revoked immediately after commit', async () => {
    const job = await pending();
    const service = app.get(JobEstimateService);
    const original = service.decideAsCustomer.bind(service);
    jest
      .spyOn(service, 'decideAsCustomer')
      .mockImplementationOnce(async (...args) => {
        const result = await original(...args);
        await db
          .getRepository(JobCustomerAccess)
          .update({ jobId: job.id }, { revokedAt: new Date() });
        return result;
      });
    const response = await decide(job.id, job.approvalId).expect(200);
    expect(response.body.pendingApprovalId).toBeNull();
    await get(job.id).expect(404);
  });

  it('view-only access cannot decide and a revoked grant cannot read or link support', async () => {
    const job = await pending();
    await db
      .getRepository(JobCustomerAccess)
      .update({ jobId: job.id }, { canDecide: false });
    await get(job.id).expect(200);
    await decide(job.id, job.approvalId).expect(404);
    await db
      .getRepository(JobCustomerAccess)
      .update({ jobId: job.id }, { revokedAt: new Date() });
    await get(job.id).expect(404);
    await support(job.id).expect(422);
    expect(
      (await as(owner, http().get('/v1/me/jobs')).expect(200)).body,
    ).toEqual([]);
  });

  it('reauthorizes decisions after the initial read and does not trust the contact link', async () => {
    const job = await pending();
    const service = app.get(JobEstimateService);
    const original = service.decideAsCustomer.bind(service);
    jest
      .spyOn(service, 'decideAsCustomer')
      .mockImplementationOnce(async (...args) => {
        await db
          .getRepository(JobCustomerAccess)
          .update({ jobId: job.id }, { revokedAt: new Date() });
        return original(...args);
      });
    await decide(job.id, job.approvalId).expect(404);
    expect(
      (
        await db
          .getRepository(JobApproval)
          .findOneByOrFail({ id: job.approvalId })
      ).status,
    ).toBe('PENDING');
  });

  it('replays partial approval without a second decision and rejects altered or revoked retries', async () => {
    const job = await pending();
    const lines = await db.getRepository(JobLineItem).findBy({ jobId: job.id });
    const input = {
      decisions: lines.map((line, i) => ({
        lineItemId: line.id,
        approved: i === 0,
      })),
    };
    const key = randomUUID();
    await decide(job.id, job.approvalId, key, owner, input).expect(200);
    await decide(job.id, job.approvalId, key, owner, input).expect(200);
    expect(
      (
        await db
          .getRepository(JobApproval)
          .findOneByOrFail({ id: job.approvalId })
      ).status,
    ).toBe('PARTIALLY_APPROVED');
    const receipt = await db.getRepository(CommandIdempotency).findOneByOrFail({
      scope: `customer:${TEST_CUSTOMER_IAM_USER_ID}`,
      idempotencyKey: key,
    });
    expect(receipt.responseBody).toEqual({
      id: job.id,
      approvalId: job.approvalId,
    });
    await decide(job.id, job.approvalId, key, owner, {
      approved: false,
    }).expect(422);
    await db
      .getRepository(JobCustomerAccess)
      .update({ jobId: job.id }, { revokedAt: new Date() });
    await decide(job.id, job.approvalId, key, owner, input).expect(404);
  });

  it('attributes decisions and new notifications to the original visitor after contact relinking', async () => {
    const job = await pending();
    await db
      .getRepository(Customer)
      .update(intake.customer.id, { customerProfileId: other.id });
    await decide(job.id, job.approvalId).expect(200);
    const approval = await db
      .getRepository(JobApproval)
      .findOneByOrFail({ id: job.approvalId });
    expect(approval.decidedByCustomerProfileId).toBe(profile.id);
    expect(
      await db
        .getRepository(CustomerNotification)
        .countBy({ jobId: job.id, customerProfileId: other.id }),
    ).toBe(0);
    expect(
      await db
        .getRepository(CustomerNotification)
        .countBy({ jobId: job.id, customerProfileId: profile.id }),
    ).toBeGreaterThan(0);
  });

  it('keeps an in-app notice but creates no outbound delivery when the current profile phone is empty', async () => {
    const job = await pending();
    const beforeInbox = await db
      .getRepository(CustomerNotification)
      .countBy({ jobId: job.id });
    const beforeOutbound = await db
      .getRepository(NotificationDelivery)
      .countBy({ jobId: job.id });
    await db.getRepository(CustomerProfile).update(profile.id, { phone: null });
    await decide(job.id, job.approvalId).expect(200);
    expect(
      await db.getRepository(CustomerNotification).countBy({ jobId: job.id }),
    ).toBeGreaterThan(beforeInbox);
    expect(
      await db.getRepository(NotificationDelivery).countBy({ jobId: job.id }),
    ).toBe(beforeOutbound);
    expect(
      (await db.getRepository(ServiceJob).findOneByOrFail({ id: job.id }))
        .intakeSnapshot?.customerPhone,
    ).toBe('+919876543210');
  });

  it('deleted accounts are refused without recreating or resurrecting the identity', async () => {
    const id = (await create().expect(201)).body.id as string;
    await db.getRepository(CustomerProfile).softDelete(profile.id);
    await get(id).expect(403);
    await as(owner, http().put('/v1/me/profile'))
      .send({ displayName: 'Revive me' })
      .expect(403);
    expect(
      await db.getRepository(CustomerProfile).count({
        withDeleted: true,
        where: { iamUserId: TEST_CUSTOMER_IAM_USER_ID },
      }),
    ).toBe(1);
    expect(
      (
        await db
          .getRepository(CustomerProfile)
          .findOne({ withDeleted: true, where: { id: profile.id } })
      )?.deletedAt,
    ).not.toBeNull();
  });

  it('deleted visits remain unavailable even when a grant survives', async () => {
    const id = (await create().expect(201)).body.id as string;
    await db.getRepository(ServiceJob).softDelete(id);
    await get(id).expect(404);
    await support(id).expect(422);
  });

  pgIt(
    'backfills only prior linked principals and retains grants when contacts later change',
    async () => {
      const migration = new VisitCustomerAccess1730000000013();
      const runner = db.createQueryRunner();
      await runner.connect();
      try {
        await migration.down(runner);
        const seed = async (
          customerId: string,
          vehicleId = intake.vehicle.id,
        ) => {
          const [row] = await runner.query(
            `INSERT INTO service_jobs (service_center_id, customer_id, vehicle_id, vehicle_type, service_type, public_token) VALUES ($1,$2,$3,'TWO_WHEELER','Legacy',$4) RETURNING id`,
            [centerId, customerId, vehicleId, randomUUID()],
          );
          return row.id as string;
        };
        const linked = await seed(intake.customer.id);
        const unlinked = await db.getRepository(Customer).save({
          serviceCenterId: centerId,
          phone: '+919555555555',
          customerProfileId: null,
        });
        const hidden = await seed(unlinked.id);
        const wrongCustomer = await db.getRepository(Customer).save({
          serviceCenterId: centerId,
          phone: '+919555555556',
          customerProfileId: other.id,
        });
        const wrongVehicle = await db.getRepository(Vehicle).save({
          serviceCenterId: centerId,
          customerId: wrongCustomer.id,
          registrationNumber: 'KA02AB4321',
        });
        const mismatched = await seed(intake.customer.id, wrongVehicle.id);
        expect(await inspectVisitAccess(db)).toMatchObject({
          visitAccessMigrationApplied: false,
          legacy: {
            liveJobs: 3,
            currentlyLinkedJobs: 2,
            safeBackfillJobs: 1,
            unlinkedJobs: 1,
            associationMismatches: 2,
          },
          migrated: null,
        });
        await migration.up(runner);
        expect((await grant(linked)).source).toBe('LEGACY_CONTACT_LINK');
        expect(
          await db
            .getRepository(JobCustomerAccess)
            .countBy({ jobId: mismatched }),
        ).toBe(0);
        expect(
          await db.getRepository(JobCustomerAccess).countBy({ jobId: hidden }),
        ).toBe(0);
        await db
          .getRepository(Customer)
          .update(unlinked.id, { customerProfileId: other.id });
        await get(hidden, stranger).expect(404);
        await get(mismatched).expect(404);
        await get(linked).expect(200);
        expect(await inspectVisitAccess(db)).toMatchObject({
          visitAccessMigrationApplied: true,
          migrated: {
            jobsWithoutActiveAccess: 2,
            jobsWithoutBillingRecipient: 2,
            jobsWithoutSnapshot: 2,
          },
        });
      } finally {
        await runner.release();
      }
    },
  );

  pgIt(
    'concurrent first use creates one local profile for the authenticated IAM subject',
    async () => {
      await db.getRepository(CustomerProfile).delete(other.id);
      const responses = await Promise.all([
        as(stranger, http().put('/v1/me/profile')).send({
          displayName: 'First use',
        }),
        as(stranger, http().put('/v1/me/profile')).send({
          displayName: 'First use',
        }),
      ]);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      expect(responses[0].body.id).toBe(responses[1].body.id);
      expect(
        await db
          .getRepository(CustomerProfile)
          .countBy({ iamUserId: otherUser }),
      ).toBe(1);
    },
  );

  pgIt(
    'a concurrent account deletion prevents a waiting profile edit',
    async () => {
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      let response: Promise<request.Response> | undefined;
      try {
        await runner.query(
          'SELECT id FROM customer_profiles WHERE id=$1 FOR UPDATE',
          [profile.id],
        );
        response = as(owner, http().put('/v1/me/profile'))
          .send({ displayName: 'Changed name' })
          .then((r) => r);
        let waiting = false;
        for (let i = 0; i < 100 && !waiting; i++) {
          const rows = await db.query(
            `SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%UPDATE%customer_profiles%'`,
          );
          waiting = rows.length > 0;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBe(true);
        await runner.query(
          'UPDATE customer_profiles SET deleted_at=now() WHERE id=$1',
          [profile.id],
        );
        await runner.commitTransaction();
        expect((await response).status).toBe(403);
        expect(
          (
            await db
              .getRepository(CustomerProfile)
              .findOneOrFail({ where: { id: profile.id }, withDeleted: true })
          ).displayName,
        ).toBe('Original visitor');
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await response;
        await runner.release();
      }
    },
  );

  pgIt(
    'a concurrent revocation wins before a waiting approval can commit',
    async () => {
      const job = await pending();
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      let response: Promise<request.Response> | undefined;
      try {
        await runner.query(
          'SELECT id FROM job_customer_access WHERE job_id=$1 FOR UPDATE',
          [job.id],
        );
        response = decide(job.id, job.approvalId).then((r) => r);
        let waiting = false;
        for (let i = 0; i < 100 && !waiting; i++) {
          const rows = await db.query(
            `SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%job_customer_access%'`,
          );
          waiting = rows.length > 0;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(waiting).toBe(true);
        await runner.query(
          'UPDATE job_customer_access SET revoked_at=now(), version=version+1 WHERE job_id=$1',
          [job.id],
        );
        await runner.commitTransaction();
        expect((await response).status).toBe(404);
        expect(
          (
            await db
              .getRepository(JobApproval)
              .findOneByOrFail({ id: job.approvalId })
          ).status,
        ).toBe('PENDING');
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await response;
        await runner.release();
      }
    },
  );

  pgIt(
    'a grant write failure rolls back the entire visit and its receipt',
    async () => {
      await db.query(
        `CREATE FUNCTION af006_access_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'deliberate access failure'; END $$`,
      );
      await db.query(
        'CREATE TRIGGER af006_access_fail BEFORE INSERT ON job_customer_access FOR EACH ROW EXECUTE FUNCTION af006_access_fail()',
      );
      const key = randomUUID();
      try {
        await create(key).expect(500);
        expect(await db.getRepository(ServiceJob).count()).toBe(0);
        expect(
          await db
            .getRepository(CommandIdempotency)
            .countBy({ idempotencyKey: key }),
        ).toBe(0);
      } finally {
        await db.query('DROP TRIGGER af006_access_fail ON job_customer_access');
        await db.query('DROP FUNCTION af006_access_fail()');
      }
      await create(key).expect(201);
    },
  );

  pgIt(
    'an approval receipt failure rolls back lines, decision, events and notifications',
    async () => {
      const job = await pending();
      const key = randomUUID();
      const before = await db
        .getRepository(CustomerNotification)
        .countBy({ jobId: job.id });
      await db.query(
        `CREATE FUNCTION af006_access_receipt_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'deliberate receipt failure'; END $$`,
      );
      await db.query(
        'CREATE TRIGGER af006_access_receipt_fail BEFORE UPDATE ON command_idempotency FOR EACH ROW EXECUTE FUNCTION af006_access_receipt_fail()',
      );
      try {
        await decide(job.id, job.approvalId, key).expect(500);
        expect(
          (
            await db
              .getRepository(JobApproval)
              .findOneByOrFail({ id: job.approvalId })
          ).status,
        ).toBe('PENDING');
        expect(
          (await db.getRepository(JobLineItem).findBy({ jobId: job.id })).every(
            (line) => line.status === JobLineStatus.PENDING,
          ),
        ).toBe(true);
        expect(
          await db
            .getRepository(CustomerNotification)
            .countBy({ jobId: job.id }),
        ).toBe(before);
        expect(
          await db
            .getRepository(CommandIdempotency)
            .countBy({ idempotencyKey: key }),
        ).toBe(0);
      } finally {
        await db.query(
          'DROP TRIGGER af006_access_receipt_fail ON command_idempotency',
        );
        await db.query('DROP FUNCTION af006_access_receipt_fail()');
      }
      await decide(job.id, job.approvalId, key).expect(200);
    },
  );
});
