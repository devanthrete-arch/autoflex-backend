import { INestApplication } from '@nestjs/common';
import { IBackup } from 'pg-mem';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import * as indiaTime from '../src/common/time/ist';
import { Booking } from '../src/modules/bookings/entities/booking.entity';
import { BookingItem } from '../src/modules/bookings/entities/booking-item.entity';
import { CustomerProfile } from '../src/modules/customers/entities/customer-profile.entity';
import { ServiceOffering } from '../src/modules/offerings/entities/service-offering.entity';
import { createJwtTestFixture } from '../src/test-utils/jwt-test.helper';
import { createE2eApp } from './helpers/e2e-app.helper';
import {
  seedCenterListing,
  seedTestTenancy,
  TEST_CUSTOMER_APP_ID,
  TEST_CUSTOMER_DOMAIN_ID,
  TEST_CUSTOMER_IAM_USER_ID,
} from './helpers/test-db.helper';

describe('AF-012 booking eligibility (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let backup: IBackup;
  let customer: string;
  let profileId: string;
  let centerId: string;
  let bookingBody: Record<string, unknown>;
  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test) =>
    req.set('Authorization', `Bearer ${customer}`);
  const book = () => auth(http().post('/v1/bookings')).send(bookingBody);
  const profile = (dateOfBirth: string) =>
    auth(http().put('/v1/me/profile')).send({ dateOfBirth });
  const slots = () =>
    http().get(`/v1/centers/${centerId}/slots`).query({ date: '2027-06-15' });

  beforeAll(async () => {
    process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID = TEST_CUSTOMER_APP_ID;
    const fixture = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = fixture.jwksJson;
    const ctx = await createE2eApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    const tenancy = await seedTestTenancy(dataSource);
    centerId = (await seedCenterListing(dataSource, tenancy.serviceCenter.id))
      .id;
    customer = await fixture.signAccessToken({
      sub: TEST_CUSTOMER_IAM_USER_ID,
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      mobile: '9876543210',
      roles: ['customer'],
      permissions: [],
    });
    const me = await auth(http().put('/v1/me/profile'))
      .send({ displayName: 'Booking Policy Test' })
      .expect(200);
    profileId = me.body.id;
    const vehicle = await auth(http().post('/v1/me/vehicles'))
      .send({
        vehicleType: 'TWO_WHEELER',
        make: 'Honda',
        model: 'Activa',
        registrationNumber: 'KA01AB1234',
      })
      .expect(201);
    const offeringRepo = dataSource.getRepository(ServiceOffering);
    const offering = await offeringRepo.save(
      offeringRepo.create({
        serviceCenterId: centerId,
        name: 'Periodic service',
        priceInr: '1499.00',
      }),
    );
    bookingBody = {
      serviceCenterId: centerId,
      vehicleId: vehicle.body.id,
      mode: 'SELF_CHECKIN',
      slotStart: '2027-06-15T03:30:00.000Z',
      slotEnd: '2027-06-15T04:30:00.000Z',
      offeringIds: [offering.id],
    };
    backup = ctx.memoryDb.backup();
  }, 60000);

  beforeEach(() => {
    backup.restore();
    jest.spyOn(indiaTime, 'istToday').mockReturnValue('2026-10-08');
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  it.each([
    [null, 'BOOKING_DATE_OF_BIRTH_REQUIRED'],
    ['2008-10-09', 'BOOKING_MINIMUM_AGE'],
    ['2999-01-01', 'BOOKING_DATE_OF_BIRTH_INVALID'],
  ])(
    'rejects stored DOB %s without reserving capacity or writing items',
    async (dob, code) => {
      // Bypass the profile validator to cover legacy invalid/missing stored values.
      await dataSource
        .getRepository(CustomerProfile)
        .update(profileId, { dateOfBirth: dob });
      const me = await auth(http().get('/v1/me/profile')).expect(200);
      expect(me.body.bookingEligibility).toMatchObject({
        eligible: false,
        minimumAge: 18,
        code,
      });
      const before = await slots().expect(200);
      const res = await book().expect(422);
      expect(res.body).toMatchObject({
        statusCode: 422,
        code,
        message: me.body.bookingEligibility.message,
      });
      expect(await dataSource.getRepository(Booking).count()).toBe(0);
      expect(await dataSource.getRepository(BookingItem).count()).toBe(0);
      const after = await slots().expect(200);
      expect(after.body).toEqual(before.body);
    },
  );

  it('does not accept a claimed adult DOB or age in the booking payload', async () => {
    await profile('2008-10-09').expect(200);
    await auth(http().post('/v1/bookings'))
      .send({
        ...bookingBody,
        dateOfBirth: '1990-01-01',
        ageYears: 36,
      })
      .expect(400);
    await book().expect(422);
    expect(await dataSource.getRepository(Booking).count()).toBe(0);
  });

  it('allows booking on the 18th birthday and retries an earlier rejected idempotency key', async () => {
    await profile('2008-10-09').expect(200);
    await book().set('Idempotency-Key', 'birthday-retry').expect(422);
    // The future slot was already after this birthday; only submission day changes eligibility.
    jest.spyOn(indiaTime, 'istToday').mockReturnValue('2026-10-09');
    const me = await auth(http().get('/v1/me/profile')).expect(200);
    expect(me.body).toMatchObject({
      ageYears: 18,
      bookingEligibility: { eligible: true, code: null },
    });
    const created = await book()
      .set('Idempotency-Key', 'birthday-retry')
      .expect(201);
    expect(created.body.items).toHaveLength(1);
    const day = await slots().expect(200);
    expect(day.body.slots[0]).toMatchObject({ available: false, remaining: 0 });
  });

  it('keeps an existing booking accessible after a DOB correction but blocks a new one', async () => {
    await profile('1994-03-12').expect(200);
    const created = await book()
      .set('Idempotency-Key', 'existing-booking')
      .expect(201);
    const updated = await profile('2010-01-01').expect(200);
    expect(updated.body.bookingEligibility.code).toBe('BOOKING_MINIMUM_AGE');
    await book().expect(422);
    const replay = await book()
      .set('Idempotency-Key', 'existing-booking')
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);
    const existing = await auth(
      http().get(`/v1/bookings/${created.body.id}`),
    ).expect(200);
    expect(existing.body.status).toBe('AWAITING_ARRIVAL');
    const list = await auth(http().get('/v1/bookings')).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(await dataSource.getRepository(BookingItem).count()).toBe(1);
    await auth(http().post(`/v1/bookings/${created.body.id}/cancel`))
      .send({})
      .expect(200);
  });
});
