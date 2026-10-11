import { ServiceCenter } from '../src/modules/tenancy/entities/service-center.entity';
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { BookingMode } from '../src/common/enums/booking-mode.enum';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { Booking } from '../src/modules/bookings/entities/booking.entity';
import { GarageVehicle } from '../src/modules/customers/entities/garage-vehicle.entity';
import { Vehicle } from '../src/modules/customers/entities/vehicle.entity';
import { ServiceJob } from '../src/modules/jobs/entities/service-job.entity';
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

/** Tuesday 2027-06-15, IST. */
const SLOT_9 = {
  slotStart: '2027-06-15T03:30:00.000Z',
  slotEnd: '2027-06-15T04:30:00.000Z',
};
const SLOT_10 = {
  slotStart: '2027-06-15T04:30:00.000Z',
  slotEnd: '2027-06-15T05:30:00.000Z',
};
const SLOT_11 = {
  slotStart: '2027-06-15T05:30:00.000Z',
  slotEnd: '2027-06-15T06:30:00.000Z',
};

describe('Discovery and reservation (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let customer: string;
  let manager: string;
  let technician: string;
  let centerId: string;
  let vehicleId: string;
  const offering: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const asCustomer = (req: request.Test) =>
    req.set('Authorization', `Bearer ${customer}`);
  const asManager = (req: request.Test) =>
    req
      .set('Authorization', `Bearer ${manager}`)
      .set('Idempotency-Key', randomUUID())
      .set('If-Match', '1');

  const book = (body: Record<string, unknown>) =>
    asCustomer(http().post('/v1/bookings')).send({
      serviceCenterId: centerId,
      vehicleId,
      mode: 'SELF_CHECKIN',
      ...body,
    });

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

    await dataSource
      .getRepository(ServiceCenter)
      .update(centerId, {
        supportedVehicleTypes: ['TWO_WHEELER', 'FOUR_WHEELER'] as any,
      });

    customer = await fixture.signAccessToken({
      sub: TEST_CUSTOMER_IAM_USER_ID,
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      mobile: '9876543210',
      roles: ['customer'],
      permissions: [],
    });
    manager = await fixture.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['manager'],
      permissions: [
        'jobs:create',
        'jobs:read',
        'jobs:update',
        'bookings:read',
        'bookings:manage',
        'center:manage',
      ],
    });
    technician = await fixture.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['technician'],
      permissions: ['jobs:read', 'jobs:update'],
    });

    await asCustomer(http().put('/v1/me/profile'))
      .send({ displayName: 'Priya Sharma', dateOfBirth: '1994-03-12' })
      .expect(200);
    const vehicle = await asCustomer(http().post('/v1/me/vehicles'))
      .send({
        vehicleType: 'TWO_WHEELER',
        make: 'Honda',
        model: 'Activa 6G',
        registrationNumber: 'KA01AB1234',
        currentOdometerKm: 8000,
      })
      .expect(201);
    vehicleId = vehicle.body.id;
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  describe('service menu', () => {
    it('lets a manager build the menu', async () => {
      const items = [
        {
          key: 'periodic',
          name: 'Periodic service',
          priceInr: 1499,
          durationMinutes: 90,
        },
        {
          key: 'brakes',
          name: 'Brake inspection',
          priceInr: 499,
          priceIsStarting: true,
          durationMinutes: 30,
          vehicleType: 'TWO_WHEELER',
        },
        {
          key: 'car',
          name: 'Car AC service',
          priceInr: 3999,
          durationMinutes: 120,
          vehicleType: 'FOUR_WHEELER',
        },
      ];
      for (const { key, ...body } of items) {
        const res = await asManager(http().post('/v1/center/offerings'))
          .send(body)
          .expect(201);
        offering[key] = res.body.id;
      }
      expect(offering.periodic).toBeDefined();
    });

    it('shows only matching active items publicly', async () => {
      await asManager(http().post('/v1/center/offerings'))
        .send({ name: 'Paused wash', priceInr: 199, durationMinutes: 30 })
        .expect(201)
        .then((res) =>
          asManager(http().patch(`/v1/center/offerings/${res.body.id}`))
            .send({ isActive: false })
            .expect(200),
        );

      const res = await http()
        .get(`/v1/marketplace/centers/${centerId}/offerings`)
        .query({ vehicleType: 'TWO_WHEELER' })
        .expect(200);
      const names = res.body.map((o: { name: string }) => o.name);
      expect(names).toEqual(
        expect.arrayContaining(['Periodic service', 'Brake inspection']),
      );
      expect(names).not.toContain('Car AC service');
      expect(names).not.toContain('Paused wash');

      const all = await asManager(http().get('/v1/center/offerings')).expect(
        200,
      );
      expect(all.body).toHaveLength(4);
    });

    it('keeps the menu manager-only', async () => {
      await http()
        .post('/v1/center/offerings')
        .set('Authorization', `Bearer ${technician}`)
        .send({ name: 'x', priceInr: 1, durationMinutes: 30 })
        .expect(403);
    });
  });

  describe('customer reservation', () => {
    let bookingId: string;

    it('books menu items and totals the estimate', async () => {
      const res = await book({
        ...SLOT_9,
        offeringIds: [offering.periodic, offering.brakes],
        issueDescription: 'Brake squeal at low speed',
      }).expect(201);
      bookingId = res.body.id;
      expect(res.body.bookingNumber).toMatch(/^AF-\d{8}-[A-Z2-9]{4}$/);
      expect(res.body.estimateInr).toBe('1998.00');
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[1]).toMatchObject({
        name: 'Brake inspection',
        priceIsStarting: true,
      });
    });

    it('rejects an item for another vehicle type', async () => {
      await book({ ...SLOT_10, offeringIds: [offering.car] }).expect(400);
    });

    it('honours slot capacity', async () => {
      await book(SLOT_9).expect(400);

      let slots = await http()
        .get(`/v1/centers/${centerId}/slots`)
        .query({ date: '2027-06-15' })
        .expect(200);
      expect(slots.body.slots[0]).toMatchObject({
        available: false,
        remaining: 0,
      });

      await asManager(http().patch('/v1/center'))
        .send({ slotCapacity: 2 })
        .expect(200);
      slots = await http()
        .get(`/v1/centers/${centerId}/slots`)
        .query({ date: '2027-06-15' })
        .expect(200);
      expect(slots.body.slots[0]).toMatchObject({
        available: true,
        remaining: 1,
      });
    });

    it('registers and removes attachments', async () => {
      const added = await asCustomer(
        http().post(`/v1/bookings/${bookingId}/attachments`),
      )
        .send({
          fileName: 'brake noise.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 240000,
        })
        .expect(201);
      expect(added.body.storageKey).toMatch(
        new RegExp(`^bookings/${bookingId}/.+-brake_noise\\.jpg$`),
      );
      expect(added.body.upload).toBeNull();

      await asCustomer(http().post(`/v1/bookings/${bookingId}/attachments`))
        .send({
          fileName: 'x.exe',
          mimeType: 'application/x-msdownload',
          sizeBytes: 10,
        })
        .expect(400);

      let detail = await asCustomer(
        http().get(`/v1/bookings/${bookingId}`),
      ).expect(200);
      expect(detail.body.attachments).toHaveLength(1);

      await asCustomer(
        http().delete(`/v1/bookings/${bookingId}/attachments/${added.body.id}`),
      ).expect(204);
      detail = await asCustomer(http().get(`/v1/bookings/${bookingId}`)).expect(
        200,
      );
      expect(detail.body.attachments).toHaveLength(0);
    });

    it('lets the customer cancel once', async () => {
      const extra = await book(SLOT_11).expect(201);
      const cancelled = await asCustomer(
        http().post(`/v1/bookings/${extra.body.id}/cancel`),
      )
        .send({ reason: 'Plans changed' })
        .expect(200);
      expect(cancelled.body).toMatchObject({
        status: 'CANCELLED',
        cancelledBy: 'CUSTOMER',
        cancellationReason: 'Plans changed',
      });
      await asCustomer(http().post(`/v1/bookings/${extra.body.id}/cancel`))
        .send({})
        .expect(409);
    });
  });

  describe('center queue', () => {
    let pendingId: string;

    it('holds requests for approval when auto-accept is off', async () => {
      await asManager(http().patch('/v1/center'))
        .send({ autoAccept: false })
        .expect(200);
      const res = await book({
        ...SLOT_10,
        offeringIds: [offering.periodic],
      }).expect(201);
      pendingId = res.body.id;
      expect(res.body.status).toBe('PENDING_CENTER');
      expect(res.body.confirmedAt).toBeNull();

      const pending = await asManager(
        http().get('/v1/center/bookings/pending'),
      ).expect(200);
      expect(pending.body.map((b: { id: string }) => b.id)).toContain(
        pendingId,
      );
    });

    it('lists the day with customer and vehicle details', async () => {
      const res = await asManager(http().get('/v1/center/bookings'))
        .query({ date: '2027-06-15' })
        .expect(200);
      expect(res.body.date).toBe('2027-06-15');
      expect(res.body.from).toBe('2027-06-15');
      expect(res.body.to).toBe('2027-06-15');
      expect(res.body.items.length).toBeGreaterThanOrEqual(3);
      const first = res.body.items[0];
      expect(first.customer).toMatchObject({
        name: 'Priya Sharma',
        phone: '+919876543210',
      });
      expect(first.vehicle).toMatchObject({
        make: 'Honda',
        model: 'Activa 6G',
      });
    });

    it('lists an inclusive date range and rejects a span over 14 days', async () => {
      const res = await asManager(http().get('/v1/center/bookings'))
        .query({ from: '2027-06-14', to: '2027-06-16' })
        .expect(200);
      expect(res.body).toMatchObject({
        date: '2027-06-14',
        from: '2027-06-14',
        to: '2027-06-16',
      });
      expect(res.body.items.length).toBeGreaterThanOrEqual(3);
      await asManager(http().get('/v1/center/bookings'))
        .query({ from: '2027-06-01', to: '2027-06-16' })
        .expect(400);
    });

    it('confirms a pending request', async () => {
      const res = await asManager(
        http().post(`/v1/center/bookings/${pendingId}/confirm`),
      ).expect(200);
      expect(res.body.status).toBe('AWAITING_ARRIVAL');
      expect(res.body.confirmedAt).not.toBeNull();
      await asManager(
        http().post(`/v1/center/bookings/${pendingId}/confirm`),
      ).expect(409);
    });

    it('declines only with a reason', async () => {
      const res = await book(SLOT_11).expect(201);
      await asManager(http().post(`/v1/center/bookings/${res.body.id}/decline`))
        .send({})
        .expect(400);
      const declined = await asManager(
        http().post(`/v1/center/bookings/${res.body.id}/decline`),
      )
        .send({ reason: 'Technician on leave' })
        .expect(200);
      expect(declined.body).toMatchObject({
        status: 'CANCELLED',
        cancelledBy: 'CENTER',
      });

      const mine = await asCustomer(
        http().get(`/v1/bookings/${res.body.id}`),
      ).expect(200);
      expect(mine.body.cancellationReason).toBe('Technician on leave');
    });

    it('records a no-show only after the slot starts', async () => {
      await asManager(
        http().post(`/v1/center/bookings/${pendingId}/no-show`),
      ).expect(409);

      const repo = dataSource.getRepository(Booking);
      const past = await repo.save(
        repo.create({
          serviceCenterId: centerId,
          customerProfileId: (await repo.findOneByOrFail({ id: pendingId }))
            .customerProfileId,
          vehicleId,
          mode: BookingMode.SELF_CHECKIN,
          status: BookingStatus.AWAITING_ARRIVAL,
          slotStart: new Date(Date.now() - 2 * 60 * 60 * 1000),
          slotEnd: new Date(Date.now() - 60 * 60 * 1000),
          bookingNumber: 'AF-20000101-PAST',
        }),
      );
      const res = await asManager(
        http().post(`/v1/center/bookings/${past.id}/no-show`),
      ).expect(200);
      expect(res.body.status).toBe('NO_SHOW');
    });

    it('keeps the queue away from customers and technicians', async () => {
      await asCustomer(http().get('/v1/center/bookings')).expect(403);
      await http()
        .get('/v1/center/bookings')
        .set('Authorization', `Bearer ${technician}`)
        .expect(403);
    });

    it('checks in a booking and opens a linked job', async () => {
      const res = await asManager(
        http().post(`/v1/center/bookings/${pendingId}/check-in`),
      )
        .send({ odometerKm: 8420, fuelLevel: 'Half' })
        .expect(201);

      expect(res.body.booking.status).toBe('CHECKED_IN');
      expect(res.body.booking.checkedInAt).not.toBeNull();
      expect(res.body.booking.serviceJobId).toBe(res.body.job.id);
      expect(res.body.job.status).toBe('CHECKED_IN');
      expect(res.body.job.publicToken).toBeUndefined();

      const job = await dataSource.getRepository(ServiceJob).findOneOrFail({
        where: { id: res.body.job.id },
        relations: { customer: true, vehicle: true },
      });
      expect(job.sourceBookingId).toBe(pendingId);
      expect(job.serviceType).toBe('Periodic service');
      expect(job.odometerKm).toBe(8420);
      expect(Number(job.budgetCeiling)).toBe(1499);
      expect(job.customer.customerProfileId).not.toBeNull();
      expect(job.customer.phone).toBe('+919876543210');

      const centerVehicle = await dataSource
        .getRepository(Vehicle)
        .findOneByOrFail({ id: job.vehicleId });
      expect(centerVehicle.garageVehicleId).toBe(vehicleId);
      expect(centerVehicle.makeModel).toBe('Honda Activa 6G');

      const garage = await dataSource
        .getRepository(GarageVehicle)
        .findOneByOrFail({ id: vehicleId });
      expect(garage.currentOdometerKm).toBe(8420);

      const fromJobs = await asManager(http().get(`/v1/jobs/${job.id}`)).expect(
        200,
      );
      expect(fromJobs.body.id).toBe(job.id);

      const mine = await asCustomer(
        http().get(`/v1/bookings/${pendingId}`),
      ).expect(200);
      expect(mine.body.status).toBe('CHECKED_IN');
    });

    it('does not check in twice or cancel after check-in', async () => {
      await asManager(http().post(`/v1/center/bookings/${pendingId}/check-in`))
        .send({})
        .expect(409);
      await asCustomer(http().post(`/v1/bookings/${pendingId}/cancel`))
        .send({})
        .expect(409);
    });
  });
});
