import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { GarageVehicleStatus } from '../src/common/enums/garage-vehicle-status.enum';
import { VehicleType } from '../src/common/enums/vehicle-type.enum';
import { GarageVehicle } from '../src/modules/customers/entities/garage-vehicle.entity';
import { createJwtTestFixture } from '../src/test-utils/jwt-test.helper';
import {
  VehicleCatalogColour,
  VehicleCatalogConfiguration,
  VehicleCatalogMake,
  VehicleCatalogModel,
} from '../src/modules/vehicle-catalog/vehicle-catalog.entity';
import { VehicleCatalogImporter } from '../src/modules/vehicle-catalog/vehicle-catalog.importer';
import { createE2eApp } from './helpers/e2e-app.helper';
import {
  TEST_CUSTOMER_APP_ID,
  TEST_CUSTOMER_DOMAIN_ID,
  TEST_CUSTOMER_IAM_USER_ID,
} from './helpers/test-db.helper';

describe('Vehicle catalogue (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let customer: string;
  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test) =>
    req.set('Authorization', `Bearer ${customer}`);

  beforeAll(async () => {
    process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID = TEST_CUSTOMER_APP_ID;
    const fixture = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = fixture.jwksJson;
    const ctx = await createE2eApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    const importer = new VehicleCatalogImporter(dataSource);
    const first = await importer.importFromSeed();
    const coloursAfterFirst = await dataSource
      .getRepository(VehicleCatalogColour)
      .count();
    expect(coloursAfterFirst).toBeGreaterThan(0);
    const second = await importer.importFromSeed();
    expect(second).toEqual(first);
    expect(await dataSource.getRepository(VehicleCatalogMake).count()).toBe(
      first.makes,
    );
    expect(await dataSource.getRepository(VehicleCatalogModel).count()).toBe(
      first.models,
    );
    expect(
      await dataSource.getRepository(VehicleCatalogConfiguration).count(),
    ).toBe(first.configurations);
    expect(await dataSource.getRepository(VehicleCatalogColour).count()).toBe(
      coloursAfterFirst,
    );
    customer = await fixture.signAccessToken({
      sub: TEST_CUSTOMER_IAM_USER_ID,
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      mobile: '9876543210',
      roles: ['customer'],
      permissions: [],
    });
    await auth(http().put('/v1/me/profile'))
      .send({ displayName: 'Catalogue Test', dateOfBirth: '1994-03-12' })
      .expect(200);
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  it('lists Hyundai i20 Asta petrol 5MT and no colours', async () => {
    const res = await auth(http().get('/v1/vehicle-catalog')).expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('imagePath');
    expect(body).not.toContain('aeplcdn');
    const hyundai = (
      res.body.makes as Array<{
        name: string;
        models: Array<{
          name: string;
          bodyStyle: string;
          configurations: Array<{
            variant: string;
            fuel: string;
            gearboxCode: string;
            colours: string[];
          }>;
        }>;
      }>
    ).find((make) => make.name === 'Hyundai');
    const i20 = hyundai?.models.find((model) => model.name === 'i20');
    expect(i20?.bodyStyle).toBe('hatchback');
    expect(i20?.configurations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variant: 'Asta',
          fuel: 'Petrol',
          gearboxCode: '5MT',
          colours: expect.arrayContaining(['Atlas White', 'Fiery Red']),
        }),
      ]),
    );
  });

  it('stores the catalogue identity when a car is saved', async () => {
    const catalog = await auth(http().get('/v1/vehicle-catalog')).expect(200);
    const hyundai = (
      catalog.body.makes as Array<{
        name: string;
        models: Array<{
          name: string;
          configurations: Array<{ id: string; variant: string; fuel: string; gearboxCode: string }>;
        }>;
      }>
    ).find((make) => make.name === 'Hyundai');
    const configuration = hyundai?.models
      .find((model) => model.name === 'i20')
      ?.configurations.find(
        (item) =>
          item.variant === 'Asta' &&
          item.fuel === 'Petrol' &&
          item.gearboxCode === '5MT',
      );
    expect(configuration).toBeDefined();

    const created = await auth(http().post('/v1/me/vehicles'))
      .send({
        vehicleType: 'FOUR_WHEELER',
        catalogConfigurationId: configuration?.id,
        registrationNumber: 'KA03MN4567',
        year: 2021,
        color: 'Polar White',
      })
      .expect(201);
    expect(created.body.catalogConfigurationId).toBe(configuration?.id);
    expect(created.body.make).toBe('Hyundai');
    expect(created.body.model).toBe('i20');
    expect(created.body.variant).toBe('Asta');
    expect(created.body.fuel).toBe('Petrol');
    expect(created.body.transmission).toBe('5MT');

    await auth(http().post('/v1/me/vehicles'))
      .send({
        vehicleType: 'FOUR_WHEELER',
        catalogConfigurationId: configuration?.id,
        make: 'Tata',
        registrationNumber: 'KA03MN9999',
      })
      .expect(400);
  });

  it('rejects an unknown configuration id', async () => {
    await auth(http().post('/v1/me/vehicles'))
      .send({
        vehicleType: 'FOUR_WHEELER',
        catalogConfigurationId: '00000000-0000-4000-8000-000000000000',
        registrationNumber: 'KA09ZZ0001',
      })
      .expect(400);
  });

  it('keeps a catalogue-linked car when only the odometer is patched', async () => {
    const catalog = await auth(http().get('/v1/vehicle-catalog')).expect(200);
    const configuration = (
      catalog.body.makes as Array<{
        name: string;
        models: Array<{
          name: string;
          configurations: Array<{ id: string; variant: string; gearboxCode: string }>;
        }>;
      }>
    )
      .find((make) => make.name === 'Hyundai')
      ?.models.find((model) => model.name === 'i20')
      ?.configurations.find(
        (item) => item.variant === 'Asta' && item.gearboxCode === '5MT',
      );
    const created = await auth(http().post('/v1/me/vehicles'))
      .send({
        vehicleType: 'FOUR_WHEELER',
        catalogConfigurationId: configuration?.id,
        registrationNumber: 'KA03OD15000',
      })
      .expect(201);

    const patched = await auth(http().patch(`/v1/me/vehicles/${created.body.id}`))
      .send({ currentOdometerKm: 15000, make: 'Tata' })
      .expect(200);
    expect(patched.body.currentOdometerKm).toBe(15000);
    expect(patched.body.catalogConfigurationId).toBe(configuration?.id);
    expect(patched.body.make).toBe('Hyundai');
    expect(patched.body.model).toBe('i20');
    expect(patched.body.variant).toBe('Asta');
    expect(patched.body.transmission).toBe('5MT');
  });

  it('keeps a car that has no catalogue id when only the odometer is patched', async () => {
    const profile = await auth(http().get('/v1/me/profile')).expect(200);
    const repo = dataSource.getRepository(GarageVehicle);
    const saved = await repo.save(
      repo.create({
        customerProfileId: profile.body.id,
        vehicleType: VehicleType.FOUR_WHEELER,
        make: 'Hyundai',
        model: 'Santro',
        variant: 'Magna',
        registrationNumber: 'KA01OLD001',
        catalogConfigurationId: null,
        status: GarageVehicleStatus.ACTIVE,
      }),
    );

    const patched = await auth(http().patch(`/v1/me/vehicles/${saved.id}`))
      .send({ currentOdometerKm: 15000 })
      .expect(200);
    expect(patched.body.currentOdometerKm).toBe(15000);
    expect(patched.body.catalogConfigurationId).toBeNull();
    expect(patched.body.make).toBe('Hyundai');
    expect(patched.body.model).toBe('Santro');
    expect(patched.body.variant).toBe('Magna');
  });

  it('creates a two-wheeler without a catalogue id', async () => {
    const created = await auth(http().post('/v1/me/vehicles'))
      .send({
        vehicleType: 'TWO_WHEELER',
        make: 'Honda',
        model: 'Activa 6G',
        registrationNumber: 'KA01AB1234',
      })
      .expect(201);
    expect(created.body.catalogConfigurationId).toBeNull();
    expect(created.body.make).toBe('Honda');
    expect(created.body.model).toBe('Activa 6G');
  });
});
