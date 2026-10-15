import { createHash, randomUUID } from 'crypto';
import { Server } from 'http';
import { INestApplication } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import request from 'supertest';
import { ENTITIES } from '../src/database/entities';
import { MIGRATIONS } from '../src/database/migration-list';
import { ReturningWalkIn1730000000011 } from '../src/database/migrations/1730000000011-ReturningWalkIn';
import { VehicleType } from '../src/common/enums/vehicle-type.enum';
import { JobStatus } from '../src/common/enums/job-status.enum';
import { Customer } from '../src/modules/customers/entities/customer.entity';
import { Vehicle } from '../src/modules/customers/entities/vehicle.entity';
import { CustomerProfile } from '../src/modules/customers/entities/customer-profile.entity';
import { GarageVehicle } from '../src/modules/customers/entities/garage-vehicle.entity';
import { Booking } from '../src/modules/bookings/entities/booking.entity';
import { BookingItem } from '../src/modules/bookings/entities/booking-item.entity';
import { JobLineItem } from '../src/modules/jobs/entities/job-line-item.entity';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { BookingMode } from '../src/common/enums/booking-mode.enum';
import { GarageVehicleStatus } from '../src/common/enums/garage-vehicle-status.enum';
import { ServiceJob } from '../src/modules/jobs/entities/service-job.entity';
import { ServiceCenter } from '../src/modules/tenancy/entities/service-center.entity';
import { EventsService } from '../src/modules/events/events.service';
import { AuditLog } from '../src/modules/events/entities/audit-log.entity';
import { ServiceJobEvent } from '../src/modules/events/entities/service-job-event.entity';
import { CommandIdempotency } from '../src/modules/idempotency/command-idempotency.entity';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { CenterBookingsService } from '../src/modules/bookings/center-bookings.service';
import { IntakeService } from '../src/modules/jobs/intake.service';
import { createJwtTestFixture } from '../src/test-utils/jwt-test.helper';
import { createApiApp, createE2eApp } from './helpers/e2e-app.helper';
import { seedReturningWalkIn } from './helpers/returning-walk-in.helper';
import {
  seedTestTenancy,
  TEST_DOMAIN_ID,
  TEST_IAM_USER_ID,
  TEST_OTHER_DOMAIN_ID,
  TEST_OTHER_USER_ID,
  TEST_CUSTOMER_APP_ID,
  TEST_CUSTOMER_DOMAIN_ID,
  TEST_CUSTOMER_IAM_USER_ID,
} from './helpers/test-db.helper';

const postgres = process.env.AF006_POSTGRES_TEST === 'true';
const pgIt = postgres ? it : it.skip;
type Intake = Awaited<ReturnType<typeof seedReturningWalkIn>>;
const creationHash = (body: unknown) =>
  createHash('sha256')
    .update(`POST /v1/jobs ${JSON.stringify(body)}`)
    .digest('hex');

describe(`Returning walk-ins (${postgres ? 'PostgreSQL' : 'memory'} API)`, () => {
  let app: INestApplication;
  let db: DataSource;
  let reset: () => void;
  let centerId: string;
  let staffId: string;
  let returning: Intake;
  let another: Intake;
  let token: string;
  let createOnly: string;
  let readOnly: string;
  let technician: string;
  let other: string;
  let customerToken: string;
  let events: EventsService;

  const http = () => request(app.getHttpServer() as Server);
  const as = (req: request.Test, bearer = token) =>
    req.set('Authorization', `Bearer ${bearer}`);
  const lookup = (phone: string, bearer = token) =>
    as(http().post('/v1/center/customers/lookup'), bearer).send({ phone });
  const body = (selection = returning.selection) => ({
    ...selection,
    serviceType: 'Periodic service',
    customerRequest: 'Please inspect the brakes',
    odometerKm: 12000,
  });
  const create = (
    value: Record<string, unknown> = body(),
    key = randomUUID(),
    bearer = token,
  ) =>
    as(http().post('/v1/jobs'), bearer).set('Idempotency-Key', key).send(value);
  const plateLookup = (
    registrationNumber: string,
    id = returning.customer.id,
    bearer = token,
  ) =>
    as(http().post(`/v1/center/customers/${id}/vehicle-lookup`), bearer).send({
      registrationNumber,
    });
  const attempts = (key: string, value: unknown, bearer = token) =>
    as(http().post('/v1/center/walk-ins/attempt-status'), bearer).send({
      idempotencyKey: key,
      requestHash: creationHash(value),
    });
  const counts = () =>
    Promise.all(
      [
        Customer,
        Vehicle,
        ServiceJob,
        AuditLog,
        ServiceJobEvent,
        CommandIdempotency,
      ].map((entity) => db.getRepository(entity).count()),
    );
  const fixtures = async () => {
    const tenancy = await seedTestTenancy(db);
    centerId = tenancy.serviceCenter.id;
    staffId = tenancy.staffProfile.id;
    await db.getRepository(ServiceCenter).update(centerId, {
      supportedVehicleTypes: [
        VehicleType.TWO_WHEELER,
        VehicleType.FOUR_WHEELER,
      ],
    });
    returning = await seedReturningWalkIn(db, centerId, {
      name: 'Returning owner',
      registrationNumber: 'KA01AB1234',
    });
    another = await seedReturningWalkIn(db, centerId, {
      phone: '+919123456780',
      name: 'Other private owner',
      registrationNumber: 'KA02CD5678',
    });
  };

  beforeAll(async () => {
    process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID = TEST_CUSTOMER_APP_ID;
    const jwt = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = jwt.jwksJson;
    if (postgres) {
      db = new DataSource({
        type: 'postgres',
        host: '127.0.0.1',
        port: 55406,
        username: 'af006_test',
        password: 'af006_test',
        database: 'af006_test',
        entities: ENTITIES,
        migrations: MIGRATIONS,
        synchronize: false,
      });
      await db.initialize();
      const [identity] = await db.query('SELECT current_database() AS name');
      if (
        identity.name !== 'af006_test' ||
        db.options.database !== 'af006_test'
      )
        throw new Error('Refusing to reset a non-AF006 test database');
      await db.query('DROP SCHEMA public CASCADE');
      await db.query('CREATE SCHEMA public');
      await db.runMigrations();
      app = await createApiApp(db);
    } else {
      const context = await createE2eApp();
      app = context.app;
      db = context.dataSource;
      await fixtures();
      const backup = context.memoryDb.backup();
      reset = () => backup.restore();
    }
    events = app.get(EventsService);
    const sign = (roles: string[], permissions: string[]) =>
      jwt.signAccessToken({
        sub: TEST_IAM_USER_ID,
        domainId: TEST_DOMAIN_ID,
        roles,
        permissions,
      });
    token = await sign(
      ['advisor'],
      ['jobs:create', 'jobs:read', 'jobs:update', 'bookings:manage'],
    );
    createOnly = await sign(['advisor'], ['jobs:create']);
    readOnly = await sign(['manager'], ['jobs:read']);
    technician = await sign(['technician'], ['jobs:create', 'jobs:read']);
    other = await jwt.signAccessToken({
      sub: TEST_OTHER_USER_ID,
      domainId: TEST_OTHER_DOMAIN_ID,
      roles: ['advisor'],
      permissions: ['jobs:create', 'jobs:read'],
    });
    customerToken = await jwt.signAccessToken({
      sub: TEST_CUSTOMER_IAM_USER_ID,
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      mobile: '9876543210',
      roles: ['customer'],
      permissions: ['jobs:create'],
    });
  });
  beforeEach(async () => {
    if (postgres) {
      const tables = db.entityMetadatas
        .map((entity) => `"${entity.tableName.replace(/"/g, '""')}"`)
        .join(', ');
      await db.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
      await fixtures();
    } else reset();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
  });

  it('requires both an intake desk role and jobs:create for lookup and create', async () => {
    await http()
      .post('/v1/center/customers/lookup')
      .send({ phone: '9876543210' })
      .expect(401);
    for (const bearer of [readOnly, technician, customerToken]) {
      await lookup('9876543210', bearer).expect(403);
      await create(body(), randomUUID(), bearer).expect(403);
    }
    expect(await db.getRepository(ServiceJob).count()).toBe(0);
  });

  it.each(['9876543210', '+91 98765-43210', '919876543210'])(
    'normalizes %s without returning IAM/profile identifiers or history',
    async (phone) => {
      const result = await lookup(phone).expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body.status).toBe('FOUND');
      expect(result.body.customer).toEqual({
        id: returning.customer.id,
        revision: 1,
        name: 'Returning owner',
        phone: '+919876543210',
        accountLinkState: 'ACCOUNT_LINKED',
      });
      expect(JSON.stringify(result.body)).not.toContain(returning.profile.id);
      expect(JSON.stringify(result.body)).not.toContain(
        returning.profile.iamUserId,
      );
    },
  );

  it.each([
    '+449876543210',
    '00919876543210',
    '1234567890',
    '987654321011',
    '98765abc10',
  ])('rejects malformed phone %s rather than truncating', async (phone) =>
    lookup(phone).expect(400),
  );

  it('does not expose another center through exact phone lookup or selected IDs', async () => {
    expect((await lookup('9876543210', other).expect(200)).body.status).toBe(
      'NOT_FOUND',
    );
    await as(
      http().get(`/v1/center/customers/${returning.customer.id}/vehicles`),
      other,
    ).expect(404);
    await plateLookup('KA01AB1234', returning.customer.id, other).expect(404);
    await create(body(), randomUUID(), other).expect(404);
  });

  it('shows a linkage handoff for an unlinked center contact and refuses job creation', async () => {
    await db.getRepository(Customer).update(returning.customer.id, {
      customerProfileId: null,
      revision: 2,
    });
    const found = await lookup('9876543210').expect(200);
    expect(found.body.customer.accountLinkState).toBe('LINK_REQUIRED');
    const result = await create({ ...body(), customerRevision: 2 }).expect(409);
    expect(result.body.code).toBe('ACCOUNT_LINK_REQUIRED');
    expect(await db.getRepository(ServiceJob).count()).toBe(0);
  });

  it('detects canonical phone collisions without choosing or merging a contact', async () => {
    await db.getRepository(Customer).save({
      serviceCenterId: centerId,
      phone: '98765 43210',
      phoneCanonical: '+919876543210',
      name: 'Legacy duplicate',
    });
    const result = await lookup('9876543210').expect(409);
    expect(result.body.code).toBe('CUSTOMER_LOOKUP_AMBIGUOUS');
    expect(JSON.stringify(result.body)).not.toContain('Legacy duplicate');
    await create().expect(409);
  });

  it('paginates saved vehicles and supports normalized exact plate lookup', async () => {
    await db.getRepository(Vehicle).save({
      serviceCenterId: centerId,
      customerId: returning.customer.id,
      registrationNumber: 'KA03EF9012',
      registrationCanonical: 'KA03EF9012',
      vehicleType: VehicleType.FOUR_WHEELER,
    });
    const first = await as(
      http().get(
        `/v1/center/customers/${returning.customer.id}/vehicles?limit=1`,
      ),
    ).expect(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await as(
      http()
        .get(`/v1/center/customers/${returning.customer.id}/vehicles`)
        .query({ limit: 1, cursor: first.body.nextCursor }),
    ).expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    expect(second.body.nextCursor).toBeNull();
    const exact = await plateLookup(' ka-01 ab 1234 ').expect(200);
    expect(exact.body.vehicle.id).toBe(returning.vehicle.id);
    expect(exact.body.customerRevision).toBe(1);
  });

  it('blind-blocks a plate or vehicle ID belonging to a different customer', async () => {
    for (const result of [
      await plateLookup('KA02CD5678').expect(409),
      await create({ ...body(), vehicleId: another.vehicle.id }).expect(409),
      await create({
        customerId: returning.customer.id,
        customerRevision: 1,
        newVehicle: {
          registrationNumber: 'ka-02 cd 5678',
          vehicleType: 'TWO_WHEELER',
        },
        serviceType: 'Repair',
      }).expect(409),
    ]) {
      expect(result.body.code).toBe('VEHICLE_CUSTOMER_CONFLICT');
      for (const secret of [
        another.customer.id,
        another.profile.id,
        another.customer.phone,
        'Other private owner',
      ])
        expect(JSON.stringify(result.body)).not.toContain(secret);
    }
    expect(
      (
        await db
          .getRepository(Vehicle)
          .findOneByOrFail({ id: another.vehicle.id })
      ).customerId,
    ).toBe(another.customer.id);
    expect(await db.getRepository(ServiceJob).count()).toBe(0);
  });

  it('detects all normalized plate collisions, even when they share a customer', async () => {
    await db.getRepository(Vehicle).save({
      serviceCenterId: centerId,
      customerId: returning.customer.id,
      registrationNumber: 'ka-01 ab 1234',
      registrationCanonical: 'KA01AB1234',
    });
    const result = await plateLookup('KA01AB1234').expect(409);
    expect(result.body.code).toBe('VEHICLE_LOOKUP_AMBIGUOUS');
    await create().expect(409);
  });

  it('rejects stale customer and vehicle confirmations without identity mutation', async () => {
    const original = await counts();
    const customerResult = await create({
      ...body(),
      customerRevision: 99,
    }).expect(409);
    expect(customerResult.body.code).toBe('CUSTOMER_SELECTION_CHANGED');
    const vehicleResult = await create({
      ...body(),
      vehicleRevision: 99,
    }).expect(409);
    expect(vehicleResult.body.code).toBe('VEHICLE_SELECTION_CHANGED');
    const after = await counts();
    // pg-mem does not roll back receipt inserts; PostgreSQL is the transaction gate.
    expect(postgres ? after : after.slice(0, -1)).toEqual(
      postgres ? original : original.slice(0, -1),
    );
  });

  it('rejects deleted customer, vehicle and account selections without opening a visit', async () => {
    await db.getRepository(Vehicle).softDelete(returning.vehicle.id);
    await create().expect(404);
    await db.getRepository(Customer).softDelete(another.customer.id);
    await create(body(another.selection)).expect(404);
    await db.getRepository(CustomerProfile).softDelete(returning.profile.id);
    const result = await create().expect(409);
    expect(result.body.code).toBe('ACCOUNT_LINK_REQUIRED');
    expect(await db.getRepository(ServiceJob).count()).toBe(0);
  });

  it('rejects malformed visit details and nested identity fields on the API', async () => {
    for (const invalid of [
      { ...body(), serviceType: '   ' },
      { ...body(), estimatedReadyAt: 'not-a-date' },
      { ...body(), odometerKm: -1 },
      { ...body(), budgetCeiling: 0.001 },
      { ...body(), customerRequest: 'x'.repeat(2001) },
      {
        customerId: returning.customer.id,
        customerRevision: 1,
        newVehicle: {
          registrationNumber: 'KA02XX5678',
          vehicleType: 'TWO_WHEELER',
          customerProfileId: returning.profile.id,
        },
        serviceType: 'Repair',
      },
    ])
      await create(invalid).expect(400);
    expect(await db.getRepository(ServiceJob).count()).toBe(0);
  });

  it('does not let center type confirmation contradict a linked owner garage', async () => {
    const garage = await db.getRepository(GarageVehicle).save({
      customerProfileId: returning.profile.id,
      vehicleType: VehicleType.FOUR_WHEELER,
      registrationNumber: returning.vehicle.registrationNumber,
      make: 'Hyundai',
      model: 'i20',
    });
    await db.getRepository(Vehicle).update(returning.vehicle.id, {
      garageVehicleId: garage.id,
      vehicleType: null,
      revision: 2,
    });
    const result = await create({
      ...body(),
      vehicleRevision: 2,
      confirmedVehicleType: 'TWO_WHEELER',
    }).expect(422);
    expect(result.body.code).toBe('VEHICLE_TYPE_CONFLICT');
    expect(
      (
        await db
          .getRepository(Vehicle)
          .findOneByOrFail({ id: returning.vehicle.id })
      ).vehicleType,
    ).toBeNull();
    expect(await db.getRepository(ServiceJob).count()).toBe(0);
  });

  it('blocks a linked archived vehicle until the owner reactivates it', async () => {
    const garage = await db.getRepository(GarageVehicle).save({
      customerProfileId: returning.profile.id,
      vehicleType: VehicleType.TWO_WHEELER,
      registrationNumber: returning.vehicle.registrationNumber,
      make: 'Honda',
      model: 'Activa',
      status: GarageVehicleStatus.ARCHIVED,
    });
    await db.getRepository(Vehicle).update(returning.vehicle.id, {
      garageVehicleId: garage.id,
      revision: 2,
    });
    await create({ ...body(), vehicleRevision: 2 }).expect(422);
    expect(await db.getRepository(ServiceJob).count()).toBe(0);
    await db
      .getRepository(GarageVehicle)
      .update(garage.id, { status: GarageVehicleStatus.ACTIVE });
    await create({ ...body(), vehicleRevision: 2 }).expect(201);
    expect(await db.getRepository(ServiceJob).count()).toBe(1);
  });

  it('cannot bypass an archived owner garage by capturing the same plate as another center vehicle', async () => {
    await db.getRepository(GarageVehicle).save({
      customerProfileId: returning.profile.id,
      vehicleType: VehicleType.TWO_WHEELER,
      registrationNumber: 'KA09ST7890',
      make: 'Honda',
      model: 'Activa',
      status: GarageVehicleStatus.ARCHIVED,
    });
    await create({
      customerId: returning.customer.id,
      customerRevision: 1,
      newVehicle: {
        registrationNumber: 'ka-09 st 7890',
        vehicleType: 'TWO_WHEELER',
      },
      serviceType: 'Repair',
    }).expect(422);
    expect(await db.getRepository(Vehicle).count()).toBe(2);
    expect(await db.getRepository(ServiceJob).count()).toBe(0);
  });

  it('checks an archived same-owner garage even when the existing center vehicle is not linked to it', async () => {
    await db.getRepository(GarageVehicle).save({
      customerProfileId: returning.profile.id,
      vehicleType: VehicleType.TWO_WHEELER,
      registrationNumber: returning.vehicle.registrationNumber,
      make: 'Honda',
      model: 'Activa',
      status: GarageVehicleStatus.ARCHIVED,
    });
    const before = await db
      .getRepository(Vehicle)
      .findOneByOrFail({ id: returning.vehicle.id });
    expect(before.garageVehicleId).toBeNull();
    const result = await create().expect(422);
    expect(result.body.code).toBe('VEHICLE_ARCHIVED');
    expect(
      await db.getRepository(Vehicle).findOneByOrFail({ id: before.id }),
    ).toEqual(before);
    expect(await db.getRepository(ServiceJob).count()).toBe(0);
  });

  it('checks the known type against an existing same-owner garage without silently linking it', async () => {
    await db.getRepository(GarageVehicle).save({
      customerProfileId: returning.profile.id,
      vehicleType: VehicleType.FOUR_WHEELER,
      registrationNumber: returning.vehicle.registrationNumber,
      make: 'Hyundai',
      model: 'i20',
    });
    const before = await db
      .getRepository(Vehicle)
      .findOneByOrFail({ id: returning.vehicle.id });
    const result = await create().expect(422);
    expect(result.body.code).toBe('VEHICLE_TYPE_CONFLICT');
    expect(
      await db.getRepository(Vehicle).findOneByOrFail({ id: before.id }),
    ).toEqual(before);
    expect(await db.getRepository(ServiceJob).count()).toBe(0);
  });

  it('requires exactly one selector and a valid key, and rejects old raw identity mutation', async () => {
    await as(http().post('/v1/jobs')).send(body()).expect(400);
    await as(http().post('/v1/jobs'))
      .set('Idempotency-Key', 'x')
      .send(body())
      .expect(400);
    await create({
      ...body(),
      newVehicle: {
        registrationNumber: 'KA04GH3456',
        vehicleType: 'TWO_WHEELER',
      },
    }).expect(400);
    await create({
      customerId: returning.customer.id,
      customerRevision: 1,
      serviceType: 'Service',
    }).expect(400);
    await create({
      customerPhone: '+919876543210',
      customerName: 'Overwritten',
      vehicleRegistration: 'KA01AB1234',
      serviceType: 'Service',
    }).expect(400);
    await create({ ...body(), customerName: 'Overwritten' }).expect(400);
    await as(http().post('/v1/jobs'))
      .set('Idempotency-Key', `${randomUUID()}, ${randomUUID()}`)
      .send(body())
      .expect(400);
    expect(
      (
        await db
          .getRepository(Customer)
          .findOneByOrFail({ id: returning.customer.id })
      ).name,
    ).toBe('Returning owner');
    expect(await db.getRepository(ServiceJob).count()).toBe(0);
  });

  it('replays a known legacy create receipt narrowly without accepting new raw intake', async () => {
    const selected = await create().expect(201);
    const job = await db
      .getRepository(ServiceJob)
      .findOneByOrFail({ id: selected.body.id });
    const legacy = {
      customerPhone: '+919876543210',
      customerName: 'An old typed name',
      vehicleRegistration: 'KA01AB1234',
      serviceType: 'Periodic service',
    };
    const key = randomUUID();
    await db.getRepository(CommandIdempotency).save({
      scope: `staff:${staffId}`,
      idempotencyKey: key,
      requestHash: creationHash(legacy),
      responseStatus: 201,
      responseBody: {
        id: job.id,
        jobNumber: job.jobNumber,
        status: job.status,
        publicToken: job.publicToken,
        version: 1,
      },
    });
    const replay = await create(legacy, key).expect(201);
    expect(replay.body).toEqual(selected.body);
    expect(JSON.stringify(replay.body)).not.toContain(job.publicToken);
    expect(await db.getRepository(ServiceJob).count()).toBe(1);
    await create(legacy).expect(400);
  });

  it('requires explicit unknown-type confirmation and rejects a known conflicting type', async () => {
    await db
      .getRepository(Vehicle)
      .update(returning.vehicle.id, { vehicleType: null, revision: 2 });
    const unknown = await create({ ...body(), vehicleRevision: 2 }).expect(422);
    expect(unknown.body.code).toBe('VEHICLE_TYPE_REQUIRED');
    const success = await create({
      ...body(),
      vehicleRevision: 2,
      confirmedVehicleType: 'FOUR_WHEELER',
    }).expect(201);
    const job = await db
      .getRepository(ServiceJob)
      .findOneByOrFail({ id: success.body.id });
    expect(job.vehicleType).toBe('FOUR_WHEELER');
    const saved = await db
      .getRepository(Vehicle)
      .findOneByOrFail({ id: returning.vehicle.id });
    expect(saved.vehicleType).toBe('FOUR_WHEELER');
    expect(saved.revision).toBeGreaterThan(2);
    const conflict = await create({
      ...body(another.selection),
      confirmedVehicleType: 'FOUR_WHEELER',
    }).expect(422);
    expect(conflict.body.code).toBe('VEHICLE_TYPE_CONFLICT');
  });

  it('checks the center vehicle capability on the backend', async () => {
    await db
      .getRepository(ServiceCenter)
      .update(centerId, { supportedVehicleTypes: [VehicleType.TWO_WHEELER] });
    await db.getRepository(Vehicle).update(returning.vehicle.id, {
      vehicleType: VehicleType.FOUR_WHEELER,
      revision: 2,
    });
    const result = await create({ ...body(), vehicleRevision: 2 }).expect(422);
    expect(result.body.code).toBe('VEHICLE_TYPE_CONFLICT');
    expect(await db.getRepository(ServiceJob).count()).toBe(0);
  });

  it('returns only a non-secret reference, preserves saved identity and exactly replays one key', async () => {
    const originalCustomer = await db
      .getRepository(Customer)
      .findOneByOrFail({ id: returning.customer.id });
    const originalVehicle = await db
      .getRepository(Vehicle)
      .findOneByOrFail({ id: returning.vehicle.id });
    const key = randomUUID();
    const value = body();
    const first = await create(value, key).expect(201);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(Object.keys(first.body as Record<string, unknown>).sort()).toEqual([
      'id',
      'jobNumber',
      'status',
    ]);
    expect((await create(value, key).expect(201)).body).toEqual(first.body);
    const changed = await create({ ...value, odometerKm: 12001 }, key).expect(
      422,
    );
    expect(JSON.stringify(changed.body)).not.toContain(returning.profile.id);
    expect(await db.getRepository(ServiceJob).count()).toBe(1);
    expect(
      await db
        .getRepository(Customer)
        .findOneByOrFail({ id: returning.customer.id }),
    ).toEqual(originalCustomer);
    expect(
      await db
        .getRepository(Vehicle)
        .findOneByOrFail({ id: returning.vehicle.id }),
    ).toEqual(originalVehicle);
    const saved = await db
      .getRepository(ServiceJob)
      .findOneByOrFail({ id: first.body.id });
    expect(saved.publicToken).toBeTruthy();
    expect(
      JSON.stringify(await db.getRepository(CommandIdempotency).find()),
    ).not.toContain(saved.publicToken);
    expect(
      JSON.stringify(await db.getRepository(AuditLog).find()),
    ).not.toContain(saved.publicToken);
  });

  it('permits creation without jobs:read but does not disclose an active job reference', async () => {
    const first = await create(body(), randomUUID(), createOnly).expect(201);
    expect(Object.keys(first.body as Record<string, unknown>).sort()).toEqual([
      'id',
      'jobNumber',
      'status',
    ]);
    const result = await as(
      http().get(`/v1/center/customers/${returning.customer.id}/vehicles`),
      createOnly,
    ).expect(200);
    expect(result.body.items[0].hasActiveJob).toBe(true);
    expect(result.body.items[0].activeJob).toBeUndefined();
    const conflict = await create(body(), randomUUID(), createOnly).expect(409);
    expect(conflict.body.code).toBe('ACTIVE_JOB_EXISTS');
    expect(JSON.stringify(conflict.body)).not.toContain(first.body.id);
  });

  it('refuses a second active card and offers the existing reference only to jobs:read', async () => {
    const first = await create().expect(201);
    const second = await create().expect(409);
    expect(second.body.code).toBe('ACTIVE_JOB_EXISTS');
    expect(JSON.stringify(second.body)).toContain(first.body.id);
    expect(await db.getRepository(ServiceJob).count()).toBe(1);
  });

  it('keeps POST lookups and attempt checks read-only even with an idempotency key', async () => {
    const key = randomUUID();
    const before = await counts();
    await as(http().post('/v1/center/customers/lookup'))
      .set('Idempotency-Key', key)
      .send({ phone: '9876543210' })
      .expect(200);
    await as(
      http().post(
        `/v1/center/customers/${returning.customer.id}/vehicle-lookup`,
      ),
    )
      .set('Idempotency-Key', key)
      .send({ registrationNumber: 'KA01AB1234' })
      .expect(200);
    const unresolved = await as(
      http().post('/v1/center/walk-ins/attempt-status'),
    )
      .set('Idempotency-Key', key)
      .send({ idempotencyKey: key, requestHash: creationHash(body()) })
      .expect(200);
    expect(unresolved.body.status).toBe('UNRESOLVED');
    expect(await counts()).toEqual(before);
  });

  it.each([JobStatus.COMPLETED, JobStatus.CANCELLED])(
    'recovers the created reference after the job becomes %s',
    async (status) => {
      const key = randomUUID(),
        value = body();
      const first = await create(value, key).expect(201);
      await db
        .getRepository(ServiceJob)
        .update(first.body.id as string, { status, closedAt: new Date() });
      const result = await attempts(key, value).expect(200);
      expect(result.body).toEqual({
        status: 'CREATED',
        job: { id: first.body.id, jobNumber: first.body.jobNumber, status },
      });
      expect(await db.getRepository(ServiceJob).count()).toBe(1);
    },
  );

  it('scopes attempt results to actor/center and never recreates a deleted result', async () => {
    const key = randomUUID(),
      value = body();
    const first = await create(value, key).expect(201);
    expect((await attempts(key, value, other).expect(200)).body.status).toBe(
      'UNRESOLVED',
    );
    await attempts(key, { ...value, odometerKm: 1 }).expect(422);
    await db.getRepository(ServiceJob).softDelete(first.body.id as string);
    await create(value, key).expect(404);
    await attempts(key, value).expect(404);
    expect(
      await db.getRepository(ServiceJob).count({ withDeleted: true }),
    ).toBe(1);
  });

  it('requires confirmation when a proposed new plate already exists for this customer', async () => {
    const result = await create({
      customerId: returning.customer.id,
      customerRevision: 1,
      newVehicle: {
        registrationNumber: 'ka-01 ab 1234',
        vehicleType: 'TWO_WHEELER',
      },
      serviceType: 'Service',
    }).expect(409);
    expect(result.body.code).toBe('VEHICLE_SELECTION_CHANGED');
    expect(await db.getRepository(Vehicle).count()).toBe(2);
  });

  it('checks comeback customer/vehicle association instead of trusting a completed reference', async () => {
    const prior = await create(body(another.selection)).expect(201);
    await db.getRepository(ServiceJob).update(prior.body.id as string, {
      status: JobStatus.COMPLETED,
      closedAt: new Date(),
    });
    const result = await create({
      ...body(),
      comebackOfJobId: prior.body.id,
      comebackReason: 'Same fault returned',
      warrantyIntent: true,
    }).expect(422);
    expect(result.body.code).toBe('COMEBACK_REFERENCE_INVALID');
    expect(await db.getRepository(ServiceJob).count()).toBe(1);
  });

  async function booked(
    profile = returning.profile,
    plate = returning.vehicle.registrationNumber,
  ) {
    const garage = await db.getRepository(GarageVehicle).save({
      customerProfileId: profile.id,
      registrationNumber: plate,
      make: 'Honda',
      model: 'Activa',
      vehicleType: VehicleType.TWO_WHEELER,
      currentOdometerKm: 9000,
    });
    const booking = await db.getRepository(Booking).save({
      serviceCenterId: centerId,
      customerProfileId: profile.id,
      vehicleId: garage.id,
      mode: BookingMode.SELF_CHECKIN,
      status: BookingStatus.AWAITING_ARRIVAL,
      slotStart: new Date('2027-06-15T03:30:00Z'),
      slotEnd: new Date('2027-06-15T04:30:00Z'),
      estimateInr: '1250.00',
      issueDescription: 'Saved booking notes',
    });
    const scope = [
      {
        offeringId: randomUUID(),
        serviceDefinitionId: null,
        name: 'Saved oil change',
        description: 'Scope captured at booking',
        quantity: 2,
      },
    ];
    const item = await db.getRepository(BookingItem).save({
      bookingId: booking.id,
      name: 'Basic package',
      priceInr: '1250.00',
      durationMinutes: 60,
      scope,
      menuVersion: 3,
    });
    return { garage, booking, item, scope };
  }
  const checkIn = (id: string) =>
    as(http().post(`/v1/center/bookings/${id}/check-in`)).send({
      odometerKm: 9500,
    });

  it.each(['profile', 'garage'])(
    'refuses check-in after its %s is soft-deleted without losing the booking scope',
    async (record) => {
      const incoming = await booked();
      if (record === 'profile')
        await db
          .getRepository(CustomerProfile)
          .softDelete(returning.profile.id);
      else await db.getRepository(GarageVehicle).softDelete(incoming.garage.id);
      const before = await counts();
      const savedItem = await db
        .getRepository(BookingItem)
        .findOneByOrFail({ id: incoming.item.id });
      const result = await checkIn(incoming.booking.id).expect(422);
      expect(result.body.code).toBe('ACCOUNT_LINK_REQUIRED');
      expect(await counts()).toEqual(before);
      expect(
        await db
          .getRepository(Booking)
          .findOneByOrFail({ id: incoming.booking.id }),
      ).toEqual(incoming.booking);
      expect(
        await db
          .getRepository(BookingItem)
          .findOneByOrFail({ id: incoming.item.id }),
      ).toEqual(savedItem);
      expect(await db.getRepository(JobLineItem).count()).toBe(0);
    },
  );

  it('booking check-in cannot replace an existing linked profile just because the phone matches', async () => {
    const impostor = await db.getRepository(CustomerProfile).save({
      iamUserId: randomUUID(),
      phone: returning.profile.phone,
      displayName: 'Different account',
    });
    const incoming = await booked(impostor);
    const original = await db
      .getRepository(Customer)
      .findOneByOrFail({ id: returning.customer.id });
    const result = await checkIn(incoming.booking.id).expect(409);
    expect(JSON.stringify(result.body)).not.toContain(returning.profile.id);
    expect(
      await db
        .getRepository(Customer)
        .findOneByOrFail({ id: returning.customer.id }),
    ).toEqual(original);
    expect(
      (
        await db
          .getRepository(Booking)
          .findOneByOrFail({ id: incoming.booking.id })
      ).status,
    ).toBe(BookingStatus.AWAITING_ARRIVAL);
    expect(await db.getRepository(ServiceJob).count()).toBe(0);
  });

  it('booking check-in cannot reassign a vehicle associated with a different center customer', async () => {
    const incoming = await booked(
      returning.profile,
      another.vehicle.registrationNumber,
    );
    const original = await db
      .getRepository(Vehicle)
      .findOneByOrFail({ id: another.vehicle.id });
    const result = await checkIn(incoming.booking.id).expect(409);
    expect(JSON.stringify(result.body)).not.toContain(another.customer.phone);
    expect(
      await db
        .getRepository(Vehicle)
        .findOneByOrFail({ id: another.vehicle.id }),
    ).toEqual(original);
    expect(await db.getRepository(ServiceJob).count()).toBe(0);
  });

  it('valid check-in preserves the saved package scope and charges its price once', async () => {
    const incoming = await booked();
    const result = await checkIn(incoming.booking.id).expect(201);
    expect(
      Object.keys(result.body.job as Record<string, unknown>).sort(),
    ).toEqual(['id', 'jobNumber', 'status']);
    const lines = await db
      .getRepository(JobLineItem)
      .find({ where: { jobId: result.body.job.id } });
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].unitPriceInr)).toBe(1250);
    expect(lines[0].scope).toEqual(incoming.scope);
    expect(
      (
        await db
          .getRepository(Vehicle)
          .findOneByOrFail({ id: returning.vehicle.id })
      ).customerId,
    ).toBe(returning.customer.id);
  });

  pgIt(
    'rolls back a new vehicle, job, event, audit and receipt when the audit fails',
    async () => {
      const before = await counts();
      const key = randomUUID();
      const value = {
        customerId: returning.customer.id,
        customerRevision: 1,
        newVehicle: {
          registrationNumber: 'KA03ZZ7890',
          vehicleType: 'FOUR_WHEELER',
          makeModel: 'Hyundai i20',
        },
        serviceType: 'Inspection',
      };
      jest
        .spyOn(events, 'writeAuditLog')
        .mockRejectedValueOnce(new Error('AF006 injected audit failure'));
      await create(value, key).expect(500);
      expect(await counts()).toEqual(before);
      await create(value, key).expect(201);
      expect(await db.getRepository(ServiceJob).count()).toBe(1);
    },
  );

  pgIt(
    'check-in rolls back booking state, scope, associations and odometer on an audit failure',
    async () => {
      const incoming = await booked();
      const before = await counts();
      const customer = await db
        .getRepository(Customer)
        .findOneByOrFail({ id: returning.customer.id });
      const vehicle = await db
        .getRepository(Vehicle)
        .findOneByOrFail({ id: returning.vehicle.id });
      jest
        .spyOn(events, 'writeAuditLog')
        .mockRejectedValueOnce(new Error('AF006 check-in audit failure'));
      await checkIn(incoming.booking.id).expect(500);
      expect(await counts()).toEqual(before);
      expect(
        await db.getRepository(Customer).findOneByOrFail({ id: customer.id }),
      ).toEqual(customer);
      expect(
        await db.getRepository(Vehicle).findOneByOrFail({ id: vehicle.id }),
      ).toEqual(vehicle);
      expect(
        await db
          .getRepository(Booking)
          .findOneByOrFail({ id: incoming.booking.id }),
      ).toEqual(incoming.booking);
      expect(
        await db
          .getRepository(GarageVehicle)
          .findOneByOrFail({ id: incoming.garage.id }),
      ).toEqual(incoming.garage);
      expect(
        await db
          .getRepository(BookingItem)
          .findOneByOrFail({ id: incoming.item.id }),
      ).toEqual(incoming.item);
      expect(await db.getRepository(JobLineItem).count()).toBe(0);
      await checkIn(incoming.booking.id).expect(201);
    },
  );

  function pauseBookingRead(
    service: BookingsService | CenterBookingsService,
    method: 'getOwned' | 'getInCenter',
  ) {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const target = service as unknown as Record<
      'getOwned' | 'getInCenter',
      (...args: unknown[]) => Promise<Booking>
    >;
    const original = target[method].bind(service);
    jest.spyOn(target, method).mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      enter();
      await blocked;
      return result;
    });
    return { entered, release };
  }

  pgIt(
    'a stale customer cancellation cannot undo a committed check-in',
    async () => {
      await db
        .getRepository(CustomerProfile)
        .update(returning.profile.id, { iamUserId: TEST_CUSTOMER_IAM_USER_ID });
      const incoming = await booked();
      const gate = pauseBookingRead(app.get(BookingsService), 'getOwned');
      const pending = as(
        http().post(`/v1/bookings/${incoming.booking.id}/cancel`),
        customerToken,
      )
        .send({ reason: 'Changed plans' })
        .then((response) => response);
      await Promise.race([
        gate.entered,
        pending.then(() => {
          throw new Error('Cancellation returned before loading its booking');
        }),
      ]);
      let created!: request.Response;
      try {
        created = await checkIn(incoming.booking.id).expect(201);
      } finally {
        gate.release();
      }
      expect((await pending).status).toBe(409);
      const booking = await db
        .getRepository(Booking)
        .findOneByOrFail({ id: incoming.booking.id });
      expect(booking.status).toBe(BookingStatus.CHECKED_IN);
      expect(booking.serviceJobId).toBe(created.body.job.id);
      expect(booking.cancelledAt).toBeNull();
      expect(await db.getRepository(ServiceJob).count()).toBe(1);
    },
  );

  pgIt.each(['decline', 'no-show', 'confirm'])(
    'a stale desk %s cannot undo a committed check-in',
    async (action) => {
      const incoming = await booked();
      if (action === 'no-show') {
        await db.getRepository(Booking).update(incoming.booking.id, {
          slotStart: new Date('2025-01-01T00:00:00Z'),
        });
      }
      if (action === 'confirm') {
        await db.getRepository(Booking).update(incoming.booking.id, {
          status: BookingStatus.PENDING_CENTER,
        });
      }
      const gate = pauseBookingRead(
        app.get(CenterBookingsService),
        'getInCenter',
      );
      const pending = as(
        http().post(`/v1/center/bookings/${incoming.booking.id}/${action}`),
      )
        .send(
          action === 'decline' ? { reason: 'Unable to take this visit' } : {},
        )
        .then((response) => response);
      await Promise.race([
        gate.entered,
        pending.then(() => {
          throw new Error('Desk action returned before loading its booking');
        }),
      ]);
      let created!: request.Response;
      try {
        if (action === 'confirm')
          await as(
            http().post(`/v1/center/bookings/${incoming.booking.id}/confirm`),
          )
            .send({})
            .expect(200);
        created = await checkIn(incoming.booking.id).expect(201);
      } finally {
        gate.release();
      }
      expect((await pending).status).toBe(409);
      const booking = await db
        .getRepository(Booking)
        .findOneByOrFail({ id: incoming.booking.id });
      expect(booking.status).toBe(BookingStatus.CHECKED_IN);
      expect(booking.serviceJobId).toBe(created.body.job.id);
      expect(booking.cancelledAt).toBeNull();
      expect(await db.getRepository(ServiceJob).count()).toBe(1);
    },
  );

  pgIt(
    'check-in loses cleanly when customer cancellation commits first',
    async () => {
      await db
        .getRepository(CustomerProfile)
        .update(returning.profile.id, { iamUserId: TEST_CUSTOMER_IAM_USER_ID });
      const incoming = await booked();
      const intake = app.get(IntakeService);
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => (enter = resolve));
      const blocked = new Promise<void>((resolve) => (release = resolve));
      const original = intake.lockCenter.bind(intake);
      jest
        .spyOn(intake, 'lockCenter')
        .mockImplementationOnce(async (...args) => {
          enter();
          await blocked;
          return original(...args);
        });
      const pending = checkIn(incoming.booking.id).then((response) => response);
      await entered;
      try {
        await as(
          http().post(`/v1/bookings/${incoming.booking.id}/cancel`),
          customerToken,
        )
          .send({ reason: 'No longer coming' })
          .expect(200);
      } finally {
        release();
      }
      expect((await pending).status).toBe(409);
      const booking = await db
        .getRepository(Booking)
        .findOneByOrFail({ id: incoming.booking.id });
      expect(booking.status).toBe(BookingStatus.CANCELLED);
      expect(booking.serviceJobId).toBeNull();
      expect(await db.getRepository(ServiceJob).count()).toBe(0);
      expect(await db.getRepository(JobLineItem).count()).toBe(0);
    },
  );

  pgIt(
    'rolls back explicit type confirmation when receipt persistence fails',
    async () => {
      await db
        .getRepository(Vehicle)
        .update(returning.vehicle.id, { vehicleType: null, revision: 2 });
      const before = await counts();
      const original = await db
        .getRepository(Vehicle)
        .findOneByOrFail({ id: returning.vehicle.id });
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const save = EntityManager.prototype.save;
      jest.spyOn(EntityManager.prototype, 'save').mockImplementation(function (
        this: EntityManager,
        ...args: unknown[]
      ) {
        if (args[0] === CommandIdempotency)
          return Promise.reject(new Error('AF006 injected receipt failure'));
        return save.apply(this, args);
      } as typeof save);
      await create({
        ...body(),
        vehicleRevision: 2,
        confirmedVehicleType: 'FOUR_WHEELER',
      }).expect(500);
      expect(await counts()).toEqual(before);
      expect(
        await db
          .getRepository(Vehicle)
          .findOneByOrFail({ id: returning.vehicle.id }),
      ).toEqual(original);
    },
  );

  pgIt(
    'serializes overlapping identical keys into one committed visit',
    async () => {
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => (enter = resolve));
      const blocked = new Promise<void>((resolve) => (release = resolve));
      const original = events.writeAuditLog.bind(events);
      jest
        .spyOn(events, 'writeAuditLog')
        .mockImplementationOnce(async (...args) => {
          enter();
          await blocked;
          return original(...args);
        });
      const key = randomUUID(),
        value = body();
      const first = create(value, key).then((response) => response);
      await entered;
      const second = create(value, key).then((response) => response);
      release();
      const [a, b] = await Promise.all([first, second]);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body).toEqual(b.body);
      expect(await db.getRepository(ServiceJob).count()).toBe(1);
      expect(await db.getRepository(CommandIdempotency).count()).toBe(1);
    },
  );

  pgIt(
    'two independent advisors cannot open duplicate active visits',
    async () => {
      const outcomes = await Promise.all([
        create().then((result) => result),
        create().then((result) => result),
      ]);
      expect(outcomes.map((result) => result.status).sort()).toEqual([
        201, 409,
      ]);
      expect(await db.getRepository(ServiceJob).count()).toBe(1);
    },
  );

  pgIt(
    'migration triggers normalize legacy changes and bump revisions',
    async () => {
      const old = await db
        .getRepository(Customer)
        .findOneByOrFail({ id: returning.customer.id });
      await db.query('UPDATE customers SET phone = $1 WHERE id = $2', [
        '+91 98765 43210',
        old.id,
      ]);
      const changed = await db
        .getRepository(Customer)
        .findOneByOrFail({ id: old.id });
      expect(changed.phoneCanonical).toBe('+919876543210');
      expect(changed.revision).toBeGreaterThan(old.revision);
      await create(body()).expect(409);
      await db.query(
        'UPDATE vehicles SET registration_number = $1 WHERE id = $2',
        ['KA-01 AB 1234', returning.vehicle.id],
      );
      const vehicle = await db
        .getRepository(Vehicle)
        .findOneByOrFail({ id: returning.vehicle.id });
      expect(vehicle.registrationCanonical).toBe('KA01AB1234');
      expect(vehicle.revision).toBeGreaterThan(1);
    },
  );

  pgIt(
    'backfills only an unambiguous linked garage type and preserves historical uncertainty',
    async () => {
      const garage = await db.getRepository(GarageVehicle).save({
        customerProfileId: returning.profile.id,
        registrationNumber: returning.vehicle.registrationNumber,
        vehicleType: VehicleType.FOUR_WHEELER,
        make: 'Hyundai',
        model: 'i20',
      });
      await db.getRepository(Vehicle).update(returning.vehicle.id, {
        garageVehicleId: garage.id,
        vehicleType: null,
      });
      await db
        .getRepository(Vehicle)
        .update(another.vehicle.id, { vehicleType: null });
      // A historical job's default type must not become canonical vehicle evidence.
      await db.getRepository(ServiceJob).save({
        serviceCenterId: centerId,
        customerId: another.customer.id,
        vehicleId: another.vehicle.id,
        vehicleType: VehicleType.TWO_WHEELER,
        status: JobStatus.COMPLETED,
        serviceType: 'Historical service',
        publicToken: randomUUID(),
      });
      const runner = db.createQueryRunner();
      await runner.connect();
      try {
        await runner.query('DROP TRIGGER af006_customer_identity ON customers');
        await runner.query('DROP TRIGGER af006_vehicle_identity ON vehicles');
        await new ReturningWalkIn1730000000011().up(runner);
      } finally {
        await runner.release();
      }
      expect(
        (
          await db
            .getRepository(Vehicle)
            .findOneByOrFail({ id: returning.vehicle.id })
        ).vehicleType,
      ).toBe(VehicleType.FOUR_WHEELER);
      expect(
        (
          await db
            .getRepository(Vehicle)
            .findOneByOrFail({ id: another.vehicle.id })
        ).vehicleType,
      ).toBeNull();
      expect(await db.getRepository(ServiceJob).count()).toBe(1);
    },
  );
});
