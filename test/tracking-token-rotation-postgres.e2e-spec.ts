import { randomBytes, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { ENTITIES } from '../src/database/entities';
import { MIGRATIONS } from '../src/database/migration-list';
import {
  seedTestTenancy,
  TEST_DOMAIN_ID,
  TEST_IAM_USER_ID,
} from './helpers/test-db.helper';
import { Customer } from '../src/modules/customers/entities/customer.entity';
import { Vehicle } from '../src/modules/customers/entities/vehicle.entity';
import { ServiceJob } from '../src/modules/jobs/entities/service-job.entity';
import { JobTrackingService } from '../src/modules/jobs/job-tracking.service';
import { JobStoreService } from '../src/modules/jobs/job-store.service';
import { EventsService } from '../src/modules/events/events.service';
import { AuditLog } from '../src/modules/events/entities/audit-log.entity';
import { ServiceJobEvent } from '../src/modules/events/entities/service-job-event.entity';
import { CommandIdempotency } from '../src/modules/idempotency/command-idempotency.entity';
import { commandMeta } from '../src/modules/idempotency/transactional-receipt';
import { AuthContext } from '../src/modules/auth/interfaces/auth-context.interface';

const suite =
  process.env.AF004_POSTGRES_TEST === 'true' ? describe : describe.skip;
suite('AF-004 isolated PostgreSQL transactions', () => {
  let db: DataSource,
    service: JobTrackingService,
    events: EventsService,
    auth: AuthContext,
    vehicle: Vehicle;
  beforeAll(async () => {
    db = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: 55404,
      username: 'af004_test',
      password: 'af004_test',
      database: 'af004_test',
      entities: ENTITIES,
      migrations: MIGRATIONS,
      synchronize: false,
    });
    await db.initialize();
    const identity = await db.query('SELECT current_database() AS name');
    if (
      identity[0].name !== 'af004_test' ||
      db.options.database !== 'af004_test'
    )
      throw new Error('Refusing to reset non-test database');
    await db.dropDatabase();
    await db.runMigrations();
    const { serviceCenter, staffProfile } = await seedTestTenancy(db);
    auth = {
      actorType: 'staff',
      userId: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      domainApplicationId: 'test',
      roles: ['advisor'],
      permissions: ['jobs:read', 'jobs:update'],
      serviceCenterId: serviceCenter.id,
      staffProfileId: staffProfile.id,
      customerProfileId: null,
    };
    const customer = await db
      .getRepository(Customer)
      .save({ serviceCenterId: serviceCenter.id, phone: '+919876543210' });
    vehicle = await db.getRepository(Vehicle).save({
      serviceCenterId: serviceCenter.id,
      customerId: customer.id,
      registrationNumber: 'TEST1',
    });
    events = new EventsService(
      db.getRepository(ServiceJobEvent),
      db.getRepository(AuditLog),
      {} as never,
    );
    service = new JobTrackingService(db, events);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => db?.destroy());
  const create = () =>
    db.getRepository(ServiceJob).save({
      serviceCenterId: auth.serviceCenterId!,
      customerId: vehicle.customerId,
      vehicleId: vehicle.id,
      serviceType: 'Test',
      publicToken: randomBytes(32).toString('base64url'),
    });
  const send = (job: ServiceJob, key = randomUUID(), version = job.version) =>
    service.rotate(
      auth,
      job.id,
      'LINK_EXPOSED',
      commandMeta(
        {
          method: 'POST',
          originalUrl: `/v1/jobs/${job.id}/public-token/rotate`,
          body: { reason: 'LINK_EXPOSED' },
          headers: { 'if-match': String(version), 'idempotency-key': key },
        },
        { reason: 'LINK_EXPOSED' },
      ),
    );
  const row = (id: string) =>
    db.getRepository(ServiceJob).findOneByOrFail({ id });
  const audits = (id: string) =>
    db
      .getRepository(AuditLog)
      .count({ where: { entityId: id, action: 'PUBLIC_TOKEN_ROTATED' } });
  function gateAudit() {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve)),
      blocked = new Promise<void>((resolve) => (release = resolve));
    const original = events.writeAuditLog.bind(events);
    jest
      .spyOn(events, 'writeAuditLog')
      .mockImplementationOnce(async (...args) => {
        enter();
        await blocked;
        return original(...args);
      });
    return { entered, release };
  }
  it('overlapping same-key commands commit once and return the same receipt', async () => {
    const job = await create(),
      key = randomUUID(),
      gate = gateAudit();
    const first = send(job, key);
    await gate.entered;
    const second = send(job, key);
    gate.release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(await audits(job.id)).toBe(1);
    expect((await row(job.id)).version).toBe(2);
  });
  it('two keys competing for one version produce one success and one conflict', async () => {
    const job = await create(),
      gate = gateAudit();
    const first = send(job);
    await gate.entered;
    const second = send(job);
    const results = Promise.allSettled([first, second]);
    gate.release();
    const outcomes = await results;
    expect(
      outcomes.filter((value) => value.status === 'fulfilled'),
    ).toHaveLength(1);
    const failure = outcomes.find(
      (value) => value.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(failure.reason.getStatus()).toBe(409);
    expect(await audits(job.id)).toBe(1);
  });
  it('audit failure rolls back token/version/receipt and the same key can retry', async () => {
    const job = await create(),
      key = randomUUID();
    jest
      .spyOn(events, 'writeAuditLog')
      .mockRejectedValueOnce(new Error('injected audit failure'));
    await expect(send(job, key)).rejects.toThrow('injected');
    expect((await row(job.id)).publicToken).toBe(job.publicToken);
    expect(
      await db
        .getRepository(CommandIdempotency)
        .count({ where: { idempotencyKey: key } }),
    ).toBe(0);
    await send(job, key);
    expect(await audits(job.id)).toBe(1);
  });
  it('receipt-fill failure rolls back token and audit', async () => {
    const job = await create(),
      key = randomUUID(),
      // The prototype method is deliberately invoked with apply(this) below.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      original = EntityManager.prototype.save;
    jest.spyOn(EntityManager.prototype, 'save').mockImplementation(function (
      this: EntityManager,
      ...args: unknown[]
    ) {
      if (args[0] === CommandIdempotency)
        return Promise.reject(new Error('injected receipt failure'));
      return original.apply(this, args);
    } as typeof original);
    await expect(send(job, key)).rejects.toThrow('injected');
    expect((await row(job.id)).publicToken).toBe(job.publicToken);
    expect(await audits(job.id)).toBe(0);
    expect(
      await db
        .getRepository(CommandIdempotency)
        .count({ where: { idempotencyKey: key } }),
    ).toBe(0);
  });
  it('unique-token collision retries a whole transaction and commits only once', async () => {
    const job = await create(),
      other = await create();
    const fresh = randomBytes(32).toString('base64url');
    const spy = jest
      .spyOn(service, 'generateToken')
      .mockReturnValueOnce(other.publicToken)
      .mockReturnValue(fresh);
    await send(job);
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await row(job.id)).publicToken).toBe(fresh);
    expect(await audits(job.id)).toBe(1);
  });
  it('collision exhaustion rolls back all writes', async () => {
    const job = await create(),
      other = await create(),
      key = randomUUID();
    jest.spyOn(service, 'generateToken').mockReturnValue(other.publicToken);
    await expect(send(job, key)).rejects.toThrow();
    expect((await row(job.id)).publicToken).toBe(job.publicToken);
    expect(await audits(job.id)).toBe(0);
    expect(
      await db
        .getRepository(CommandIdempotency)
        .count({ where: { idempotencyKey: key } }),
    ).toBe(0);
  });
  it('a stale normal job command cannot restore the old token or overwrite fields', async () => {
    const job = await create();
    await send(job);
    const store = new JobStoreService(db.getRepository(ServiceJob));
    await expect(
      store.commit(job, { customerRequest: 'stale' }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await row(job.id)).publicToken).not.toBe(job.publicToken);
  });
  it('old receipt replay preserves a later token; deletion refuses replay', async () => {
    const job = await create(),
      key = randomUUID();
    const receipt = await send(job, key);
    await send(await row(job.id));
    const latest = await row(job.id);
    expect(await send(job, key)).toEqual(receipt);
    expect((await row(job.id)).publicToken).toBe(latest.publicToken);
    await db.getRepository(ServiceJob).softDelete(job.id);
    await expect(send(job, key)).rejects.toMatchObject({ status: 404 });
  });
});
