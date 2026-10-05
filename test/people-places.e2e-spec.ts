import { INestApplication } from '@nestjs/common';
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

const SUNDAY = '2027-06-13';
const MONDAY = '2027-06-14';
const TUESDAY = '2027-06-15';

describe('People, places and centers (e2e)', () => {
  let app: INestApplication<App>;
  let customer: string;
  let manager: string;
  let advisor: string;
  let centerId: string;
  let ownStaffId: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID = TEST_CUSTOMER_APP_ID;
    const fixture = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = fixture.jwksJson;

    const ctx = await createE2eApp();
    app = ctx.app;
    const tenancy = await seedTestTenancy(ctx.dataSource);
    centerId = (
      await seedCenterListing(ctx.dataSource, tenancy.serviceCenter.id)
    ).id;
    ownStaffId = tenancy.staffProfile.id;

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
        'jobs:read',
        'staff:read',
        'staff:manage',
        'center:read',
        'center:manage',
      ],
    });
    advisor = await fixture.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['advisor'],
      permissions: ['jobs:read', 'staff:read'],
    });
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  describe('customer profile', () => {
    it('stores contact details and notification preferences', async () => {
      const res = await http()
        .put('/v1/me/profile')
        .set('Authorization', `Bearer ${customer}`)
        .send({
          displayName: 'Priya Sharma',
          email: 'Priya@Example.com',
          city: 'Bengaluru',
          state: 'Karnataka',
          postalCode: '560001',
          preferredChannel: 'SMS',
          whatsappConsent: true,
          maintenanceReminders: false,
        })
        .expect(200);

      expect(res.body.email).toBe('priya@example.com');
      expect(res.body.preferredChannel).toBe('SMS');
      expect(res.body.whatsappConsent).toBe(true);
      expect(res.body.maintenanceReminders).toBe(false);
      expect(res.body.serviceUpdates).toBe(true);
    });

    it('rejects an invalid PIN code', async () => {
      await http()
        .put('/v1/me/profile')
        .set('Authorization', `Bearer ${customer}`)
        .send({ postalCode: '012345' })
        .expect(400);
    });
  });

  describe('customer addresses', () => {
    const base = {
      line1: '12 MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
    };

    it('keeps exactly one default and promotes on delete', async () => {
      const home = await http()
        .post('/v1/me/addresses')
        .set('Authorization', `Bearer ${customer}`)
        .send({ ...base, label: 'Home', contactPhone: '9876543210' })
        .expect(201);
      expect(home.body.isDefault).toBe(true);
      expect(home.body.contactPhone).toBe('+919876543210');

      const office = await http()
        .post('/v1/me/addresses')
        .set('Authorization', `Bearer ${customer}`)
        .send({ ...base, label: 'Office', line1: '1 Residency Road' })
        .expect(201);
      expect(office.body.isDefault).toBe(false);

      await http()
        .patch(`/v1/me/addresses/${office.body.id}`)
        .set('Authorization', `Bearer ${customer}`)
        .send({ isDefault: true })
        .expect(200);

      let list = await http()
        .get('/v1/me/addresses')
        .set('Authorization', `Bearer ${customer}`)
        .expect(200);
      expect(list.body).toHaveLength(2);
      expect(list.body[0].id).toBe(office.body.id);
      expect(
        list.body.filter((a: { isDefault: boolean }) => a.isDefault),
      ).toHaveLength(1);

      await http()
        .delete(`/v1/me/addresses/${office.body.id}`)
        .set('Authorization', `Bearer ${customer}`)
        .expect(204);

      list = await http()
        .get('/v1/me/addresses')
        .set('Authorization', `Bearer ${customer}`)
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].id).toBe(home.body.id);
      expect(list.body[0].isDefault).toBe(true);
    });

    it('validates PIN code and phone', async () => {
      await http()
        .post('/v1/me/addresses')
        .set('Authorization', `Bearer ${customer}`)
        .send({ ...base, label: 'Bad', postalCode: '5600' })
        .expect(400);
      await http()
        .post('/v1/me/addresses')
        .set('Authorization', `Bearer ${customer}`)
        .send({ ...base, label: 'Bad', contactPhone: '12345' })
        .expect(400);
    });

    it('is customer-only', async () => {
      await http()
        .get('/v1/me/addresses')
        .set('Authorization', `Bearer ${manager}`)
        .expect(403);
    });
  });

  describe('garage vehicles', () => {
    let vehicleId: string;

    it('creates with identity details and normalises the registration', async () => {
      const res = await http()
        .post('/v1/me/vehicles')
        .set('Authorization', `Bearer ${customer}`)
        .send({
          vehicleType: 'TWO_WHEELER',
          make: 'Royal Enfield',
          model: 'Classic 350',
          variant: 'Signals',
          registrationNumber: 'ka 03 mn-4567',
          chassisNumber: 'me3u3s5c1nb123456',
          currentOdometerKm: 12500,
          purchaseDate: '2023-04-10',
        })
        .expect(201);
      vehicleId = res.body.id;
      expect(res.body.registrationNumber).toBe('KA03MN4567');
      expect(res.body.chassisNumber).toBe('ME3U3S5C1NB123456');
      expect(res.body.status).toBe('ACTIVE');
    });

    it('rejects a duplicate registration in the same garage', async () => {
      await http()
        .post('/v1/me/vehicles')
        .set('Authorization', `Bearer ${customer}`)
        .send({ make: 'RE', model: 'Hunter', registrationNumber: 'KA03MN4567' })
        .expect(409);
    });

    it('edits, archives and restores', async () => {
      const patched = await http()
        .patch(`/v1/me/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${customer}`)
        .send({ currentOdometerKm: 13100, color: 'Stealth Black' })
        .expect(200);
      expect(patched.body.currentOdometerKm).toBe(13100);

      await http()
        .post(`/v1/me/vehicles/${vehicleId}/archive`)
        .set('Authorization', `Bearer ${customer}`)
        .expect(200);

      const active = await http()
        .get('/v1/me/vehicles')
        .set('Authorization', `Bearer ${customer}`)
        .expect(200);
      expect(active.body.map((v: { id: string }) => v.id)).not.toContain(
        vehicleId,
      );

      const archived = await http()
        .get('/v1/me/vehicles')
        .query({ status: 'archived' })
        .set('Authorization', `Bearer ${customer}`)
        .expect(200);
      expect(archived.body.map((v: { id: string }) => v.id)).toContain(
        vehicleId,
      );

      const restored = await http()
        .post(`/v1/me/vehicles/${vehicleId}/restore`)
        .set('Authorization', `Bearer ${customer}`)
        .expect(200);
      expect(restored.body.status).toBe('ACTIVE');

      const one = await http()
        .get(`/v1/me/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${customer}`)
        .expect(200);
      expect(one.body.color).toBe('Stealth Black');
    });
  });

  describe('staff and center', () => {
    it('returns the signed-in staff member with center and access', async () => {
      const res = await http()
        .get('/v1/staff/me')
        .set('Authorization', `Bearer ${advisor}`)
        .expect(200);
      expect(res.body.staff.id).toBe(ownStaffId);
      expect(res.body.center.id).toBe(centerId);
      expect(res.body.center.weeklyHours).toHaveLength(7);
      expect(res.body.roles).toEqual(['advisor']);
    });

    it('is staff-only', async () => {
      await http()
        .get('/v1/center')
        .set('Authorization', `Bearer ${customer}`)
        .expect(403);
      await http()
        .get('/v1/staff/me')
        .set('Authorization', `Bearer ${customer}`)
        .expect(403);
    });

    it('lets a manager edit the center profile', async () => {
      const res = await http()
        .patch('/v1/center')
        .set('Authorization', `Bearer ${manager}`)
        .send({
          slug: 'test-motors-indiranagar',
          publicPhone: '9812345678',
          gstin: '29ABCDE1234F1Z5',
          addressLine1: '12 MG Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          postalCode: '560001',
          supportedVehicleTypes: ['TWO_WHEELER', 'FOUR_WHEELER'],
          pickupDropEnabled: true,
        })
        .expect(200);
      expect(res.body.slug).toBe('test-motors-indiranagar');
      expect(res.body.publicPhone).toBe('+919812345678');
      expect(res.body.address.city).toBe('Bengaluru');
      expect(res.body.supportedVehicleTypes).toEqual([
        'TWO_WHEELER',
        'FOUR_WHEELER',
      ]);
    });

    it('blocks an advisor from editing the center', async () => {
      await http()
        .patch('/v1/center')
        .set('Authorization', `Bearer ${advisor}`)
        .send({ displayName: 'Nope' })
        .expect(403);
    });

    it('rejects inverted default hours', async () => {
      await http()
        .patch('/v1/center')
        .set('Authorization', `Bearer ${manager}`)
        .send({ hoursStart: '18:00', hoursEnd: '09:00' })
        .expect(400);
    });

    it('manages the roster', async () => {
      const created = await http()
        .post('/v1/staff')
        .set('Authorization', `Bearer ${manager}`)
        .send({
          iamUserId: '77777777-7777-4777-8777-777777777777',
          displayName: 'Ravi Kumar',
          designation: 'TECHNICIAN',
          employeeCode: 'TM-014',
          specializations: ['engine', 'electrical'],
          joinedAt: '2026-01-05',
        })
        .expect(201);
      expect(created.body.designation).toBe('TECHNICIAN');

      await http()
        .post('/v1/staff')
        .set('Authorization', `Bearer ${manager}`)
        .send({
          iamUserId: '88888888-8888-4888-8888-888888888888',
          displayName: 'Dup Code',
          employeeCode: 'TM-014',
        })
        .expect(409);

      const technicians = await http()
        .get('/v1/staff')
        .query({ designation: 'TECHNICIAN' })
        .set('Authorization', `Bearer ${advisor}`)
        .expect(200);
      expect(technicians.body).toHaveLength(1);
      expect(technicians.body[0].specializations).toEqual([
        'engine',
        'electrical',
      ]);

      await http()
        .patch(`/v1/staff/${created.body.id}`)
        .set('Authorization', `Bearer ${manager}`)
        .send({ isActive: false })
        .expect(200);

      const active = await http()
        .get('/v1/staff')
        .set('Authorization', `Bearer ${manager}`)
        .expect(200);
      expect(active.body.map((s: { id: string }) => s.id)).not.toContain(
        created.body.id,
      );

      await http()
        .patch(`/v1/staff/${ownStaffId}`)
        .set('Authorization', `Bearer ${manager}`)
        .send({ isActive: false })
        .expect(400);

      await http()
        .post('/v1/staff')
        .set('Authorization', `Bearer ${advisor}`)
        .send({ iamUserId: 'x', displayName: 'x' })
        .expect(403);
    });
  });

  describe('operating hours drive slots', () => {
    it('stores weekly hours and closes Sunday', async () => {
      const res = await http()
        .put('/v1/center/hours')
        .set('Authorization', `Bearer ${manager}`)
        .send({
          days: [
            { dayOfWeek: 0, isClosed: true },
            {
              dayOfWeek: 1,
              isClosed: false,
              openTime: '10:00',
              closeTime: '13:00',
            },
          ],
        })
        .expect(200);
      expect(res.body).toHaveLength(7);
      expect(res.body[0]).toMatchObject({ dayOfWeek: 0, isClosed: true });
      expect(res.body[1]).toMatchObject({
        openTime: '10:00',
        closeTime: '13:00',
      });
      expect(res.body[2]).toMatchObject({
        openTime: '09:00',
        closeTime: '17:00',
      });
    });

    it('rejects a day with open after close', async () => {
      await http()
        .put('/v1/center/hours')
        .set('Authorization', `Bearer ${manager}`)
        .send({
          days: [
            {
              dayOfWeek: 3,
              isClosed: false,
              openTime: '14:00',
              closeTime: '09:00',
            },
          ],
        })
        .expect(400);
    });

    it('returns no slots on a closed day', async () => {
      const res = await http()
        .get(`/v1/centers/${centerId}/slots`)
        .query({ date: SUNDAY })
        .expect(200);
      expect(res.body.closed).toBe(true);
      expect(res.body.slots).toHaveLength(0);
    });

    it('uses the weekday hours for slots', async () => {
      const monday = await http()
        .get(`/v1/centers/${centerId}/slots`)
        .query({ date: MONDAY })
        .expect(200);
      expect(monday.body.slots).toHaveLength(3);
      expect(monday.body.slots[0].start).toBe('2027-06-14T04:30:00.000Z');

      const tuesday = await http()
        .get(`/v1/centers/${centerId}/slots`)
        .query({ date: TUESDAY })
        .expect(200);
      expect(tuesday.body.slots).toHaveLength(8);
    });

    it('rejects a booking outside the center hours', async () => {
      const vehicles = await http()
        .get('/v1/me/vehicles')
        .set('Authorization', `Bearer ${customer}`)
        .expect(200);
      await http()
        .post('/v1/bookings')
        .set('Authorization', `Bearer ${customer}`)
        .send({
          serviceCenterId: centerId,
          vehicleId: vehicles.body[0].id,
          mode: 'SELF_CHECKIN',
          slotStart: '2027-06-14T09:30:00.000Z',
          slotEnd: '2027-06-14T10:30:00.000Z',
        })
        .expect(400);
    });

    it('shows weekly hours and structured address on the public listing', async () => {
      const res = await http()
        .get(`/v1/marketplace/centers/${centerId}`)
        .expect(200);
      expect(res.body.weeklyHours[0].isClosed).toBe(true);
      expect(res.body.address.postalCode).toBe('560001');
      expect(res.body.publicPhone).toBe('+919812345678');
      expect(res.body.pickupDropEnabled).toBe(true);
    });
  });
});
