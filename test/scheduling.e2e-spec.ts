import { randomUUID } from 'crypto';
import { Server } from 'http';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ENTITIES } from '../src/database/entities';
import { MIGRATIONS } from '../src/database/migration-list';
import { addDays, istToday } from '../src/common/time/ist';
import { Booking } from '../src/modules/bookings/entities/booking.entity';
import { ServiceCenter } from '../src/modules/tenancy/entities/service-center.entity';
import { AuditLog } from '../src/modules/events/entities/audit-log.entity';
import { CommandIdempotency } from '../src/modules/idempotency/command-idempotency.entity';
import { BookingSchedule } from '../src/modules/scheduling/schedule';
import { createJwtTestFixture } from '../src/test-utils/jwt-test.helper';
import { createApiApp, createE2eApp } from './helpers/e2e-app.helper';
import {
  seedTestTenancy,
  TEST_CUSTOMER_APP_ID,
  TEST_CUSTOMER_DOMAIN_ID,
  TEST_CUSTOMER_IAM_USER_ID,
  TEST_DOMAIN_ID,
  TEST_IAM_USER_ID,
} from './helpers/test-db.helper';
const postgres = process.env.AF009_POSTGRES_TEST === 'true';
const pgIt = postgres ? it : it.skip;
describe(`Scheduling (${postgres ? 'PostgreSQL' : 'memory'})`, () => {
  let app: INestApplication;
  let db: DataSource;
  let reset: () => void;
  let manager: string;
  let customer: string;
  let technician: string;
  let centerId: string;
  let vehicleId: string;
  const date = addDays(istToday(), 1);
  const input = (): BookingSchedule => ({
    week: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      intervals: [
        { open: '09:00', close: '12:00' },
        { open: '14:00', close: '17:00' },
      ],
    })),
    exceptions: [],
    bookingEnabled: true,
    autoAccept: true,
    slotCapacity: 1,
    leadMinutes: 0,
    advanceDays: 7,
  });
  const http = () => request(app.getHttpServer() as Server);
  const staff = (req: request.Test, token = manager) =>
    req.set('Authorization', `Bearer ${token}`);
  const save = (body: BookingSchedule, revision = 1, key = randomUUID()) =>
    staff(http().put('/v1/center/booking-schedule'))
      .set('If-Match', String(revision))
      .set('Idempotency-Key', key)
      .send(body);
  const bookingBody = () => ({
    serviceCenterId: centerId,
    vehicleId,
    mode: 'SELF_CHECKIN',
    slotStart: `${date}T09:00:00+05:30`,
    slotEnd: `${date}T10:00:00+05:30`,
  });
  const book = (body = bookingBody(), key = randomUUID()) =>
    http()
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${customer}`)
      .set('Idempotency-Key', key)
      .send(body);
  const slots = (day = date) =>
    http().get(`/v1/centers/${centerId}/slots?date=${day}`);
  async function fixtures() {
    const tenancy = await seedTestTenancy(db);
    centerId = tenancy.serviceCenter.id;
    await http()
      .put('/v1/me/profile')
      .set('Authorization', `Bearer ${customer}`)
      .send({
        displayName: 'Slot tester',
        phone: '9876543210',
        dateOfBirth: '1994-03-12',
      })
      .expect(200);
    const v = await http()
      .post('/v1/me/vehicles')
      .set('Authorization', `Bearer ${customer}`)
      .send({
        vehicleType: 'TWO_WHEELER',
        make: 'Honda',
        model: 'Activa',
        registrationNumber: 'KA01AB1234',
      })
      .expect(201);
    vehicleId = v.body.id;
  }
  beforeAll(async () => {
    process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID = TEST_CUSTOMER_APP_ID;
    const jwt = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = jwt.jwksJson;
    manager = await jwt.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['manager'],
      permissions: ['center:manage', 'bookings:read'],
    });
    technician = await jwt.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['technician'],
      permissions: ['center:manage'],
    });
    customer = await jwt.signAccessToken({
      sub: TEST_CUSTOMER_IAM_USER_ID,
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      mobile: '9876543210',
      roles: ['customer'],
      permissions: [],
    });
    if (postgres) {
      db = new DataSource({
        type: 'postgres',
        host: '127.0.0.1',
        port: 55409,
        username: 'af009_test',
        password: 'af009_test',
        database: 'af009_test',
        entities: ENTITIES,
        migrations: MIGRATIONS,
        synchronize: false,
      });
      await db.initialize();
      const [identity] = await db.query('SELECT current_database() AS name');
      if (identity.name !== 'af009_test')
        throw new Error('Refusing to reset a non-AF009 test database');
      await db.query('DROP SCHEMA public CASCADE');
      await db.query('CREATE SCHEMA public');
      await db.runMigrations();
      app = await createApiApp(db);
      await app.listen(0, '127.0.0.1');
    } else {
      const ctx = await createE2eApp();
      app = ctx.app;
      db = ctx.dataSource;
      await app.listen(0, '127.0.0.1');
      await fixtures();
      const backup = ctx.memoryDb.backup();
      reset = () => backup.restore();
    }
  }, 60000);
  beforeEach(async () => {
    if (postgres) {
      await db.query(
        `TRUNCATE ${db.entityMetadatas.map((e) => `"${e.tableName}"`).join(', ')} RESTART IDENTITY CASCADE`,
      );
      await fixtures();
    } else reset();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
  });
  it('requires manager role, permission, version and idempotency key', async () => {
    await staff(http().get('/v1/center/booking-schedule'), technician).expect(
      403,
    );
    await http().get('/v1/center/booking-schedule').expect(401);
    await staff(http().put('/v1/center/booking-schedule'))
      .send(input())
      .expect(400);
    await save(input(), 5).expect(409);
  });
  it('starts with no notice and seven dates, and returns read-only availability metadata', async () => {
    const view = await staff(http().get('/v1/center/booking-schedule')).expect(
      200,
    );
    expect(view.body).toMatchObject({
      revision: 1,
      leadMinutes: 0,
      advanceDays: 7,
      slotMinutes: 60,
    });
    const result = await slots().expect(200);
    expect(result.body.lastDate).toBe(addDays(istToday(), 6));
    expect(result.body.slots).toHaveLength(8);
    expect(await db.getRepository(Booking).count()).toBe(0);
  });
  it('persists split hours and date closures, then opens an exceptional date', async () => {
    const preview = await staff(
      http().post(`/v1/center/booking-schedule/preview?date=${date}`),
    )
      .send(input())
      .expect(200);
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.body.slots).toHaveLength(6);
    expect(preview.body.slots[3].start).toBe(
      new Date(`${date}T14:00:00+05:30`).toISOString(),
    );
    expect(await db.getRepository(CommandIdempotency).count()).toBe(0);
    const body = input();
    body.exceptions = [{ date, intervals: [] }];
    await save(body).expect(200);
    expect((await slots().expect(200)).body.closed).toBe(true);
    await book().expect(409);
    body.exceptions[0].intervals = [{ open: '10:30', close: '12:45' }];
    await save(body, 2).expect(200);
    const result = await slots().expect(200);
    expect(result.body.slots).toHaveLength(2);
    expect(result.body.slots[0].start).toBe(
      new Date(`${date}T10:30:00+05:30`).toISOString(),
    );
  });
  it.each([
    {
      slotStart: `${date}T09:00:00.001+05:30`,
      slotEnd: `${date}T10:00:00.001+05:30`,
    },
    { slotStart: `${date}T09:30:00+05:30`, slotEnd: `${date}T10:30:00+05:30` },
    { slotEnd: `${date}T09:30:00+05:30` },
    { slotEnd: `${addDays(date, 1)}T10:00:00+05:30` },
    { slotStart: `${date}T12:00:00+05:30`, slotEnd: `${date}T13:00:00+05:30` },
  ])('rejects a forged/noncanonical slot %j', async (patch) => {
    await save(input()).expect(200);
    await book({ ...bookingBody(), ...patch }).expect(409);
    expect(await db.getRepository(Booking).count()).toBe(0);
    // pg-mem does not implement transaction rollback; PostgreSQL is the receipt atomicity gate.
    if (postgres)
      expect(await db.getRepository(CommandIdempotency).count()).toBe(1);
  });
  it('rejects impossible dates, horizon bypass, and too little notice', async () => {
    await slots('2027-02-29').expect(400);
    const far = addDays(istToday(), 7);
    expect(
      (await slots(far).expect(200)).body.slots.every(
        (s: { available: boolean }) => !s.available,
      ),
    ).toBe(true);
    await book({
      ...bookingBody(),
      slotStart: `${far}T09:00:00+05:30`,
      slotEnd: `${far}T10:00:00+05:30`,
    }).expect(409);
    await save({ ...input(), leadMinutes: 4320 }).expect(200);
    await book().expect(409);
  });
  it('replays schedule commands without another version or audit and rejects changed-body key reuse', async () => {
    const key = randomUUID();
    const first = await save(input(), 1, key).expect(200);
    await save({ ...input(), slotCapacity: 2 }, 2).expect(200);
    expect((await save(input(), 1, key).expect(200)).body).toEqual(first.body);
    expect(
      (await staff(http().get('/v1/center/booking-schedule')).expect(200)).body
        .revision,
    ).toBe(3);
    await save({ ...input(), slotCapacity: 3 }, 1, key).expect(422);
    expect(await db.getRepository(AuditLog).count()).toBe(2);
  });
  it('retains bookings across closures and reports impact; replays a booking even after closing', async () => {
    const key = randomUUID();
    const made = await book(bookingBody(), key).expect(201);
    const body = input();
    body.exceptions = [{ date, intervals: [] }];
    const saved = await save(body).expect(200);
    expect(saved.body.impact.outsideHours).toBe(1);
    expect((await book(bookingBody(), key).expect(201)).body.id).toBe(
      made.body.id,
    );
    expect(await db.getRepository(Booking).count()).toBe(1);
    await book().expect(409);
  });
  it('rejects grid shifts over existing bookings, preserves overcapacity visits and blocks new ones', async () => {
    await book().expect(201);
    const body = input();
    body.week.forEach((day) => {
      day.intervals = [{ open: '09:30', close: '17:30' }];
    });
    const rejected = await save(body).expect(409);
    expect(rejected.body.code).toBe('SCHEDULE_GRID_CONFLICT');
    await book().expect(409);
    expect(await db.getRepository(Booking).count()).toBe(1);
  });
  it('reduces capacity without deleting existing bookings and releases a cancelled place once', async () => {
    await save({ ...input(), slotCapacity: 2 }).expect(200);
    const first = await book().expect(201);
    await book().expect(201);
    const reduced = await save(input(), 2).expect(200);
    expect(reduced.body.impact.overCapacitySlots).toBe(1);
    expect(await db.getRepository(Booking).count()).toBe(2);
    expect((await slots().expect(200)).body.slots[0].remaining).toBe(0);
    await book().expect(409);
    await http()
      .post(`/v1/bookings/${first.body.id}/cancel`)
      .set('Authorization', `Bearer ${customer}`)
      .send({})
      .expect(200);
    await http()
      .post(`/v1/bookings/${first.body.id}/cancel`)
      .set('Authorization', `Bearer ${customer}`)
      .send({})
      .expect(409);
    expect((await slots().expect(200)).body.slots[0].remaining).toBe(0);
  });
  it('routes legacy hours and settings through versioned checks and capacity locking', async () => {
    await book().expect(201);
    await staff(http().put('/v1/center/hours'))
      .set('If-Match', '1')
      .set('Idempotency-Key', randomUUID())
      .send({
        days: [
          {
            dayOfWeek: new Date(`${date}T12:00:00Z`).getUTCDay(),
            isClosed: true,
          },
        ],
      })
      .expect(200);
    expect((await slots().expect(200)).body.closed).toBe(true);
    await staff(http().patch('/v1/center'))
      .set('If-Match', '1')
      .set('Idempotency-Key', randomUUID())
      .send({ slotCapacity: 2 })
      .expect(409);
    await staff(http().patch('/v1/center'))
      .set('If-Match', '2')
      .set('Idempotency-Key', randomUUID())
      .send({ slotCapacity: 2 })
      .expect(200);
  });
  pgIt(
    'serializes last-slot competitors and concurrent exact retries',
    async () => {
      const results = await Promise.all([book(), book()]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const key = randomUUID();
      const body = {
        ...bookingBody(),
        slotStart: `${date}T10:00:00+05:30`,
        slotEnd: `${date}T11:00:00+05:30`,
      };
      const repeated = await Promise.all([book(body, key), book(body, key)]);
      expect(repeated.map((r) => r.status)).toEqual([201, 201]);
      expect(repeated[0].body.id).toBe(repeated[1].body.id);
      expect(await db.getRepository(Booking).count()).toBe(2);
    },
  );
  pgIt(
    'rechecks the clock after waiting for the reservation lock',
    async () => {
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.manager.getRepository(ServiceCenter).findOne({
          where: { id: centerId },
          lock: { mode: 'pessimistic_write' },
        });
        const waiting = book().then((response) => response);
        // Wait until PostgreSQL reports the actual waiter instead of relying on a fixed delay.
        for (let i = 0; i < 100; i++) {
          const rows = await db.query(
            "SELECT pid FROM pg_stat_activity WHERE datname='af009_test' AND wait_event_type='Lock'",
          );
          if (rows.length) break;
          if (i === 99) throw new Error('Booking never waited for center lock');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        jest
          .spyOn(Date, 'now')
          .mockReturnValue(Date.parse(`${date}T09:00:00+05:30`));
        await runner.commitTransaction();
        const result = await waiting;
        expect(result.status).toBe(409);
        expect(await db.getRepository(Booking).count()).toBe(0);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await runner.release();
      }
    },
  );
  pgIt(
    'rolls back the schedule and audit when the receipt write fails',
    async () => {
      await db.query(
        "CREATE FUNCTION af009_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'receipt failure'; END $$",
      );
      await db.query(
        'CREATE TRIGGER af009_fail_receipt BEFORE UPDATE ON command_idempotency FOR EACH ROW EXECUTE FUNCTION af009_fail_receipt()',
      );
      try {
        await save(input()).expect(500);
        expect(
          (await staff(http().get('/v1/center/booking-schedule')).expect(200))
            .body.revision,
        ).toBe(1);
        expect(await db.getRepository(AuditLog).count()).toBe(0);
        expect(await db.getRepository(CommandIdempotency).count()).toBe(0);
      } finally {
        await db.query(
          'DROP TRIGGER af009_fail_receipt ON command_idempotency',
        );
        await db.query('DROP FUNCTION af009_fail_receipt()');
      }
    },
  );
  pgIt(
    'serializes competing schedule edits and a concurrent closure/reservation',
    async () => {
      const edits = await Promise.all([
        save(input()),
        save({ ...input(), slotCapacity: 2 }),
      ]);
      expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
      const closed = input();
      closed.exceptions = [{ date, intervals: [] }];
      const [changed, reserved] = await Promise.all([save(closed, 2), book()]);
      expect(changed.status).toBe(200);
      expect([201, 409]).toContain(reserved.status);
      expect((await slots().expect(200)).body.closed).toBe(true);
      expect(await db.getRepository(Booking).count()).toBe(
        reserved.status === 201 ? 1 : 0,
      );
      expect(changed.body.impact.outsideHours).toBe(
        reserved.status === 201 ? 1 : 0,
      );
    },
  );
  pgIt(
    'a rejected booking key succeeds after the scheduling restriction is removed',
    async () => {
      const key = randomUUID();
      const closed = input();
      closed.exceptions = [{ date, intervals: [] }];
      await save(closed).expect(200);
      await book(bookingBody(), key).expect(409);
      expect(await db.getRepository(CommandIdempotency).count()).toBe(1);
      await save(input(), 2).expect(200);
      await book(bookingBody(), key).expect(201);
      expect(await db.getRepository(Booking).count()).toBe(1);
    },
  );
  pgIt('rolls back schedule changes when audit insertion fails', async () => {
    await db.query(
      "CREATE FUNCTION af009_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$",
    );
    await db.query(
      'CREATE TRIGGER af009_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION af009_fail_audit()',
    );
    try {
      await save(input()).expect(500);
      expect(
        (await staff(http().get('/v1/center/booking-schedule')).expect(200))
          .body.revision,
      ).toBe(1);
      expect(await db.getRepository(CommandIdempotency).count()).toBe(0);
    } finally {
      await db.query('DROP TRIGGER af009_fail_audit ON audit_logs');
      await db.query('DROP FUNCTION af009_fail_audit()');
    }
  });
  pgIt(
    'rolls back a reservation when its transactional receipt cannot commit',
    async () => {
      await db.query(
        "CREATE FUNCTION af009_fail_booking_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'booking receipt failure'; END $$",
      );
      await db.query(
        'CREATE TRIGGER af009_fail_booking_receipt BEFORE UPDATE ON command_idempotency FOR EACH ROW EXECUTE FUNCTION af009_fail_booking_receipt()',
      );
      const key = randomUUID();
      try {
        await book(bookingBody(), key).expect(500);
        expect(await db.getRepository(Booking).count()).toBe(0);
        expect(await db.getRepository(CommandIdempotency).count()).toBe(0);
      } finally {
        await db.query(
          'DROP TRIGGER af009_fail_booking_receipt ON command_idempotency',
        );
        await db.query('DROP FUNCTION af009_fail_booking_receipt()');
      }
      await book(bookingBody(), key).expect(201);
    },
  );
});
