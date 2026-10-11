import { INestApplication } from '@nestjs/common';
import { IBackup } from 'pg-mem';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuthContext } from '../src/modules/auth/interfaces/auth-context.interface';
import { CustomerProfile } from '../src/modules/customers/entities/customer-profile.entity';
import { MeService } from '../src/modules/customers/me.service';
import { createJwtTestFixture } from '../src/test-utils/jwt-test.helper';
import { createE2eApp } from './helpers/e2e-app.helper';
import {
  TEST_CUSTOMER_APP_ID,
  TEST_CUSTOMER_DOMAIN_ID,
  TEST_CUSTOMER_IAM_USER_ID,
} from './helpers/test-db.helper';

describe('Customer saved marketplace location (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let backup: IBackup;
  let customerToken: string;
  let otherCustomerToken: string;
  const otherCustomerId = '77777777-7777-4777-8777-777777777777';
  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test, token = customerToken) =>
    req.set('Authorization', `Bearer ${token}`);
  const write = (body: Record<string, unknown>, token = customerToken) =>
    auth(http().put('/v1/me/profile'), token).send(body);
  const read = (token = customerToken) =>
    auth(http().get('/v1/me/profile'), token);
  const location = {
    city: null,
    selectedPlaceLabel: 'Bengaluru current location',
    lastLat: 12.9716,
    lastLng: 77.5946,
  };

  beforeAll(async () => {
    process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID = TEST_CUSTOMER_APP_ID;
    const fixture = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = fixture.jwksJson;
    const context = await createE2eApp();
    app = context.app;
    dataSource = context.dataSource;
    const claims = {
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      roles: ['customer'],
      permissions: [],
    };
    customerToken = await fixture.signAccessToken({
      ...claims,
      sub: TEST_CUSTOMER_IAM_USER_ID,
      mobile: '9876543210',
    });
    otherCustomerToken = await fixture.signAccessToken({
      ...claims,
      sub: otherCustomerId,
      mobile: '9876543211',
    });
    await write({ displayName: 'Location customer', ...location }).expect(200);
    backup = context.memoryDb.backup();
  }, 60000);

  beforeEach(() => backup.restore());
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => app?.close());

  it('switches from coordinates to a trimmed city and back without retaining the previous mode', async () => {
    const city = await write({
      city: '  Pune  ',
      selectedPlaceLabel: '  Pune, Maharashtra  ',
      lastLat: null,
      lastLng: null,
    }).expect(200);
    expect(city.body).toMatchObject({
      city: 'Pune',
      selectedPlaceLabel: 'Pune, Maharashtra',
      lastLat: null,
      lastLng: null,
    });

    const coordinates = await write({
      city: null,
      selectedPlaceLabel: '  Current location  ',
      lastLat: 18.5204,
      lastLng: 73.8567,
    }).expect(200);
    const expected = {
      city: null,
      selectedPlaceLabel: 'Current location',
      lastLat: 18.5204,
      lastLng: 73.8567,
    };
    expect(coordinates.body).toMatchObject(expected);
    expect((await read().expect(200)).body).toMatchObject(expected);
  });

  it('clears the saved location explicitly and preserves it during an unrelated partial update', async () => {
    const updated = await write({ displayName: 'Updated name' }).expect(200);
    expect(updated.body).toMatchObject({
      ...location,
      displayName: 'Updated name',
    });
    expect((await read().expect(200)).body).toMatchObject(location);

    const cleared = await write({
      city: null,
      selectedPlaceLabel: null,
      lastLat: null,
      lastLng: null,
    }).expect(200);
    expect(cleared.body).toMatchObject({
      city: null,
      selectedPlaceLabel: null,
      lastLat: null,
      lastLng: null,
      displayName: 'Updated name',
    });
    expect((await read().expect(200)).body).toMatchObject({
      city: null,
      selectedPlaceLabel: null,
      lastLat: null,
      lastLng: null,
    });
  });

  it.each([
    ['latitude only', { lastLat: 19 }],
    ['longitude only', { lastLng: 73 }],
    ['latitude clear only', { lastLat: null }],
    ['longitude clear only', { lastLng: null }],
    ['null latitude with longitude', { lastLat: null, lastLng: 73 }],
    ['latitude with null longitude', { lastLat: 19, lastLng: null }],
    ['latitude below range', { lastLat: -90.001, lastLng: 73 }],
    ['latitude above range', { lastLat: 90.001, lastLng: 73 }],
    ['longitude below range', { lastLat: 19, lastLng: -180.001 }],
    ['longitude above range', { lastLat: 19, lastLng: 180.001 }],
    ['blank latitude', { lastLat: '', lastLng: 73 }],
    ['blank longitude', { lastLat: 19, lastLng: ' ' }],
    ['numeric latitude string', { lastLat: '19', lastLng: 73 }],
    ['numeric longitude string', { lastLat: 19, lastLng: '73' }],
    ['boolean latitude', { lastLat: false, lastLng: 73 }],
    ['boolean longitude', { lastLat: 19, lastLng: true }],
    ['array coordinate', { lastLat: [19], lastLng: 73 }],
    ['object coordinate', { lastLat: 19, lastLng: { value: 73 } }],
    ['blank city', { city: '   ' }],
    ['overlong city', { city: 'x'.repeat(101) }],
    ['non-string city', { city: 123 }],
    ['blank place label', { selectedPlaceLabel: '  ' }],
    ['overlong place label', { selectedPlaceLabel: 'x'.repeat(256) }],
    ['non-string place label', { selectedPlaceLabel: false }],
  ])(
    'rejects %s without changing any profile fields',
    async (_description, body) => {
      const before = (await read().expect(200)).body;
      await write({ displayName: 'Must not be saved', ...body }).expect(400);
      expect((await read().expect(200)).body).toEqual(before);
    },
  );

  it.each([
    [-90, -180],
    [90, 180],
    [0, 0],
  ])(
    'accepts inclusive coordinate boundaries %s, %s',
    async (lastLat, lastLng) => {
      const response = await write({ lastLat, lastLng }).expect(200);
      expect(response.body).toMatchObject({ lastLat, lastLng });
      expect((await read().expect(200)).body).toMatchObject({
        lastLat,
        lastLng,
      });
    },
  );

  it('does not partially save a location when another field fails service validation', async () => {
    const before = (await read().expect(200)).body;
    await write({
      displayName: 'Must not be saved',
      city: 'Mumbai',
      selectedPlaceLabel: 'Attempted location',
      lastLat: 19.076,
      lastLng: 72.8777,
      dateOfBirth: '2999-01-01',
    }).expect(400);
    expect((await read().expect(200)).body).toEqual(before);
  });

  it('saves location only on the authenticated customer and does not create a profile on failed validation', async () => {
    await read(otherCustomerToken).expect(404);
    await write({ city: 'Pune', lastLat: 18.52 }, otherCustomerToken).expect(
      400,
    );
    await read(otherCustomerToken).expect(404);

    const other = await write(
      {
        city: 'Pune',
        selectedPlaceLabel: 'Pune',
        lastLat: null,
        lastLng: null,
      },
      otherCustomerToken,
    ).expect(200);
    expect(other.body).toMatchObject({
      iamUserId: otherCustomerId,
      city: 'Pune',
      selectedPlaceLabel: 'Pune',
      lastLat: null,
      lastLng: null,
    });
    const original = (await read().expect(200)).body;
    expect(original).toMatchObject({
      iamUserId: TEST_CUSTOMER_IAM_USER_ID,
      ...location,
    });
    expect(other.body.id).not.toBe(original.id);
  });

  it('keeps each coordinate pair intact when concurrent writes read the same previous profile', async () => {
    await write({ lastLat: 10, lastLng: 20 }).expect(200);
    const repository = dataSource.getRepository(CustomerProfile);
    const findOne = repository.findOne.bind(repository);
    let release: () => void;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    // Force both commands to read the same original pair. Each requested pair
    // keeps one old coordinate, exposing diff-saving that could create (40, 30).
    jest.spyOn(repository, 'findOne').mockImplementation(async (options) => {
      const profile = await findOne(options);
      reads += 1;
      if (reads === 2) release();
      await bothRead;
      return profile;
    });
    const authContext: AuthContext = {
      actorType: 'customer',
      userId: TEST_CUSTOMER_IAM_USER_ID,
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      roles: ['customer'],
      permissions: [],
      serviceCenterId: null,
      staffProfileId: null,
      customerProfileId: null,
    };
    const service = app.get(MeService);
    await Promise.all([
      service.upsertProfile(authContext, { lastLat: 10, lastLng: 30 }),
      service.upsertProfile(authContext, { lastLat: 40, lastLng: 20 }),
    ]);
    jest.restoreAllMocks();
    const final = (await read().expect(200)).body;
    expect([
      [10, 30],
      [40, 20],
    ]).toContainEqual([final.lastLat, final.lastLng]);
  });
});
