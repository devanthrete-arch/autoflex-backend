import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ServiceCenter } from '../src/modules/tenancy/entities/service-center.entity';
import { createJwtTestFixture } from '../src/test-utils/jwt-test.helper';
import { createE2eApp } from './helpers/e2e-app.helper';
import {
  seedTestTenancy,
  TEST_DOMAIN_ID,
  TEST_IAM_USER_ID,
  TEST_OTHER_DOMAIN_ID,
  TEST_OTHER_USER_ID,
} from './helpers/test-db.helper';

const photo = 'https://images.example.test/workshop.jpg';
const maps = 'https://www.google.com/maps/search/?api=1&query=12.9716,77.5946';

describe('Center discovery profile (e2e)', () => {
  let app: INestApplication<App>;
  let db: DataSource;
  let centerId: string;
  let otherCenterId: string;
  let manager: string;
  let admin: string;
  let advisor: string;
  let technician: string;
  let noPermission: string;
  let otherManager: string;
  let wrongMembership: string;
  const http = () => request(app.getHttpServer());
  const patch = (body: unknown, token = manager) =>
    http()
      .patch('/v1/center')
      .set('Authorization', `Bearer ${token}`)
      .send(body as string | object);
  const stored = (id = centerId) =>
    db.getRepository(ServiceCenter).findOneByOrFail({ id });

  beforeAll(async () => {
    const fixture = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = fixture.jwksJson;
    const context = await createE2eApp();
    app = context.app;
    db = context.dataSource;
    const tenancy = await seedTestTenancy(db);
    centerId = tenancy.serviceCenter.id;
    otherCenterId = tenancy.otherCenter.id;
    const token = (role: string, permissions = ['center:manage']) =>
      fixture.signAccessToken({
        sub: TEST_IAM_USER_ID,
        domainId: TEST_DOMAIN_ID,
        roles: [role],
        permissions,
      });
    [manager, admin, advisor, technician, noPermission] = await Promise.all([
      token('manager'),
      token('admin'),
      token('advisor'),
      token('technician'),
      token('manager', []),
    ]);
    otherManager = await fixture.signAccessToken({
      sub: TEST_OTHER_USER_ID,
      domainId: TEST_OTHER_DOMAIN_ID,
      roles: ['manager'],
      permissions: ['center:manage'],
    });
    wrongMembership = await fixture.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_OTHER_DOMAIN_ID,
      roles: ['manager'],
      permissions: ['center:manage'],
    });
  }, 60000);

  beforeEach(async () => {
    await db.getRepository(ServiceCenter).update(centerId, {
      displayName: 'Original workshop',
      city: 'Bengaluru',
      postalCode: '560001',
      latitude: 12.9716,
      longitude: 77.5946,
      photoUrls: [photo],
      googleMapsUrl: maps,
      upiVpa: 'original@bank',
    });
  });

  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
  });

  it('allows a same-center manager or admin and preserves paired coordinates', async () => {
    for (const token of [manager, admin]) {
      const result = await patch(
        { latitude: 0, longitude: 0, city: '  Pune  ', postalCode: '411001' },
        token,
      ).expect(200);
      expect(result.body).toMatchObject({
        id: centerId,
        latitude: 0,
        longitude: 0,
        address: { city: 'Pune', postalCode: '411001' },
      });
    }
  });

  it('denies advisor, technician, missing permission and foreign membership without changes', async () => {
    const before = await stored();
    for (const token of [advisor, technician, noPermission])
      await patch({ latitude: 15, longitude: 75, photoUrls: [] }, token).expect(
        403,
      );
    // A signed token cannot manufacture a staff membership in another domain.
    await patch(
      { latitude: 15, longitude: 75, photoUrls: [] },
      wrongMembership,
    ).expect(404);
    expect(await stored()).toEqual(before);
  });

  it('scopes an authorized foreign manager to their own center', async () => {
    const before = await stored();
    const result = await patch(
      { latitude: 10, longitude: 70, photoUrls: [], googleMapsUrl: null },
      otherManager,
    ).expect(200);
    expect(result.body.id).toBe(otherCenterId);
    expect(result.body.latitude).toBe(10);
    expect((await stored(otherCenterId)).longitude).toBe(70);
    expect(await stored()).toEqual(before);
    await patch({ id: otherCenterId, postalCode: '411001' }).expect(400);
    expect(await stored()).toEqual(before);
  });

  it.each([
    ['latitude alone', { latitude: 15 }],
    ['longitude alone', { longitude: 75 }],
    ['latitude-only clearing', { latitude: null }],
    ['longitude-only clearing', { longitude: null }],
    ['mixed null latitude', { latitude: null, longitude: 75 }],
    ['mixed null longitude', { latitude: 15, longitude: null }],
    ['string latitude', { latitude: '15', longitude: 75 }],
    ['string longitude', { latitude: 15, longitude: '75' }],
    ['blank latitude', { latitude: '', longitude: 75 }],
    ['blank longitude', { latitude: 15, longitude: ' ' }],
    ['boolean latitude', { latitude: true, longitude: 75 }],
    ['latitude outside range', { latitude: 91, longitude: 75 }],
    ['longitude outside range', { latitude: 15, longitude: -181 }],
  ])('rejects %s atomically', async (_name, coordinates) => {
    const before = await stored();
    await patch({
      ...coordinates,
      displayName: 'Must not be saved',
      photoUrls: [],
    }).expect(400);
    expect(await stored()).toEqual(before);
  });

  it('clears both coordinates together without clearing independent map or image fields', async () => {
    const result = await patch({ latitude: null, longitude: null }).expect(200);
    expect(result.body).toMatchObject({
      latitude: null,
      longitude: null,
      googleMapsUrl: maps,
      photoUrls: [photo],
    });
    expect(await stored()).toMatchObject({
      latitude: null,
      longitude: null,
      postalCode: '560001',
    });
  });

  it('clears a PIN with null and preserves unrelated location fields', async () => {
    const result = await patch({ postalCode: null }).expect(200);
    expect(result.body.address.postalCode).toBeNull();
    expect(await stored()).toMatchObject({
      postalCode: null,
      latitude: 12.9716,
      longitude: 77.5946,
    });
  });

  it.each(['012345', '5600', '5600011', 'ABCDEF', '', 560001])(
    'rejects invalid PIN %p without changing the profile',
    async (postalCode) => {
      const before = await stored();
      await patch({ postalCode, displayName: 'Must not be saved' }).expect(400);
      expect(await stored()).toEqual(before);
    },
  );

  it('accepts up to eight ordered HTTP(S) photos and clears them with an empty array', async () => {
    const photos = Array.from(
      { length: 8 },
      (_, index) =>
        `${index % 2 ? 'http' : 'https'}://images.example.test/${index}.jpg`,
    );
    const result = await patch({ photoUrls: photos }).expect(200);
    expect(result.body.photoUrls).toEqual(photos);
    expect((await stored()).photoUrls).toEqual(photos);
    expect((await patch({ photoUrls: [] }).expect(200)).body.photoUrls).toEqual(
      [],
    );
    expect((await stored()).photoUrls).toEqual([]);
  });

  it.each([
    ['null', null],
    ['duplicates', [photo, photo]],
    [
      'more than eight',
      Array.from(
        { length: 9 },
        (_, index) => `https://images.example.test/${index}.jpg`,
      ),
    ],
    ['FTP', ['ftp://images.example.test/workshop.jpg']],
    [
      'embedded credentials',
      ['https://user:secret@images.example.test/workshop.jpg'],
    ],
    ['data URL', ['data:image/png;base64,aGVsbG8=']],
    ['JavaScript URL', ['javascript:alert(1)']],
    ['relative URL', ['/workshop.jpg']],
    ['non-array string', photo],
    ['non-string item', [12]],
    ['oversized URL', [`https://images.example.test/${'x'.repeat(1024)}.jpg`]],
  ])(
    'rejects a photo gallery containing %s without other writes',
    async (_name, photoUrls) => {
      const before = await stored();
      await patch({ photoUrls, postalCode: '411001' }).expect(400);
      expect(await stored()).toEqual(before);
    },
  );

  it.each([
    maps,
    'https://google.com/maps/@12.9716,77.5946,15z',
    'https://www.google.co.in/maps/place/Workshop',
    'https://maps.google.com/?q=12.9716,77.5946',
    'https://maps.app.goo.gl/exampleShare',
    'https://goo.gl/maps/exampleShare',
  ])(
    'accepts a safe Google Maps URL %s without replacing coordinates',
    async (googleMapsUrl) => {
      const result = await patch({ googleMapsUrl }).expect(200);
      expect(result.body).toMatchObject({
        googleMapsUrl,
        latitude: 12.9716,
        longitude: 77.5946,
      });
    },
  );

  it.each([
    'http://www.google.com/maps',
    'https://example.test/maps',
    'https://www.google.com/search?q=workshop',
    'https://www.google.com.evil.test/maps',
    'https://user:secret@www.google.com/maps',
    'https://www.google.com:8443/maps',
    'https://maps.app.goo.gl/',
    'javascript:alert(1)',
    '',
    42,
  ])(
    'rejects unsafe or non-map URL %p without other writes',
    async (googleMapsUrl) => {
      const before = await stored();
      await patch({ googleMapsUrl, photoUrls: [] }).expect(400);
      expect(await stored()).toEqual(before);
    },
  );

  it('clears a Maps URL independently', async () => {
    const result = await patch({ googleMapsUrl: null }).expect(200);
    expect(result.body.googleMapsUrl).toBeNull();
    expect(await stored()).toMatchObject({
      googleMapsUrl: null,
      latitude: 12.9716,
      longitude: 77.5946,
      photoUrls: [photo],
    });
  });

  it('preserves discovery fields during an unrelated partial UPI update', async () => {
    const before = await stored();
    const result = await patch({ upiVpa: 'updated@bank' }).expect(200);
    expect(result.body).toMatchObject({
      upiVpa: 'updated@bank',
      latitude: before.latitude,
      longitude: before.longitude,
      photoUrls: before.photoUrls,
      googleMapsUrl: before.googleMapsUrl,
      address: { postalCode: before.postalCode },
    });
    const after = await stored();
    expect(after).toMatchObject({
      latitude: before.latitude,
      longitude: before.longitude,
      photoUrls: before.photoUrls,
      googleMapsUrl: before.googleMapsUrl,
      postalCode: before.postalCode,
    });
  });
});
