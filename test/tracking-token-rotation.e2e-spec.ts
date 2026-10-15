import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { Server } from 'http';
import { createJwtTestFixture } from '../src/test-utils/jwt-test.helper';
import { createE2eApp } from './helpers/e2e-app.helper';
import { seedReturningWalkIn } from './helpers/returning-walk-in.helper';
import {
  seedTestTenancy,
  TEST_DOMAIN_ID,
  TEST_IAM_USER_ID,
  TEST_OTHER_DOMAIN_ID,
  TEST_OTHER_USER_ID,
} from './helpers/test-db.helper';
import { ServiceJob } from '../src/modules/jobs/entities/service-job.entity';
import { AuditLog } from '../src/modules/events/entities/audit-log.entity';
import { CommandIdempotency } from '../src/modules/idempotency/command-idempotency.entity';
import { JobStatus } from '../src/common/enums/job-status.enum';
import { JobTrackingService } from '../src/modules/jobs/job-tracking.service';

describe('Tracking token replacement (e2e)', () => {
  let app: INestApplication,
    db: DataSource,
    id: string,
    old: string,
    token: string,
    readOnly: string,
    technician: string,
    other: string;
  let reset: () => void;
  const http = () => request(app.getHttpServer() as Server);
  const path = () => `/v1/jobs/${id}/public-token`;
  const current = () =>
    http().get(path()).set('Authorization', `Bearer ${token}`);
  const rotate = (
    key = randomUUID(),
    version = 1,
    reason = 'LINK_EXPOSED',
    bearer = token,
  ) =>
    http()
      .post(`${path()}/rotate`)
      .set('Authorization', `Bearer ${bearer}`)
      .set('Idempotency-Key', key)
      .set('If-Match', String(version))
      .send({ reason });
  beforeAll(async () => {
    const jwt = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = jwt.jwksJson;
    const ctx = await createE2eApp();
    app = ctx.app;
    db = ctx.dataSource;
    const { serviceCenter } = await seedTestTenancy(db);
    const sign = (
      roles: string[],
      permissions: string[],
      domainId = TEST_DOMAIN_ID,
      sub = TEST_IAM_USER_ID,
    ) => jwt.signAccessToken({ sub, domainId, roles, permissions });
    token = await sign(
      ['advisor'],
      ['jobs:create', 'jobs:read', 'jobs:update'],
    );
    readOnly = await sign(['manager'], ['jobs:read']);
    technician = await sign(['technician'], ['jobs:read', 'jobs:update']);
    other = await sign(
      ['advisor'],
      ['jobs:read', 'jobs:update'],
      TEST_OTHER_DOMAIN_ID,
      TEST_OTHER_USER_ID,
    );
    const job = await http()
      .post('/v1/jobs')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...(
          await seedReturningWalkIn(db, serviceCenter.id, {
            registrationNumber: 'KA01TEST1',
          })
        ).selection,
        serviceType: 'Service',
      })
      .expect(201);
    id = job.body.id;
    expect(job.body.publicToken).toBeUndefined();
    old = (await current().expect(200)).body.publicToken;
    const backup = ctx.memoryDb.backup();
    reset = () => backup.restore();
  });
  beforeEach(() => reset());
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => app?.close());
  it('returns only the current secret, replaces atomically, and replays non-secret receipts', async () => {
    const read = await current().expect(200);
    expect(read.headers['cache-control']).toBe('no-store');
    expect(Object.keys(read.body as Record<string, unknown>).sort()).toEqual([
      'jobId',
      'publicToken',
      'version',
    ]);
    const before = await http().get(`/v1/track/${old}`).expect(200);
    const counts = async () =>
      Promise.all(
        [
          'service_job_events',
          'customer_notifications',
          'notification_deliveries',
        ].map((table) => db.query(`SELECT count(*) FROM ${table}`)),
      );
    const originalCounts = await counts();
    const key = randomUUID();
    const result = await rotate(key).expect(200);
    expect(Object.keys(result.body as Record<string, unknown>).sort()).toEqual([
      'jobId',
      'rotatedAt',
      'rotationId',
      'version',
    ]);
    const next = (await current().expect(200)).body;
    expect(next.version).toBe(2);
    expect(next.publicToken).not.toBe(old);
    expect(next.publicToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await http().get(`/v1/track/${old}`).expect(404);
    expect(
      (await http().get(`/v1/track/${next.publicToken}`).expect(200)).body
        .progress,
    ).toEqual(before.body.progress);
    expect((await rotate(key).expect(200)).body).toEqual(result.body);
    expect(
      await db
        .getRepository(AuditLog)
        .count({ where: { action: 'PUBLIC_TOKEN_ROTATED' } }),
    ).toBe(1);
    const audit = await db
      .getRepository(AuditLog)
      .findOneByOrFail({ id: result.body.rotationId });
    const receipts = await db.getRepository(CommandIdempotency).find();
    for (const secret of [old, next.publicToken]) {
      expect(JSON.stringify(audit)).not.toContain(secret);
      expect(JSON.stringify(receipts)).not.toContain(secret);
    }
    expect(await counts()).toEqual(originalCounts);
  });
  it('keeps live tokens out of normal job reads for desk and technician actors', async () => {
    for (const bearer of [token, technician]) {
      const list = await http()
        .get('/v1/jobs')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(200);
      const detail = await http()
        .get(`/v1/jobs/${id}`)
        .set('Authorization', `Bearer ${bearer}`)
        .expect(200);
      expect(JSON.stringify(list.body)).not.toContain(old);
      expect(detail.body).not.toHaveProperty('publicToken');
      expect(JSON.stringify(detail.body)).not.toContain(old);
    }
    await http()
      .get(path())
      .set('Authorization', `Bearer ${technician}`)
      .expect(403);
    expect((await current().expect(200)).body.publicToken).toBe(old);
  });
  it.each(Object.values(JobStatus))(
    'allows replacement for %s',
    async (status) => {
      await db.getRepository(ServiceJob).update(id, { status });
      await rotate().expect(200);
      expect(
        (await db.getRepository(ServiceJob).findOneByOrFail({ id })).status,
      ).toBe(status);
    },
  );
  it('reauthorizes receipt replay and cannot return a stale replacement token', async () => {
    const key = randomUUID();
    const first = await rotate(key).expect(200);
    await rotate(randomUUID(), 2).expect(200);
    const latest = (await current()).body;
    expect((await rotate(key).expect(200)).body).toEqual(first.body);
    expect((await current()).body).toEqual(latest);
    await db.getRepository(ServiceJob).softDelete(id);
    await rotate(key).expect(404);
  });
  it('enforces actor roles, permissions and center boundaries', async () => {
    const refused = await http().get(path()).expect(401);
    expect(refused.headers['cache-control']).toBe('no-store');
    expect(refused.headers['referrer-policy']).toBe('no-referrer');
    await rotate(undefined, 1, 'LINK_EXPOSED', readOnly).expect(403);
    await http()
      .get(path())
      .set('Authorization', `Bearer ${readOnly}`)
      .expect(200);
    await rotate(undefined, 1, 'LINK_EXPOSED', technician).expect(403);
    await rotate(undefined, 1, 'LINK_EXPOSED', other).expect(404);
  });
  it('rejects stale versions and key mismatches without rotating again', async () => {
    const key = randomUUID();
    await rotate(key).expect(200);
    expect((await rotate().expect(409)).body).toMatchObject({
      code: 'JOB_VERSION_CONFLICT',
      currentVersion: 2,
    });
    await rotate(key, 2).expect(422);
    await rotate(key, 1, 'OTHER').expect(422);
    expect((await current()).body.version).toBe(2);
  });
  it.each(['', '0', '-1', '1.5', '*', 'W/"1"', '1, 1', '2147483648'])(
    'rejects invalid version %s',
    async (version) => {
      await http()
        .post(`${path()}/rotate`)
        .set('Authorization', `Bearer ${token}`)
        .set('If-Match', version)
        .set('Idempotency-Key', randomUUID())
        .send({ reason: 'OTHER' })
        .expect(400);
      expect((await current()).body.publicToken).toBe(old);
    },
  );
  it('requires strict headers and body and accepts a quoted integer', async () => {
    for (const headers of [
      {},
      { 'If-Match': '1' },
      { 'If-Match': '1', 'Idempotency-Key': 'bad key' },
    ])
      await http()
        .post(`${path()}/rotate`)
        .set('Authorization', `Bearer ${token}`)
        .set(headers)
        .send({ reason: 'OTHER' })
        .expect(400);
    for (const body of [
      { reason: 'UNKNOWN' },
      { reason: 'OTHER', publicToken: 'client-token' },
      [],
    ])
      await http()
        .post(`${path()}/rotate`)
        .set('Authorization', `Bearer ${token}`)
        .set('If-Match', '1')
        .set('Idempotency-Key', randomUUID())
        .send(body)
        .expect(400);
    await http()
      .post(`${path()}/rotate`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '"1"')
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'OTHER' })
      .expect(200);
  });
  it('retries a generator that returns the old token, without committing twice', async () => {
    const service = app.get(JobTrackingService);
    const spy = jest
      .spyOn(service, 'generateToken')
      .mockReturnValueOnce(old)
      .mockReturnValue('new_safe_token');
    await rotate().expect(200);
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await current()).body.publicToken).toBe('new_safe_token');
  });
});
