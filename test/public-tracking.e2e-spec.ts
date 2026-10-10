import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { JobStatus } from '../src/common/enums/job-status.enum';
import { JobEventType } from '../src/common/enums/job-event-type.enum';
import { ServiceJob } from '../src/modules/jobs/entities/service-job.entity';
import { ServiceJobEvent } from '../src/modules/events/entities/service-job-event.entity';
import { ServiceCenter } from '../src/modules/tenancy/entities/service-center.entity';
import { Vehicle } from '../src/modules/customers/entities/vehicle.entity';
import { CustomerJobsService } from '../src/modules/jobs/customer-jobs.service';
import { createJwtTestFixture } from '../src/test-utils/jwt-test.helper';
import { createE2eApp } from './helpers/e2e-app.helper';
import {
  seedTestTenancy,
  TEST_DOMAIN_ID,
  TEST_IAM_USER_ID,
} from './helpers/test-db.helper';

describe('Public job timeline (e2e)', () => {
  let app: INestApplication<App>, db: DataSource, job: ServiceJob;
  let reset: () => void;
  const http = () => request(app.getHttpServer());
  const read = () => http().get(`/v1/track/${job.publicToken}`);
  beforeAll(async () => {
    const jwt = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = jwt.jwksJson;
    const context = await createE2eApp();
    app = context.app;
    db = context.dataSource;
    const { serviceCenter } = await seedTestTenancy(db);
    await db
      .getRepository(ServiceCenter)
      .update(serviceCenter.id, { publicPhone: '+91 80 2345 6789' });
    const token = await jwt.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['manager'],
      permissions: ['jobs:create'],
    });
    const created = await http()
      .post('/v1/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerPhone: '+919876543210',
        customerName: 'Private customer name',
        vehicleRegistration: 'KA01AB1234',
        serviceType: 'Periodic service',
        odometerKm: 12345,
        customerRequest: 'Private request body',
      })
      .expect(201);
    job = await db
      .getRepository(ServiceJob)
      .findOneByOrFail({ id: created.body.id });
    const backup = context.memoryDb.backup();
    reset = () => backup.restore();
  });
  beforeEach(() => reset());
  afterAll(async () => {
    await app?.close();
  });

  it('is anonymous, ignores an invalid JWT, has an exact projection and forbids caching', async () => {
    const result = await read()
      .set('Authorization', 'Bearer expired.invalid.token')
      .expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    expect(Object.keys(result.body as Record<string, unknown>).sort()).toEqual(
      [
        'jobNumber',
        'status',
        'serviceType',
        'estimatedReadyAt',
        'centerName',
        'centerPhone',
        'vehicleRegistration',
        'awaitingApproval',
        'progress',
        'updatedAt',
      ].sort(),
    );
    expect(result.body).toMatchObject({
      centerName: 'Test Motors',
      centerPhone: '+918023456789',
      vehicleRegistration: 'KA01••1234',
      status: 'CHECKED_IN',
      awaitingApproval: false,
    });
    for (const event of result.body.progress)
      expect(Object.keys(event as Record<string, unknown>).sort()).toEqual([
        'at',
        'status',
      ]);
    for (const secret of [
      job.id,
      job.publicToken,
      '9876543210',
      'Private customer',
      'Private request',
      '12345',
    ]) {
      expect(JSON.stringify(result.body)).not.toContain(secret);
    }
  });

  it('reads without writing profiles, events, jobs, inbox entries or receipts', async () => {
    const tables = [
      'customer_profiles',
      'service_jobs',
      'service_job_events',
      'customer_notifications',
      'notification_deliveries',
      'command_idempotency',
    ];
    const counts = () =>
      Promise.all(
        tables.map((table) =>
          db.query(`SELECT count(*) AS count FROM ${table}`),
        ),
      );
    const before = await counts();
    const snapshot = await db
      .getRepository(ServiceJob)
      .findOneByOrFail({ id: job.id });
    await read().expect(200);
    await read().expect(200);
    expect(await counts()).toEqual(before);
    expect(
      await db.getRepository(ServiceJob).findOneByOrFail({ id: job.id }),
    ).toEqual(snapshot);
  });

  it.each(Object.values(JobStatus))(
    'reads %s, including terminal states without invalidation',
    async (status) => {
      await db.getRepository(ServiceJob).update(job.id, { status });
      const result = await read().expect(200);
      expect(result.body.status).toBe(status);
      expect(result.body.awaitingApproval).toBe(
        status === JobStatus.AWAITING_APPROVAL,
      );
    },
  );

  it('exposes only visible status events and retains rework, repeats, and deterministic ties', async () => {
    const repo = db.getRepository(ServiceJobEvent);
    await repo.delete({ jobId: job.id });
    const add = async (
      type: JobEventType,
      status: JobStatus | null,
      visible: boolean,
      serial: number,
    ) =>
      repo.save(
        repo.create({
          id: `10000000-0000-4000-8000-${String(serial).padStart(12, '0')}`,
          jobId: job.id,
          serviceCenterId: job.serviceCenterId,
          type,
          toStatus: status,
          visibleToCustomer: visible,
          payload: { note: 'Private event text', amount: 88888 },
          createdAt: new Date('2026-10-09T04:00:00Z'),
        }),
      );
    await add(JobEventType.STATUS_CHANGE, JobStatus.IN_PROGRESS, true, 4);
    await add(JobEventType.STATUS_CHANGE, JobStatus.QUALITY_CHECK, true, 3);
    await add(JobEventType.STATUS_CHANGE, JobStatus.IN_PROGRESS, true, 1);
    await add(JobEventType.STATUS_CHANGE, JobStatus.ON_HOLD, true, 2);
    await add(JobEventType.STATUS_CHANGE, JobStatus.CANCELLED, false, 5);
    for (const [index, type] of Object.values(JobEventType)
      .filter((value) => value !== JobEventType.STATUS_CHANGE)
      .entries()) {
      await add(type, null, true, index + 6);
    }
    const result = await read().expect(200);
    expect(
      result.body.progress.map((event: { status: string }) => event.status),
    ).toEqual(['IN_PROGRESS', 'ON_HOLD', 'QUALITY_CHECK', 'IN_PROGRESS']);
    expect(JSON.stringify(result.body)).not.toMatch(
      /Private event|88888|payload|createdBy/,
    );
    expect((await read().expect(200)).body.progress).toEqual(
      result.body.progress,
    );
  });

  it('handles missing history, short plates and missing/invalid public contacts', async () => {
    await db.getRepository(ServiceJobEvent).delete({ jobId: job.id });
    await db
      .getRepository(Vehicle)
      .update(job.vehicleId, { registrationNumber: 'AB123' });
    for (const publicPhone of [null, 'tel:+919999999999']) {
      await db
        .getRepository(ServiceCenter)
        .update(job.serviceCenterId, { publicPhone });
      const result = await read().expect(200);
      expect(result.body).toMatchObject({
        centerPhone: null,
        vehicleRegistration: '•••••',
        progress: [],
      });
    }
    await db.getRepository(ServiceCenter).softDelete(job.serviceCenterId);
    expect((await read().expect(200)).body).toMatchObject({
      centerName: null,
      centerPhone: null,
    });
  });

  it('invalidates the old token after replacement and hides deleted jobs', async () => {
    await read().expect(200);
    const replacement = 'legacy_safe-token_123';
    await db
      .getRepository(ServiceJob)
      .update(job.id, { publicToken: replacement });
    const old = await read().expect(404);
    expect(old.headers['cache-control']).toBe('no-store');
    const next = await http().get(`/v1/track/${replacement}`).expect(200);
    expect(next.body.jobNumber).toBe(job.jobNumber);
    await db.getRepository(ServiceJob).softDelete(job.id);
    await http().get(`/v1/track/${replacement}`).expect(404);
  });

  it.each([
    '',
    '/',
    '/extra/path',
    '/not-a-real-token',
    '/abc%20def',
    '/abc%2Fdef',
    `/${'a'.repeat(129)}`,
  ])('returns uncached unavailable for %s', async (suffix) => {
    const result = await http().get(`/v1/track${suffix}`).expect(404);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).not.toHaveProperty('progress');
  });

  it('rejects malformed tokens before querying the repository', async () => {
    const repo = db.getRepository(ServiceJob);
    const spy = jest.spyOn(repo, 'createQueryBuilder');
    try {
      await expect(app.get(CustomerJobsService).track('a/b')).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
