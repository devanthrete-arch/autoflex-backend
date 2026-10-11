import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ENTITIES } from '../src/database/entities';
import { MIGRATIONS } from '../src/database/migration-list';
import { ServiceCatalogImporter } from '../src/modules/offerings/service-catalog.importer';
import { OfferingsService } from '../src/modules/offerings/offerings.service';
import { BOOKING_SELECTION_LIMITS } from '../src/modules/bookings/booking-selection-rate-limit.guard';
import { ServiceOffering } from '../src/modules/offerings/entities/service-offering.entity';
import { ServicePackage } from '../src/modules/offerings/entities/service-package.entity';
import { ServiceDefinition } from '../src/modules/offerings/entities/service-definition.entity';
import {
  ServiceCategory,
  ServiceCenterCategory,
} from '../src/modules/marketplace/entities/service-category.entity';
import { Booking } from '../src/modules/bookings/entities/booking.entity';
import { BookingItem } from '../src/modules/bookings/entities/booking-item.entity';
import { GarageVehicle } from '../src/modules/customers/entities/garage-vehicle.entity';
import { GarageVehicleStatus } from '../src/common/enums/garage-vehicle-status.enum';
import { GarageService } from '../src/modules/customers/garage.service';
import { ServiceCenter } from '../src/modules/tenancy/entities/service-center.entity';
import { EventsService } from '../src/modules/events/events.service';
import { createJwtTestFixture } from '../src/test-utils/jwt-test.helper';
import { createApiApp, createE2eApp } from './helpers/e2e-app.helper';
import {
  seedTestTenancy,
  TEST_CUSTOMER_APP_ID,
  TEST_CUSTOMER_DOMAIN_ID,
  TEST_CUSTOMER_IAM_USER_ID,
  TEST_DOMAIN_ID,
  TEST_IAM_USER_ID,
  TEST_OTHER_DOMAIN_ID,
  TEST_OTHER_USER_ID,
} from './helpers/test-db.helper';

const postgres = process.env.AF029_POSTGRES_TEST === 'true';
const pgIt = postgres ? it : it.skip;
const definition = (n: number) =>
  `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const slot = {
  slotStart: '2027-06-15T03:30:00.000Z',
  slotEnd: '2027-06-15T04:30:00.000Z',
};
describe(`Service marketplace (${postgres ? 'PostgreSQL' : 'memory'} API)`, () => {
  let app: INestApplication, db: DataSource;
  let manager: string, other: string, technician: string, customer: string;
  let centerId: string,
    otherCenterId: string,
    vehicleId: string,
    brake: any,
    battery: any,
    bundle: any,
    booking: any;
  const http = () => request(app.getHttpServer());
  const staff = (req: request.Test, token = manager) =>
    req.set('Authorization', `Bearer ${token}`);
  const command = (req: request.Test, version?: number, key = randomUUID()) => {
    staff(req).set('Idempotency-Key', key);
    if (version) req.set('If-Match', String(version));
    return req;
  };
  const book = (selections: unknown[]) =>
    http()
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${customer}`)
      .send({
        serviceCenterId: centerId,
        vehicleId,
        mode: 'SELF_CHECKIN',
        ...slot,
        selections,
      });
  const selection = (item: any, kind = 'SERVICE') => ({
    id: item.id,
    version: item.version,
    kind,
  });
  const validate = (
    selections: unknown[],
    vehicleType?: string,
    id = centerId,
  ) =>
    http()
      .post(`/v1/centers/${id}/booking-selection`)
      .send({ selections, ...(vehicleType ? { vehicleType } : {}) });
  beforeAll(async () => {
    process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID = TEST_CUSTOMER_APP_ID;
    const fixture = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = fixture.jwksJson;
    if (postgres) {
      // Fixed disposable target; this suite never reads the workshop connection settings.
      db = new DataSource({
        type: 'postgres',
        host: '127.0.0.1',
        port: 55429,
        username: 'af029_test',
        password: 'af029_test',
        database: 'af029_test',
        entities: ENTITIES,
        migrations: MIGRATIONS,
      });
      await db.initialize();
      await db.query('DROP SCHEMA public CASCADE');
      await db.query('CREATE SCHEMA public');
      await db.runMigrations();
      app = await createApiApp(db);
    } else {
      const ctx = await createE2eApp();
      app = ctx.app;
      db = ctx.dataSource;
    }
    const tenancy = await seedTestTenancy(db);
    centerId = tenancy.serviceCenter.id;
    otherCenterId = tenancy.otherCenter.id;
    for (const id of [centerId, otherCenterId])
      await db.getRepository(ServiceCenter).update(id, {
        city: 'Bengaluru',
        latitude: 12.9716,
        longitude: 77.5946,
        slotCapacity: 20,
        supportedVehicleTypes: ['TWO_WHEELER', 'FOUR_WHEELER'] as any,
      });
    manager = await fixture.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['manager'],
      permissions: [
        'center:manage',
        'jobs:read',
        'jobs:create',
        'jobs:update',
        'bookings:manage',
      ],
    });
    other = await fixture.signAccessToken({
      sub: TEST_OTHER_USER_ID,
      domainId: TEST_OTHER_DOMAIN_ID,
      roles: ['manager'],
      permissions: ['center:manage'],
    });
    technician = await fixture.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['technician'],
      permissions: ['center:manage', 'jobs:read'],
    });
    customer = await fixture.signAccessToken({
      sub: TEST_CUSTOMER_IAM_USER_ID,
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      mobile: '9876543210',
      roles: ['customer'],
      permissions: [],
    });
    await http()
      .put('/v1/me/profile')
      .set('Authorization', `Bearer ${customer}`)
      .send({ displayName: 'Priya', dateOfBirth: '1994-03-12' })
      .expect(200);
    const vehicle = await http()
      .post('/v1/me/vehicles')
      .set('Authorization', `Bearer ${customer}`)
      .send({
        vehicleType: 'TWO_WHEELER',
        make: 'Honda',
        model: 'Activa',
        registrationNumber: 'KA01AA1234',
      })
      .expect(201);
    vehicleId = vehicle.body.id;
  }, 60000);
  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
  });

  it('imports stable activity identities twice without altering an existing menu', async () => {
    const legacy = await db.getRepository(ServiceOffering).save({
      serviceCenterId: centerId,
      name: 'Legacy service',
      priceInr: '99.00',
      durationMinutes: 30,
    });
    const importer = new ServiceCatalogImporter(db);
    await importer.importFromSeed();
    await importer.importFromSeed();
    const res = await http().get('/v1/marketplace/services').expect(200);
    expect(res.body.items).toHaveLength(12);
    expect(
      await db
        .getRepository(ServiceOffering)
        .findOneByOrFail({ id: legacy.id }),
    ).toMatchObject({
      name: 'Legacy service',
      serviceDefinitionId: null,
      version: 1,
    });
  });
  it('requires manager authority and explicit command keys', async () => {
    await staff(http().get('/v1/center/offerings'), technician).expect(403);
    await staff(http().get('/v1/center/packages'), customer).expect(403);
    await staff(http().post('/v1/center/offerings'))
      .send({ name: 'Brake inspection', priceInr: 300, durationMinutes: 30 })
      .expect(400);
  });
  it('adopts master services and replays creation without duplicates', async () => {
    const key = randomUUID();
    const body = {
      serviceDefinitionId: definition(4),
      name: 'Brake inspection',
      description: 'Visual inspection; parts excluded.',
      priceInr: 300,
      durationMinutes: 30,
      vehicleType: 'TWO_WHEELER',
    };
    brake = (
      await command(http().post('/v1/center/offerings'), undefined, key)
        .send(body)
        .expect(201)
    ).body;
    expect(
      (
        await command(http().post('/v1/center/offerings'), undefined, key)
          .send(body)
          .expect(201)
      ).body.id,
    ).toBe(brake.id);
    await command(http().post('/v1/center/offerings'), undefined, key)
      .send({ ...body, priceInr: 301 })
      .expect(422);
    battery = (
      await command(http().post('/v1/center/offerings'))
        .send({
          serviceDefinitionId: definition(6),
          name: 'Battery test',
          description: 'Testing only',
          priceInr: 200,
          durationMinutes: 30,
          vehicleType: 'TWO_WHEELER',
        })
        .expect(201)
    ).body;
  });
  it('offers one service to both bikes and cars when its activity supports both', async () => {
    const shared = (
      await command(http().post('/v1/center/offerings'))
        .send({
          serviceDefinitionId: definition(2),
          name: 'Wheel balancing',
          description: 'Balancing with weights included',
          priceInr: 400,
          durationMinutes: 45,
        })
        .expect(201)
    ).body;
    expect(shared.vehicleType).toBeNull();
    for (const vehicleType of ['TWO_WHEELER', 'FOUR_WHEELER']) {
      const menu = await http()
        .get(`/v1/marketplace/centers/${centerId}/offerings`)
        .query({ vehicleType })
        .expect(200);
      expect(menu.body.some((item: any) => item.id === shared.id)).toBe(true);
    }
  });
  it('keeps omitted PATCH fields, rejects stale versions and isolates centers', async () => {
    const res = await command(
      http().patch(`/v1/center/offerings/${brake.id}`),
      brake.version,
    )
      .send({ priceInr: 350 })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'Brake inspection',
      description: 'Visual inspection; parts excluded.',
      serviceDefinitionId: definition(4),
      version: 2,
    });
    brake = res.body;
    await command(http().patch(`/v1/center/offerings/${brake.id}`), 1)
      .send({ isActive: false })
      .expect(409);
    await staff(http().patch(`/v1/center/offerings/${brake.id}`), other)
      .set('If-Match', '2')
      .set('Idempotency-Key', randomUUID())
      .send({ isActive: false })
      .expect(404);
  });
  it('rejects unsupported service types, null patches and duplicate activities in a package', async () => {
    await command(http().post('/v1/center/offerings'))
      .send({
        serviceDefinitionId: definition(1),
        name: 'Alignment',
        vehicleType: 'TWO_WHEELER',
        priceInr: 500,
        durationMinutes: 30,
      })
      .expect(400);
    await command(
      http().patch(`/v1/center/offerings/${brake.id}`),
      brake.version,
    )
      .send({ name: null })
      .expect(400);
    await command(http().post('/v1/center/packages'))
      .send({
        name: 'Invalid bundle',
        description: 'Duplicate',
        vehicleType: 'TWO_WHEELER',
        priceInr: 400,
        priceIsStarting: false,
        durationMinutes: 60,
        isActive: true,
        components: [
          { offeringId: brake.id, quantity: 1 },
          { offeringId: brake.id, quantity: 2 },
        ],
      })
      .expect(400);
  });
  it('creates a package with explicit quantities and an independent price', async () => {
    bundle = (
      await command(http().post('/v1/center/packages'))
        .send({
          name: 'Safety checks',
          description: 'Inspection and testing; replacement parts excluded.',
          vehicleType: 'TWO_WHEELER',
          priceInr: 450,
          priceIsStarting: false,
          durationMinutes: 45,
          isActive: true,
          components: [
            { offeringId: brake.id, quantity: 1 },
            { offeringId: battery.id, quantity: 1 },
          ],
        })
        .expect(201)
    ).body;
    expect(bundle.available).toBe(true);
    expect(bundle.components).toHaveLength(2);
  });
  it('keeps package version when only a component sort order changes', async () => {
    battery = (
      await command(
        http().patch(`/v1/center/offerings/${battery.id}`),
        battery.version,
      )
        .send({ sortOrder: 9 })
        .expect(200)
    ).body;
    const current = await db
      .getRepository(ServicePackage)
      .findOneByOrFail({ id: bundle.id });
    expect(current.version).toBe(bundle.version);
  });
  it('rejects stale prices and overlapping work before reserving a slot', async () => {
    const before = await db.getRepository(Booking).count();
    await book([{ ...selection(brake), version: 1 }]).expect(409);
    await book([selection(bundle, 'PACKAGE'), selection(brake)]).expect(400);
    expect(await db.getRepository(Booking).count()).toBe(before);
  });
  it('validates the cart without a vehicle or a reservation, including shared work and packages', async () => {
    const before = await db.getRepository(Booking).count();
    expect((await validate([]).expect(200)).body.vehicleTypes).toEqual([
      'TWO_WHEELER',
      'FOUR_WHEELER',
    ]);
    expect(
      (await validate([selection(brake)]).expect(200)).body.vehicleTypes,
    ).toEqual(['TWO_WHEELER']);
    expect(
      (await validate([selection(bundle, 'PACKAGE')]).expect(200)).body
        .vehicleTypes,
    ).toEqual(['TWO_WHEELER']);
    const menu = (
      await http()
        .get(`/v1/marketplace/centers/${centerId}/offerings`)
        .expect(200)
    ).body;
    const shared = menu.find((row: any) => row.name === 'Wheel balancing');
    expect(shared.vehicleTypes).toEqual(['TWO_WHEELER', 'FOUR_WHEELER']);
    expect(
      (await validate([selection(shared)]).expect(200)).body.vehicleTypes,
    ).toEqual(shared.vehicleTypes);
    expect(await db.getRepository(Booking).count()).toBe(before);
  });

  pgIt(
    'finishes an anonymous preview while a center writer still holds the booking lock',
    async () => {
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      let preview: Promise<request.Response> | undefined;
      const before = await db.getRepository(Booking).count();
      try {
        await runner.manager
          .getRepository(ServiceCenter)
          .update(centerId, { bookingEnabled: false });
        // A locked preview times out here. The writer is intentionally not released until after the response.
        preview = validate([selection(bundle, 'PACKAGE')])
          .timeout({ response: 1500, deadline: 2000 })
          .then((response) => response);
        const response = await preview;
        expect(response.status).toBe(200);
        expect(response.body.vehicleTypes).toEqual(['TWO_WHEELER']);
        expect(runner.isTransactionActive).toBe(true);
        expect(await db.getRepository(Booking).count()).toBe(before);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await preview?.catch(() => undefined);
        await runner.release();
      }
    },
  );

  pgIt(
    'uses one read-only snapshot when a component edit commits between its service and package reads',
    async () => {
      const offerings = app.get(OfferingsService);
      const resolve = offerings.validateSelections.bind(offerings);
      const originalBattery = await db
        .getRepository(ServiceOffering)
        .findOneByOrFail({ id: battery.id });
      const originalBundle = await db
        .getRepository(ServicePackage)
        .findOneByOrFail({ id: bundle.id });
      const spy = jest
        .spyOn(offerings, 'validateSelections')
        .mockImplementationOnce(async (snapshot, center, selections, type) => {
          expect(await snapshot.query('SHOW transaction_isolation')).toEqual([
            { transaction_isolation: 'repeatable read' },
          ]);
          expect(await snapshot.query('SHOW transaction_read_only')).toEqual([
            { transaction_read_only: 'on' },
          ]);
          const repository = snapshot.getRepository(ServiceOffering);
          const find = repository.find.bind(repository);
          const read = jest
            .spyOn(repository, 'find')
            .mockImplementationOnce(async (options) => {
              const rows = await find(options);
              await db.transaction(async (writer) => {
                await writer.query("SET LOCAL lock_timeout = '1s'");
                await offerings.lockCenter(writer, centerId);
                await writer
                  .getRepository(ServiceOffering)
                  .update(originalBattery.id, {
                    description: 'Scope committed during preview',
                    version: originalBattery.version + 1,
                  });
                await writer
                  .getRepository(ServicePackage)
                  .update(originalBundle.id, {
                    version: originalBundle.version + 1,
                  });
              });
              return rows;
            });
          try {
            return await resolve(snapshot, center, selections, type);
          } finally {
            read.mockRestore();
          }
        });
      try {
        // The first preview sees the old component AND package, rather than a mixture of versions.
        await validate([selection(bundle, 'PACKAGE')]).expect(200);
        spy.mockRestore();
        // A new preview and the authoritative reservation see the newly committed version.
        const before = await db.getRepository(Booking).count();
        const next = await validate([selection(bundle, 'PACKAGE')]).expect(409);
        expect(next.body.code).toBe('MENU_CHANGED');
        await book([selection(bundle, 'PACKAGE')]).expect(409);
        expect(await db.getRepository(Booking).count()).toBe(before);
      } finally {
        spy.mockRestore();
        await db.transaction(async (writer) => {
          await offerings.lockCenter(writer, centerId);
          await writer
            .getRepository(ServiceOffering)
            .update(originalBattery.id, {
              description: originalBattery.description,
              version: originalBattery.version,
            });
          await writer
            .getRepository(ServicePackage)
            .update(originalBundle.id, { version: originalBundle.version });
        });
      }
    },
  );

  it('rejects mixed services and packages in preflight and final reservation, including legacy bodies', async () => {
    const createCarService = async (
      name: string,
    ): Promise<Pick<ServiceOffering, 'id' | 'version'>> =>
      (
        await command(http().post('/v1/center/offerings'))
          .send({
            name,
            vehicleType: 'FOUR_WHEELER',
            priceInr: 500,
            durationMinutes: 30,
          })
          .expect(201)
      ).body;
    const foam = await createCarService('Foam cleaning');
    const interior = await createCarService('Interior cleaning');
    const carPackage: Pick<ServicePackage, 'id' | 'version'> = (
      await command(http().post('/v1/center/packages'))
        .send({
          name: 'Car cleaning',
          vehicleType: 'FOUR_WHEELER',
          priceInr: 900,
          priceIsStarting: false,
          durationMinutes: 60,
          isActive: true,
          components: [
            { offeringId: foam.id, quantity: 1 },
            { offeringId: interior.id, quantity: 1 },
          ],
        })
        .expect(201)
    ).body;
    const beforeBookings = await db.getRepository(Booking).count();
    const beforeItems = await db.getRepository(BookingItem).count();
    for (const picks of [
      [selection(brake), selection(foam)],
      [selection(bundle, 'PACKAGE'), selection(carPackage, 'PACKAGE')],
    ]) {
      expect((await validate(picks).expect(409)).body.code).toBe(
        'MENU_VEHICLE_MISMATCH',
      );
      expect((await book(picks).expect(409)).body.code).toBe(
        'MENU_UNAVAILABLE',
      );
    }
    await http()
      .post('/v1/bookings')
      .set('Authorization', `Bearer ${customer}`)
      .send({
        serviceCenterId: centerId,
        vehicleId,
        mode: 'SELF_CHECKIN',
        ...slot,
        offeringIds: [brake.id, foam.id],
      })
      .expect(400);
    expect(await db.getRepository(Booking).count()).toBe(beforeBookings);
    expect(await db.getRepository(BookingItem).count()).toBe(beforeItems);
    await db.getRepository(ServicePackage).delete(carPackage.id);
    await db.getRepository(ServiceOffering).softDelete([foam.id, interior.id]);
  });

  it('checks definition restrictions on historical untyped rows instead of treating them as universal', async () => {
    const row = await db.getRepository(ServiceOffering).save({
      serviceCenterId: centerId,
      serviceDefinitionId: definition(1),
      vehicleType: null,
      name: 'Historical alignment',
      priceInr: '500.00',
      durationMinutes: 30,
    });
    const menu = (
      await http()
        .get(`/v1/marketplace/centers/${centerId}/offerings`)
        .expect(200)
    ).body;
    expect(menu.find((item: any) => item.id === row.id).vehicleTypes).toEqual([
      'FOUR_WHEELER',
    ]);
    expect(
      (await validate([selection(row)]).expect(200)).body.vehicleTypes,
    ).toEqual(['FOUR_WHEELER']);
    await validate([selection(row)], 'TWO_WHEELER').expect(409);
    await book([selection(row)]).expect(409);
    await db.getRepository(ServiceOffering).softDelete(row.id);
  });

  it('rejects stale, overlapping, cross-center, malformed and oversized selections on the server', async () => {
    expect(
      (await validate([{ ...selection(brake), version: 1 }]).expect(409)).body
        .code,
    ).toBe('MENU_CHANGED');
    expect(
      (
        await validate([selection(bundle, 'PACKAGE'), selection(brake)]).expect(
          400,
        )
      ).body.code,
    ).toBe('SERVICE_OVERLAP');
    await validate([selection(brake)], undefined, otherCenterId).expect(409);
    await validate(Array.from({ length: 11 }, () => selection(brake))).expect(
      400,
    );
    await validate([{ ...selection(brake), version: 0 }]).expect(400);
    await validate([{ ...selection(brake), kind: 'OTHER' }]).expect(400);
    await validate([], 'TRUCK').expect(400);
    await http()
      .post(`/v1/centers/${centerId}/booking-selection`)
      .send({ selections: null })
      .expect(400);
    await http()
      .post(`/v1/centers/${centerId}/booking-selection`)
      .send({})
      .expect(400);
  });

  it('normalizes valid UUID casing and still refuses duplicate work', async () => {
    await validate([
      { ...selection(brake), id: brake.id.toUpperCase() },
    ]).expect(200);
    expect(
      (
        await validate([
          selection(brake),
          { ...selection(brake), id: brake.id.toUpperCase() },
        ]).expect(400)
      ).body.code,
    ).toBe('SERVICE_OVERLAP');
  });

  it('refuses a paused center even for the issue-only path', async () => {
    await db
      .getRepository(ServiceCenter)
      .update(centerId, { bookingEnabled: false });
    try {
      await validate([]).expect(404);
      await book([]).expect(404);
    } finally {
      await db
        .getRepository(ServiceCenter)
        .update(centerId, { bookingEnabled: true });
    }
  });

  it('refuses archived vehicles at reservation without writing items or taking capacity', async () => {
    const before = await db.getRepository(Booking).count();
    await db
      .getRepository(GarageVehicle)
      .update(vehicleId, { status: GarageVehicleStatus.ARCHIVED });
    try {
      expect((await book([selection(brake)]).expect(409)).body.code).toBe(
        'BOOKING_VEHICLE_UNAVAILABLE',
      );
      await book([]).expect(409);
      expect(await db.getRepository(Booking).count()).toBe(before);
    } finally {
      await db
        .getRepository(GarageVehicle)
        .update(vehicleId, { status: GarageVehicleStatus.ACTIVE });
    }
  });

  pgIt(
    'refuses an archive committed after the initial vehicle read',
    async () => {
      const before = await db.getRepository(Booking).count();
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      const garage = app.get(GarageService);
      const original = garage.getOwned.bind(garage);
      let readVehicle!: () => void;
      const read = new Promise<void>((resolve) => {
        readVehicle = resolve;
      });
      const spy = jest
        .spyOn(garage, 'getOwned')
        .mockImplementationOnce(async (...args) => {
          const vehicle = await original(...args);
          readVehicle();
          return vehicle;
        });
      let reservation: Promise<request.Response> | undefined;
      try {
        await runner.manager
          .getRepository(GarageVehicle)
          .update(vehicleId, { status: GarageVehicleStatus.ARCHIVED });
        // A plain ownership read sees the old ACTIVE row while the archive remains uncommitted.
        reservation = book([]).then((response) => response);
        await read;
        await runner.commitTransaction();
        const response = await reservation;
        expect(response.status).toBe(409);
        expect(response.body.code).toBe('BOOKING_VEHICLE_UNAVAILABLE');
        expect(await db.getRepository(Booking).count()).toBe(before);
      } finally {
        spy.mockRestore();
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        await reservation;
        await runner.release();
        await db
          .getRepository(GarageVehicle)
          .update(vehicleId, { status: GarageVehicleStatus.ACTIVE });
      }
    },
  );

  it('records the package price once and snapshots its component scope', async () => {
    booking = (await book([selection(bundle, 'PACKAGE')]).expect(201)).body;
    expect(booking.estimateInr).toBe('450.00');
    expect(booking.items).toHaveLength(1);
    expect(booking.items[0].scope).toHaveLength(2);
    expect(booking.items[0].servicePackageId).toBe(bundle.id);
  });
  it('changes package version when component scope changes, while booked scope stays fixed', async () => {
    battery = (
      await command(
        http().patch(`/v1/center/offerings/${battery.id}`),
        battery.version,
      )
        .send({ description: 'Updated test scope' })
        .expect(200)
    ).body;
    const current = await db
      .getRepository(ServicePackage)
      .findOneByOrFail({ id: bundle.id });
    expect(current.version).toBe(bundle.version + 1);
    await book([selection(bundle, 'PACKAGE')]).expect(409);
    const saved = await db
      .getRepository(BookingItem)
      .findOneByOrFail({ bookingId: booking.id });
    expect(saved.scope[1].description).toBe('Testing only');
  });
  it('hides a package after a component is paused but keeps old bookings readable and checkable', async () => {
    brake = (
      await command(
        http().patch(`/v1/center/offerings/${brake.id}`),
        brake.version,
      )
        .send({ isActive: false })
        .expect(200)
    ).body;
    const packages = await http()
      .get(`/v1/marketplace/centers/${centerId}/packages`)
      .expect(200);
    expect(packages.body).toHaveLength(0);
    await book([selection(bundle, 'PACKAGE')]).expect(409);
    await http()
      .get(`/v1/bookings/${booking.id}`)
      .set('Authorization', `Bearer ${customer}`)
      .expect(200);
    const res = await staff(
      http().post(`/v1/center/bookings/${booking.id}/check-in`),
    )
      .send({})
      .expect(201);
    const job = await staff(http().get(`/v1/jobs/${res.body.job.id}`)).expect(
      200,
    );
    expect(job.body.lineItems).toHaveLength(1);
    expect(job.body.totals.currentInr).toBe('450.00');
    expect(job.body.lineItems[0].scope[1]).toMatchObject({
      name: 'Battery test',
      description: 'Testing only',
      quantity: 1,
    });
    expect(job.body.customerRequest).toBeNull();
  });
  pgIt(
    'searches exact activities and aliases with location, type and stable pagination',
    async () => {
      const category = await db.getRepository(ServiceCategory).save({
        slug: 'marketplace-test',
        name: 'Marketplace test',
        iconKey: 'wrench',
        sortOrder: 1,
      });
      await db
        .getRepository(ServiceCenterCategory)
        .save({ serviceCenterId: centerId, categoryId: category.id });
      const alias = await http()
        .get('/v1/marketplace/centers')
        .query({
          q: 'battery check',
          vehicleType: 'TWO_WHEELER',
          city: 'Bengaluru',
        })
        .expect(200);
      expect(alias.body.items.map((c: any) => c.id)).toEqual([centerId]);
      expect(alias.body.items[0].matchingServices[0].id).toBe(battery.id);
      const paused = await http()
        .get('/v1/marketplace/centers')
        .query({ serviceId: definition(4) })
        .expect(200);
      expect(paused.body.items).toHaveLength(0);
      const cars = await http()
        .get('/v1/marketplace/centers')
        .query({ serviceId: definition(6), vehicleType: 'FOUR_WHEELER' })
        .expect(200);
      expect(cars.body.items).toHaveLength(0);
      const first = await http()
        .get('/v1/marketplace/centers')
        .query({ lat: 12.9716, lng: 77.5946, limit: 1 })
        .expect(200);
      const second = await http()
        .get('/v1/marketplace/centers')
        .query({
          lat: 12.9716,
          lng: 77.5946,
          limit: 1,
          offset: first.body.nextOffset,
        })
        .expect(200);
      expect(first.body.items[0].id).not.toBe(second.body.items[0].id);
      expect(second.body.nextOffset).toBeNull();
      const center = [...first.body.items, ...second.body.items].find(
        (item: any) => item.id === centerId,
      );
      expect(center.categories).toContainEqual({
        id: category.id,
        name: category.name,
      });
    },
  );
  pgIt(
    'matches any selected service without duplicating centers or counting unavailable work',
    async () => {
      const definitions = db.getRepository(ServiceDefinition);
      const centers = db.getRepository(ServiceCenter);
      const offerings = db.getRepository(ServiceOffering);
      const [serviceA, serviceB] = await definitions.save(
        ['A', 'B'].map((name) =>
          definitions.create({
            id: randomUUID(),
            slug: `union-filter-${name.toLowerCase()}`,
            name: `Union filter service ${name}`,
            category: 'Filter tests',
            description: 'Independent service used by the union filter test',
            aliases: [],
            vehicleTypes: ['TWO_WHEELER', 'FOUR_WHEELER'] as any,
            isActive: true,
          }),
        ),
      );
      const [onlyA, onlyB, both] = await centers.save(
        ['A only', 'B only', 'Both'].map((name) =>
          centers.create({
            iamDomainId: randomUUID(),
            name,
            city: 'Union filter test city',
            supportedVehicleTypes: ['TWO_WHEELER', 'FOUR_WHEELER'] as any,
          }),
        ),
      );
      const offer = (center: ServiceCenter, service: ServiceDefinition) =>
        offerings.create({
          serviceCenterId: center.id,
          serviceDefinitionId: service.id,
          name: service.name,
          vehicleType: 'TWO_WHEELER' as any,
          priceInr: '300.00',
          durationMinutes: 30,
        });
      const [offerA, offerB] = await offerings.save([
        offer(onlyA, serviceA),
        offer(onlyB, serviceB),
        offer(both, serviceA),
        offer(both, serviceB),
        // Multiple priced variants of one service must not duplicate a center.
        { ...offer(both, serviceA), name: 'Alternative A price' },
      ]);
      const query = new URLSearchParams({
        city: onlyA.city!,
        vehicleType: 'TWO_WHEELER',
      });
      query.append('serviceIds', serviceA.id);
      query.append('serviceIds', serviceB.id);
      const search = () =>
        http().get(`/v1/marketplace/centers?${query.toString()}`).expect(200);
      const ids = (response: request.Response) =>
        response.body.items.map((center: any) => center.id).sort();
      try {
        const result = await search();
        expect(ids(result)).toEqual([onlyA.id, onlyB.id, both.id].sort());
        expect(result.body.nextOffset).toBeNull();
        for (const [id, expected] of [
          [onlyA.id, [serviceA.id]],
          [onlyB.id, [serviceB.id]],
          [both.id, [serviceA.id, serviceB.id]],
        ] as const) {
          const row = result.body.items.find((center: any) => center.id === id);
          expect(
            [
              ...new Set(
                row.matchingServices.map(
                  (item: any) => item.serviceDefinitionId,
                ),
              ),
            ].sort(),
          ).toEqual([...expected].sort());
        }

        const legacy = await http()
          .get('/v1/marketplace/centers')
          .query({ city: onlyA.city, serviceId: serviceA.id })
          .expect(200);
        expect(ids(legacy)).toEqual([onlyA.id, both.id].sort());
        const mixed = await http()
          .get(
            `/v1/marketplace/centers?city=${encodeURIComponent(onlyA.city!)}&serviceId=${serviceA.id}&serviceIds=${serviceB.id}&serviceIds=${serviceA.id}`,
          )
          .expect(200);
        expect(ids(mixed)).toEqual(ids(result));

        await offerings.update(offerB.id, { isActive: false });
        expect(ids(await search())).toEqual([onlyA.id, both.id].sort());
        await offerings.update(offerB.id, {
          isActive: true,
          vehicleType: 'FOUR_WHEELER' as any,
        });
        expect(ids(await search())).toEqual([onlyA.id, both.id].sort());

        await definitions.update(serviceB.id, { isActive: false });
        const withoutB = await search();
        expect(ids(withoutB)).toEqual([onlyA.id, both.id].sort());
        expect(
          withoutB.body.items.flatMap((center: any) => center.matchingServices),
        ).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ serviceDefinitionId: serviceB.id }),
          ]),
        );

        await offerings.softDelete(offerA.id);
        expect(ids(await search())).toEqual([both.id]);
        await centers.softDelete(both.id);
        expect(ids(await search())).toEqual([]);
      } finally {
        await centers.delete([onlyA.id, onlyB.id, both.id]);
        await definitions.delete([serviceA.id, serviceB.id]);
      }
    },
  );
  pgIt(
    'localizes services across the whole area with the same eligibility as center search',
    async () => {
      const definitions = db.getRepository(ServiceDefinition);
      const centers = db.getRepository(ServiceCenter);
      const offerings = db.getRepository(ServiceOffering);
      const activityRows = await definitions.save(
        Array.from({ length: 10 }, (_, index) =>
          definitions.create({
            id: randomUUID(),
            slug: `area-filter-${index}`,
            name: `Area filter service ${index}`,
            category: 'Area filter tests',
            description: 'Local availability regression',
            aliases: [],
            vehicleTypes:
              index === 2
                ? (['FOUR_WHEELER'] as any)
                : (['TWO_WHEELER', 'FOUR_WHEELER'] as any),
            isActive: index !== 3,
          }),
        ),
      );
      const city = 'Availability filter test city';
      const centerRows = await centers.save(
        [
          'Alpha',
          'Beta',
          'No coordinates',
          'Inactive',
          'Deleted',
          'Outside area',
        ].map((name, index) =>
          centers.create({
            iamDomainId: randomUUID(),
            name,
            city,
            latitude: index === 2 ? null : index === 5 ? 20 : 15.1234,
            longitude: index === 2 ? null : 73.4567,
            status: index === 3 ? ('INACTIVE' as any) : ('ACTIVE' as any),
            supportedVehicleTypes: ['TWO_WHEELER', 'FOUR_WHEELER'] as any,
          }),
        ),
      );
      const [alpha, beta, noCoordinates, inactive, deleted, outside] =
        centerRows;
      const offer = (
        center: ServiceCenter,
        activity: ServiceDefinition,
        extra: Partial<ServiceOffering> = {},
      ) =>
        offerings.create({
          serviceCenterId: center.id,
          serviceDefinitionId: activity.id,
          name: activity.name,
          priceInr: '300.00',
          durationMinutes: 30,
          ...extra,
        });
      const rows = await offerings.save([
        offer(alpha, activityRows[0]),
        offer(beta, activityRows[1]),
        offer(beta, activityRows[0]),
        offer(beta, activityRows[2]),
        offer(beta, activityRows[3]),
        offer(beta, activityRows[4], { isActive: false }),
        offer(beta, activityRows[5]),
        offer(inactive, activityRows[6]),
        offer(deleted, activityRows[7]),
        offer(outside, activityRows[8]),
        offer(noCoordinates, activityRows[9]),
        offer(beta, activityRows[1], {
          name: 'Unmapped activity',
          serviceDefinitionId: null,
        }),
      ]);
      await offerings.softDelete(rows[6].id);
      await centers.softDelete(deleted.id);
      const ids = (response: request.Response) =>
        response.body.items.map((item: any) => item.id).sort();
      const available = (query: Record<string, string | number>) =>
        http()
          .get('/v1/marketplace/available-services')
          .query(query)
          .expect(200);
      try {
        const byCity = await available({
          city: `  ${city.toUpperCase()}  `,
          vehicleType: 'TWO_WHEELER',
        });
        // Outside the coordinate radius still belongs to this city.
        expect(ids(byCity)).toEqual(
          [0, 1, 8, 9].map((n) => activityRows[n].id).sort(),
        );
        const firstCenters = await http()
          .get('/v1/marketplace/centers')
          .query({ city, vehicleType: 'TWO_WHEELER', limit: 1 })
          .expect(200);
        expect(firstCenters.body.items[0].id).toBe(alpha.id);
        expect(
          firstCenters.body.items[0].matchingServices.some(
            (item: any) => item.serviceDefinitionId === activityRows[1].id,
          ),
        ).toBe(false);
        expect(ids(byCity)).toContain(activityRows[1].id);
        const radius = await available({
          lat: 15.1234,
          lng: 73.4567,
          radiusMeters: 1000,
          vehicleType: 'TWO_WHEELER',
        });
        expect(ids(radius)).toEqual(
          [activityRows[0].id, activityRows[1].id].sort(),
        );
        const carServices = await available({
          city,
          vehicleType: 'FOUR_WHEELER',
        });
        expect(ids(carServices)).toContain(activityRows[2].id);
        expect(
          (await available({ city: 'Area with no centers' })).body.items,
        ).toEqual([]);

        // Every advertised tile qualifies at least one center using the same area/type.
        for (const item of radius.body.items) {
          const matching = await http()
            .get('/v1/marketplace/centers')
            .query({
              lat: 15.1234,
              lng: 73.4567,
              radiusMeters: 1000,
              vehicleType: 'TWO_WHEELER',
              serviceId: item.id,
            })
            .expect(200);
          expect(matching.body.items.length).toBeGreaterThan(0);
        }
        await offerings.update(rows[1].id, {
          vehicleType: 'FOUR_WHEELER' as any,
        });
        expect(
          ids(
            await available({
              lat: 15.1234,
              lng: 73.4567,
              radiusMeters: 1000,
              vehicleType: 'TWO_WHEELER',
            }),
          ),
        ).toEqual([activityRows[0].id]);
      } finally {
        await centers.delete(centerRows.map((row) => row.id));
        await definitions.delete(activityRows.map((row) => row.id));
      }
    },
  );
  pgIt(
    'filters an exact PIN and orders known coordinate distances in either direction',
    async () => {
      const definitions = db.getRepository(ServiceDefinition);
      const centers = db.getRepository(ServiceCenter);
      const offerings = db.getRepository(ServiceOffering);
      const postalCode = '734901';
      const activities = await definitions.save(
        Array.from({ length: 4 }, (_, index) =>
          definitions.create({
            id: randomUUID(),
            slug: `pin-filter-${index}`,
            name: `PIN filter service ${index}`,
            category: 'PIN filter tests',
            description: 'PIN and distance filter regression',
            aliases: [],
            vehicleTypes: ['TWO_WHEELER'] as any,
            isActive: true,
          }),
        ),
      );
      const centerRows = await centers.save(
        [
          'Near',
          'Far',
          'No coordinates',
          'Adjacent PIN',
          'Inactive',
          'Deleted',
          'Outside radius',
        ].map((name, index) =>
          centers.create({
            iamDomainId: randomUUID(),
            name,
            city: 'PIN filter city',
            postalCode: index === 3 ? '734902' : postalCode,
            latitude:
              index === 2
                ? null
                : index === 1
                  ? 15.2234
                  : index === 6
                    ? 16.1234
                    : 15.1234,
            longitude: index === 2 ? null : 73.4567,
            status: index === 4 ? ('INACTIVE' as any) : ('ACTIVE' as any),
            supportedVehicleTypes: ['TWO_WHEELER'] as any,
            photoUrls:
              index === 0 ? ['https://images.example.test/garage.jpg'] : [],
            googleMapsUrl:
              index === 0
                ? 'https://www.google.com/maps/search/?api=1&query=15.1234,73.4567'
                : null,
          }),
        ),
      );
      const [near, far, noCoordinates, adjacent, inactive, deleted, outside] =
        centerRows;
      const offer = (center: ServiceCenter, activity: ServiceDefinition) =>
        offerings.create({
          serviceCenterId: center.id,
          serviceDefinitionId: activity.id,
          name: activity.name,
          priceInr: '100.00',
          durationMinutes: 30,
        });
      await offerings.save([
        offer(near, activities[0]),
        offer(far, activities[0]),
        offer(noCoordinates, activities[1]),
        offer(outside, activities[2]),
        offer(adjacent, activities[3]),
        offer(inactive, activities[3]),
        offer(deleted, activities[3]),
      ]);
      await centers.softDelete(deleted.id);
      const ids = (response: request.Response) =>
        response.body.items.map((row: any) => row.id);
      try {
        const pinOnly = await http()
          .get('/v1/marketplace/centers')
          .query({ postalCode: ` ${postalCode} ` })
          .expect(200);
        expect(ids(pinOnly).sort()).toEqual(
          [near.id, far.id, noCoordinates.id, outside.id].sort(),
        );
        expect(
          pinOnly.body.items.every((row: any) => row.distanceMeters === null),
        ).toBe(true);
        expect(
          pinOnly.body.items.find((row: any) => row.id === near.id),
        ).toMatchObject({
          postalCode,
          photoUrls: near.photoUrls,
          googleMapsUrl: near.googleMapsUrl,
        });
        const detail = await http()
          .get(`/v1/marketplace/centers/${near.id}`)
          .expect(200);
        expect(detail.body).toMatchObject({
          postalCode,
          photoUrls: near.photoUrls,
          googleMapsUrl: near.googleMapsUrl,
        });
        const local = await http()
          .get('/v1/marketplace/available-services')
          .query({ postalCode, vehicleType: 'TWO_WHEELER' })
          .expect(200);
        expect(ids(local).sort()).toEqual(
          activities
            .slice(0, 3)
            .map((row) => row.id)
            .sort(),
        );
        const origin = {
          postalCode,
          lat: 15.1234,
          lng: 73.4567,
          radiusMeters: 15000,
        };
        const nearest = await http()
          .get('/v1/marketplace/centers')
          .query({ ...origin, sort: 'nearest' })
          .expect(200);
        const farthest = await http()
          .get('/v1/marketplace/centers')
          .query({ ...origin, sort: 'farthest' })
          .expect(200);
        expect(ids(nearest)).toEqual([near.id, far.id]);
        expect(ids(farthest)).toEqual([far.id, near.id]);
        expect(nearest.body.items[0].distanceMeters).toBeLessThan(
          nearest.body.items[1].distanceMeters,
        );
        expect(nearest.body.items[1].distanceMeters).toBeGreaterThan(10000);
        const first = await http()
          .get('/v1/marketplace/centers')
          .query({ ...origin, sort: 'farthest', limit: 1 })
          .expect(200);
        const second = await http()
          .get('/v1/marketplace/centers')
          .query({
            ...origin,
            sort: 'farthest',
            limit: 1,
            offset: first.body.nextOffset,
          })
          .expect(200);
        expect(ids(first)).toEqual([far.id]);
        expect(ids(second)).toEqual([near.id]);
        expect(second.body.nextOffset).toBeNull();
        const within = await http()
          .get('/v1/marketplace/available-services')
          .query(origin)
          .expect(200);
        expect(ids(within)).toEqual([activities[0].id]);
      } finally {
        await centers.delete(centerRows.map((row) => row.id));
        await definitions.delete(activities.map((row) => row.id));
      }
    },
  );
  pgIt(
    'paginates localized services beyond 200 without counting centers or repeated offerings',
    async () => {
      const definitions = db.getRepository(ServiceDefinition);
      const centers = db.getRepository(ServiceCenter);
      const offerings = db.getRepository(ServiceOffering);
      const center = await centers.save({
        iamDomainId: randomUUID(),
        name: 'Availability pagination center',
        city: 'Availability pagination city',
        supportedVehicleTypes: ['TWO_WHEELER'] as any,
      });
      const activities = await definitions.save(
        Array.from({ length: 201 }, (_, index) =>
          definitions.create({
            id: randomUUID(),
            slug: `local-page-${index}`,
            name: `Local service ${String(index).padStart(3, '0')}`,
            category: 'Local page tests',
            description: 'Paginated local availability',
            aliases: [],
            vehicleTypes: ['TWO_WHEELER'] as any,
            isActive: true,
          }),
        ),
      );
      await offerings.save(
        activities.map((activity) =>
          offerings.create({
            serviceCenterId: center.id,
            serviceDefinitionId: activity.id,
            name: activity.name,
            priceInr: '100.00',
            durationMinutes: 30,
          }),
        ),
      );
      try {
        const first = await http()
          .get('/v1/marketplace/available-services')
          .query({ city: center.city })
          .expect(200);
        expect(first.body.items).toHaveLength(200);
        expect(first.body.nextOffset).toBe(200);
        const second = await http()
          .get('/v1/marketplace/available-services')
          .query({ city: center.city, offset: first.body.nextOffset })
          .expect(200);
        expect(second.body.items).toHaveLength(1);
        expect(second.body.nextOffset).toBeNull();
        expect(
          [...first.body.items, ...second.body.items].map((row: any) => row.id),
        ).toEqual(activities.map((row) => row.id));
      } finally {
        await centers.delete(center.id);
        await definitions.delete(activities.map((row) => row.id));
      }
    },
  );
  it('requires a coherent bounded area for localized service availability', async () => {
    for (const query of [
      '',
      '?city=',
      '?city=%20',
      '?lat=&lng=77',
      '?lat=12&lng=%20',
      '?lat=12',
      '?lng=77',
      '?radiusMeters=1000',
      '?city=Bengaluru&lat=12&lng=77',
      '?lat=91&lng=77',
      '?lat=12&lng=181',
      '?city=Bengaluru&limit=201',
      '?city=Bengaluru&offset=-1',
      '?city=Bengaluru&vehicleType=CAR',
      '?postalCode=5600',
      '?postalCode=012345',
      '?city=Bengaluru&postalCode=560001',
    ]) {
      await http()
        .get(`/v1/marketplace/available-services${query}`)
        .expect(400);
    }
  });
  it('publishes the approved default and refuses an invalid configured city', async () => {
    const cityBefore = process.env.DISCOVERY_DEFAULT_CITY;
    const labelBefore = process.env.DISCOVERY_DEFAULT_LABEL;
    try {
      delete process.env.DISCOVERY_DEFAULT_CITY;
      delete process.env.DISCOVERY_DEFAULT_LABEL;
      const unset = await http()
        .get('/v1/marketplace/discovery-config')
        .expect(200);
      expect(unset.body).toEqual({
        defaultLocation: {
          mode: 'CITY',
          city: 'Bengaluru',
          label: 'Bengaluru',
        },
        radiusMeters: 15000,
      });
      process.env.DISCOVERY_DEFAULT_CITY = '  ';
      expect(
        (await http().get('/v1/marketplace/discovery-config').expect(200)).body,
      ).toEqual(unset.body);
      process.env.DISCOVERY_DEFAULT_CITY = '  Pune  ';
      process.env.DISCOVERY_DEFAULT_LABEL = '  Pune, Maharashtra  ';
      const configured = await http()
        .get('/v1/marketplace/discovery-config')
        .expect(200);
      expect(configured.body).toEqual({
        defaultLocation: {
          mode: 'CITY',
          city: 'Pune',
          label: 'Pune, Maharashtra',
        },
        radiusMeters: 15000,
      });
      process.env.DISCOVERY_DEFAULT_CITY = 'x'.repeat(101);
      expect(
        (await http().get('/v1/marketplace/discovery-config').expect(200)).body
          .defaultLocation,
      ).toBeNull();
    } finally {
      if (cityBefore === undefined) delete process.env.DISCOVERY_DEFAULT_CITY;
      else process.env.DISCOVERY_DEFAULT_CITY = cityBefore;
      if (labelBefore === undefined) delete process.env.DISCOVERY_DEFAULT_LABEL;
      else process.env.DISCOVERY_DEFAULT_LABEL = labelBefore;
    }
  });
  pgIt(
    'rolls back a menu edit and receipt when audit storage fails',
    async () => {
      const spy = jest
        .spyOn(app.get(EventsService), 'writeAuditLog')
        .mockRejectedValueOnce(new Error('AF029 injected audit failure'));
      await command(
        http().patch(`/v1/center/offerings/${battery.id}`),
        battery.version,
      )
        .send({ priceInr: 888 })
        .expect(500);
      spy.mockRestore();
      const row = await db
        .getRepository(ServiceOffering)
        .findOneByOrFail({ id: battery.id });
      expect(row.version).toBe(battery.version);
      expect(Number(row.priceInr)).toBe(200);
    },
  );
  pgIt(
    'excludes incompatible legacy offers even before a vehicle is chosen',
    async () => {
      await db.getRepository(ServiceCenter).update(otherCenterId, {
        supportedVehicleTypes: ['TWO_WHEELER'] as any,
      });
      const invalid = await db.getRepository(ServiceOffering).save({
        serviceCenterId: otherCenterId,
        name: 'Legacy alignment',
        serviceDefinitionId: definition(1),
        vehicleType: 'FOUR_WHEELER' as any,
        priceInr: '500.00',
        durationMinutes: 30,
      });
      const result = await http()
        .get('/v1/marketplace/centers')
        .query({ serviceId: definition(1) })
        .expect(200);
      expect(result.body.items).toHaveLength(0);
      await db.getRepository(ServiceOffering).softDelete(invalid.id);
    },
  );
  it('soft-deletes a service without erasing the scope of an existing booking', async () => {
    await command(
      http().delete(`/v1/center/offerings/${brake.id}`),
      brake.version,
    ).expect(204);
    expect(
      await db.getRepository(ServiceOffering).findOneBy({ id: brake.id }),
    ).toBeNull();
    const historic = await http()
      .get(`/v1/bookings/${booking.id}`)
      .set('Authorization', `Bearer ${customer}`)
      .expect(200);
    expect(historic.body.items[0].scope[0]).toMatchObject({
      name: 'Brake inspection',
      quantity: 1,
    });
    const current = await db
      .getRepository(ServicePackage)
      .findOneByOrFail({ id: bundle.id });
    const body = {
      name: current.name,
      description: current.description,
      vehicleType: current.vehicleType,
      priceInr: Number(current.priceInr),
      priceIsStarting: current.priceIsStarting,
      durationMinutes: current.durationMinutes,
      components: current.components,
      isActive: false,
    };
    const paused = await command(
      http().put(`/v1/center/packages/${bundle.id}`),
      current.version,
    )
      .send(body)
      .expect(200);
    expect(paused.body.available).toBe(false);
    await command(
      http().put(`/v1/center/packages/${bundle.id}`),
      paused.body.version,
    )
      .send({ ...body, isActive: true })
      .expect(400);
    const privateMenu = await staff(http().get('/v1/center/packages')).expect(
      200,
    );
    expect(privateMenu.body[0].components[0].name).toBe('Brake inspection');
  });
  pgIt(
    'serializes conflicting manager edits so only one version wins',
    async () => {
      const results = await Promise.all(
        [201, 202].map((priceInr) =>
          command(
            http().patch(`/v1/center/offerings/${battery.id}`),
            battery.version,
          ).send({ priceInr }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    },
  );
  pgIt(
    'serializes the final slot reservation under the same center lock',
    async () => {
      await db
        .getRepository(ServiceCenter)
        .update(otherCenterId, { slotCapacity: 1 });
      const body = {
        serviceCenterId: otherCenterId,
        vehicleId,
        mode: 'SELF_CHECKIN',
        ...slot,
        issueDescription: 'Inspect the vehicle',
      };
      const results = await Promise.all(
        [0, 1].map(() =>
          http()
            .post('/v1/bookings')
            .set('Authorization', `Bearer ${customer}`)
            .set('Idempotency-Key', randomUUID())
            .send(body),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
      expect(
        await db
          .getRepository(Booking)
          .countBy({ serviceCenterId: otherCenterId }),
      ).toBe(1);
    },
  );
  it('rejects invalid coordinates, oversized pages and malformed service filters', async () => {
    await http().get('/v1/marketplace/centers?lat=95&lng=0').expect(400);
    await http().get('/v1/marketplace/centers?limit=500').expect(400);
    await http().get('/v1/marketplace/centers?serviceId=anything').expect(400);
    await http().get('/v1/marketplace/centers?sort=recommended').expect(400);
    await http().get('/v1/marketplace/centers?sort=nearest').expect(400);
    await http()
      .get('/v1/marketplace/centers?sort=farthest&postalCode=560001')
      .expect(400);
    await http().get('/v1/marketplace/centers?postalCode=bad').expect(400);
    await http()
      .get('/v1/marketplace/centers?city=Bengaluru&postalCode=560001')
      .expect(400);
    await http().get('/v1/marketplace/centers?serviceIds=anything').expect(400);
    await http().get('/v1/marketplace/centers?serviceIds=').expect(400);
    await http()
      .get(`/v1/marketplace/centers?serviceIds=${definition(1)}&serviceIds=`)
      .expect(400);
    await http()
      .get(
        `/v1/marketplace/centers?serviceIds=${definition(1)},${definition(2)}`,
      )
      .expect(400);
    const tooMany = new URLSearchParams();
    for (let n = 1; n <= 11; n++) tooMany.append('serviceIds', definition(n));
    await http()
      .get(`/v1/marketplace/centers?${tooMany.toString()}`)
      .expect(400);
    const combined = new URLSearchParams({ serviceId: definition(11) });
    for (let n = 1; n <= 10; n++) combined.append('serviceIds', definition(n));
    await http()
      .get(`/v1/marketplace/centers?${combined.toString()}`)
      .expect(400);
  });
  it('pages through an activity catalog larger than 200 entries', async () => {
    const repo = db.getRepository(ServiceDefinition);
    await repo.save(
      Array.from({ length: 201 }, (_, i) =>
        repo.create({
          id: randomUUID(),
          slug: `catalog-extra-${i}`,
          name: `Extra activity ${String(i).padStart(3, '0')}`,
          category: 'Extra',
          description: 'Test activity',
          aliases: [],
          vehicleTypes: ['TWO_WHEELER'] as any,
          isActive: true,
        }),
      ),
    );
    const first = await http().get('/v1/marketplace/services').expect(200);
    expect(first.body.items).toHaveLength(200);
    expect(first.body.nextOffset).toBe(200);
    const second = await http()
      .get('/v1/marketplace/services?offset=200')
      .expect(200);
    expect(second.body.items).toHaveLength(13);
    expect(second.body.nextOffset).toBeNull();
  });

  it('limits anonymous preview bursts across centers before menu resolution, without blocking reservation or reads', async () => {
    const service = app.get(OfferingsService);
    const resolve = jest.spyOn(service, 'validateSelections');
    try {
      let limited: request.Response | undefined;
      for (let n = 0; n <= BOOKING_SELECTION_LIMITS.maxRequests; n++) {
        const response = await validate([]);
        if (response.status === 429) {
          limited = response;
          break;
        }
        expect(response.status).toBe(200);
      }
      expect(limited?.body.code).toBe('BOOKING_PREVIEW_RATE_LIMITED');
      const wait = Number(limited?.headers['retry-after']);
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(60);
      expect(limited?.body.retryAfterSeconds).toBe(wait);
      expect(limited?.headers['cache-control']).toBe('no-store');
      const calls = resolve.mock.calls.length;
      await validate([], undefined, otherCenterId)
        .set('X-Forwarded-For', '203.0.113.99')
        .expect(429);
      await http()
        .post(`/v1/centers/${centerId}/booking-selection`)
        .send({ selections: null })
        .expect(429);
      expect(resolve).toHaveBeenCalledTimes(calls);
      await http().get(`/v1/centers/${centerId}/booking-options`).expect(200);
      await book([]).expect(201);
    } finally {
      resolve.mockRestore();
    }
  });
});
