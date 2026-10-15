import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
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

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.LOCAL_JWKS_JSON =
      process.env.LOCAL_JWKS_JSON ?? (await createJwtTestFixture()).jwksJson;

    const ctx = await createE2eApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health returns ok without auth', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });
});

describe('Jobs API (e2e)', () => {
  let app: INestApplication<App>;
  let jwtFixture: Awaited<ReturnType<typeof createJwtTestFixture>>;
  let accessToken: string;
  let otherTenantToken: string;
  let technicianToken: string;
  let createdJobId: string;
  let selection: Awaited<ReturnType<typeof seedReturningWalkIn>>['selection'];

  beforeAll(async () => {
    const fixture = await createJwtTestFixture();
    jwtFixture = fixture;
    process.env.LOCAL_JWKS_JSON = fixture.jwksJson;

    const ctx = await createE2eApp();
    app = ctx.app;
    const { serviceCenter } = await seedTestTenancy(ctx.dataSource);
    ({ selection } = await seedReturningWalkIn(
      ctx.dataSource,
      serviceCenter.id,
      {
        name: 'Rahul Sharma',
        registrationNumber: 'MH12AB1234',
      },
    ));

    accessToken = await fixture.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['advisor'],
      permissions: ['jobs:create', 'jobs:read', 'jobs:update', 'jobs:delete'],
    });

    otherTenantToken = await fixture.signAccessToken({
      sub: TEST_OTHER_USER_ID,
      domainId: TEST_OTHER_DOMAIN_ID,
      roles: ['advisor'],
      permissions: ['jobs:create', 'jobs:read', 'jobs:update', 'jobs:delete'],
    });

    technicianToken = await fixture.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['technician'],
      permissions: ['jobs:read', 'jobs:update'],
    });
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  it('rejects requests without bearer token', () => {
    return request(app.getHttpServer()).get('/v1/jobs').expect(401);
  });

  it('rejects invalid JWT', () => {
    return request(app.getHttpServer())
      .get('/v1/jobs')
      .set('Authorization', 'Bearer invalid.token.value')
      .expect(401);
  });

  it('returns 404 when JWT domain has no mapped service center', async () => {
    const orphanToken = await jwtFixture.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: '99999999-9999-4999-8999-999999999999',
    });

    return request(app.getHttpServer())
      .get('/v1/jobs')
      .set('Authorization', `Bearer ${orphanToken}`)
      .expect(404);
  });

  it('creates a selected returning walk-in with a narrow non-secret reference', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/jobs')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...selection,
        serviceType: 'Periodic service',
        odometerKm: 12000,
      })
      .expect(201);

    expect(response.body.id).toBeDefined();
    expect(response.body.status).toBe('CHECKED_IN');
    expect(response.body.publicToken).toBeUndefined();
    createdJobId = response.body.id;
  });

  it('lists jobs with pagination', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/jobs?page=1&limit=10&sortBy=createdAt&sortOrder=DESC')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.total).toBeGreaterThanOrEqual(1);
    expect(response.body.data[0].id).toBe(createdJobId);
  });

  it('gets job by id', async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/jobs/${createdJobId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.serviceType).toBe('Periodic service');
  });

  it('updates job fields', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/v1/jobs/${createdJobId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ fuelLevel: 'Half', odometerKm: 12100 })
      .expect(200);

    expect(response.body.fuelLevel).toBe('Half');
    expect(response.body.odometerKm).toBe(12100);
  });

  it('transitions job status', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/v1/jobs/${createdJobId}/status`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'INSPECTION', note: 'Starting inspection' })
      .expect(200);

    expect(response.body.status).toBe('INSPECTION');
  });

  it('returns 404 for cross-tenant job access', async () => {
    await request(app.getHttpServer())
      .get(`/v1/jobs/${createdJobId}`)
      .set('Authorization', `Bearer ${otherTenantToken}`)
      .expect(404);
  });

  it('forbids create when role is insufficient', async () => {
    await request(app.getHttpServer())
      .post('/v1/jobs')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({
        customerPhone: '+919111111111',
        vehicleRegistration: 'MH12XY9999',
        serviceType: 'Repair',
      })
      .expect(403);
  });

  it('rejects mass-assignment of protected fields', async () => {
    await request(app.getHttpServer())
      .patch(`/v1/jobs/${createdJobId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'COMPLETED', publicToken: 'hacked' })
      .expect(400);
  });
});
