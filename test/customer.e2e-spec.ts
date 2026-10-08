import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { createJwtTestFixture } from '../src/test-utils/jwt-test.helper';
import { createE2eApp } from './helpers/e2e-app.helper';
import {
  seedCenterListing,
  seedTestTenancy,
  TEST_CUSTOMER_APP_ID,
  TEST_CUSTOMER_DOMAIN_ID,
  TEST_CUSTOMER_IAM_USER_ID,
  TEST_DOMAIN_ID,
  TEST_IAM_USER_ID,
} from './helpers/test-db.helper';

describe('Customer kit slice (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let customerToken: string;
  let staffToken: string;
  let centerId: string;

  beforeAll(async () => {
    process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID = TEST_CUSTOMER_APP_ID;

    const fixture = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = fixture.jwksJson;

    const ctx = await createE2eApp();
    app = ctx.app;
    dataSource = ctx.dataSource;

    const tenancy = await seedTestTenancy(dataSource);
    const listed = await seedCenterListing(
      dataSource,
      tenancy.serviceCenter.id,
    );
    centerId = listed.id;

    customerToken = await fixture.signAccessToken({
      sub: TEST_CUSTOMER_IAM_USER_ID,
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      mobile: '9876543210',
      roles: ['customer'],
      permissions: [],
    });

    staffToken = await fixture.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['advisor'],
      permissions: ['jobs:create', 'jobs:read', 'jobs:update', 'jobs:delete'],
    });
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  it('customer JWT upserts profile, lists centers, and books SELF_CHECKIN', async () => {
    const profileRes = await request(app.getHttpServer())
      .put('/v1/me/profile')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        displayName: 'Priya Sharma',
        dateOfBirth: '1994-03-12',
        phone: '9876543210',
        locale: 'en-IN',
        selectedPlaceLabel: 'Bengaluru, IN',
        lastLat: 12.9716,
        lastLng: 77.5946,
      })
      .expect(200);

    expect(profileRes.body.displayName).toBe('Priya Sharma');
    expect(profileRes.body.phone).toBe('+919876543210');
    expect(profileRes.body.iamUserId).toBe(TEST_CUSTOMER_IAM_USER_ID);

    await request(app.getHttpServer())
      .get('/v1/me/profile')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    const centersRes = await request(app.getHttpServer())
      .get('/v1/marketplace/centers')
      .query({ lat: 12.9716, lng: 77.5946 })
      .expect(200);

    expect(centersRes.body.items.length).toBeGreaterThanOrEqual(1);
    expect(centersRes.body.items[0].id).toBe(centerId);

    const vehicleRes = await request(app.getHttpServer())
      .post('/v1/me/vehicles')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        vehicleType: 'TWO_WHEELER',
        make: 'Honda',
        model: 'Activa',
        year: 2022,
        registrationNumber: 'KA01AB1234',
      })
      .expect(201);

    const vehicleId = vehicleRes.body.id as string;

    const slotsRes = await request(app.getHttpServer())
      .get(`/v1/centers/${centerId}/slots`)
      .query({ date: '2027-06-15' })
      .expect(200);

    const slot = (
      slotsRes.body.slots as {
        start: string;
        end: string;
        available: boolean;
      }[]
    ).find((s) => s.available);
    expect(slot).toBeDefined();

    const bookingRes = await request(app.getHttpServer())
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        serviceCenterId: centerId,
        vehicleId,
        mode: 'SELF_CHECKIN',
        slotStart: slot!.start,
        slotEnd: slot!.end,
        issueDescription: 'Periodic service',
        paymentMode: 'PAY_AT_CENTER',
      })
      .expect(201);

    expect(bookingRes.body.status).toBe('AWAITING_ARRIVAL');
    expect(bookingRes.body.mode).toBe('SELF_CHECKIN');
    expect(Number(bookingRes.body.estimateInr)).toBe(2499);

    const oneRes = await request(app.getHttpServer())
      .get(`/v1/bookings/${bookingRes.body.id}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(oneRes.body.vehicleLabel).toBe('Honda Activa');
    expect(oneRes.body.centerName).toBe('Test Motors');

    const listRes = await request(app.getHttpServer())
      .get('/v1/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(listRes.body.items).toHaveLength(1);
    expect(listRes.body.items[0].id).toBe(bookingRes.body.id);
    expect(listRes.body.items[0].registrationNumber).toBe('KA01AB1234');
  });

  it('staff JWT still creates jobs', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/jobs')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        customerPhone: '+919876543210',
        customerName: 'Rahul Sharma',
        vehicleRegistration: 'KA05CD9999',
        serviceType: 'Periodic service',
        odometerKm: 8000,
      })
      .expect(201);

    expect(response.body.status).toBe('CHECKED_IN');
    expect(response.body.publicToken).toBeDefined();
  });

  it('customer JWT is forbidden on /v1/jobs', async () => {
    await request(app.getHttpServer())
      .get('/v1/jobs')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });
});
