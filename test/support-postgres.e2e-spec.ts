import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ENTITIES } from '../src/database/entities';
import { MIGRATIONS } from '../src/database/migration-list';
import {
  SupportStatus,
  SupportCategory,
} from '../src/common/enums/ownership.enum';
import { AuthContext } from '../src/modules/auth/interfaces/auth-context.interface';
import { CustomerProfile } from '../src/modules/customers/entities/customer-profile.entity';
import { SupportAgentProfile } from '../src/modules/support-identity/support-agent-profile.entity';
import { SupportRequest } from '../src/modules/support/support-request.entity';
import { SupportRequestEvent } from '../src/modules/support/support-request-event.entity';
import * as reference from '../src/common/reference-number';
import { MeService } from '../src/modules/customers/me.service';
import { SupportService } from '../src/modules/support/support.service';
import { SupportContextService } from '../src/modules/support/support-context.service';
import { SupportOperatorService } from '../src/modules/support/support-operator.service';
import { bootstrapWorkshop } from '../src/dev/workshop-bootstrap';
import {
  SUPPORT_PERSONAS,
  DEV_SUPPORT_DOMAIN_ID,
} from '../src/dev/dev-personas';
import { SupportWorkflowService } from '../src/modules/support/support-workflow.service';
import { SupportCommandBody } from '../src/modules/support/dto/support-workflow.dto';
import { commandMeta } from '../src/modules/support/support-command';
import { CommandIdempotency } from '../src/modules/idempotency/command-idempotency.entity';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { CustomerNotification } from '../src/modules/notifications/entities/customer-notification.entity';
import { NotificationDelivery } from '../src/modules/notifications/entities/notification-delivery.entity';

// Explicit opt-in; this suite never connects to the workshop/default database.
const pgSuite =
  process.env.AF010_POSTGRES_TEST === 'true' ? describe : describe.skip;
pgSuite('Support transactions on isolated PostgreSQL 16', () => {
  let ds: DataSource,
    workflow: SupportWorkflowService,
    notifications: NotificationsService,
    customer: CustomerProfile;
  let first: AuthContext, second: AuthContext;
  const legacyIds: string[] = [];
  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: 55410,
      username: 'af010_test',
      password: 'af010_test',
      database: 'af010_test',
      entities: ENTITIES,
      synchronize: false,
    });
    await ds.initialize();
    // This fixed disposable database belongs exclusively to this opt-in suite.
    await ds.dropDatabase();
    const runner = ds.createQueryRunner();
    await runner.connect();
    for (const Migration of MIGRATIONS.slice(0, -1))
      await new Migration().up(runner);
    customer = await ds
      .getRepository(CustomerProfile)
      .save({
        iamUserId: randomUUID(),
        displayName: 'Customer',
        phone: '+919876543210',
      });
    for (const status of ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) {
      const id = randomUUID();
      legacyIds.push(id);
      await ds.query(
        'INSERT INTO support_requests (id,customer_profile_id,reference_number,category,subject,message,status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          id,
          customer.id,
          `SR-LEGACY-${id.slice(0, 6)}`,
          'ACCOUNT',
          'Legacy help',
          'Preserve this original message.',
          status,
        ],
      );
    }
    await new MIGRATIONS[MIGRATIONS.length - 1]().up(runner);
    await runner.release();
    const profiles = await ds
      .getRepository(SupportAgentProfile)
      .save(
        ['agent', 'second'].map((name) => ({
          iamUserId: name,
          iamDomainId: 'support-domain',
          displayName: name,
        })),
      );
    const auth = (profile: SupportAgentProfile): AuthContext => ({
      actorType: 'support',
      userId: profile.iamUserId,
      domainId: profile.iamDomainId,
      domainApplicationId: 'support-app',
      roles: ['support_agent'],
      permissions: ['support:read', 'support:work'],
      supportAgentProfileId: profile.id,
      serviceCenterId: null,
      staffProfileId: null,
      customerProfileId: null,
    });
    [first, second] = profiles.map(auth);
    notifications = new NotificationsService(
      ds.getRepository(CustomerNotification),
      ds.getRepository(NotificationDelivery),
    );
    workflow = new SupportWorkflowService(ds, notifications);
  });
  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });
  const create = () =>
    ds
      .getRepository(SupportRequest)
      .save({
        customerProfileId: customer.id,
        referenceNumber: `SR-${randomUUID().slice(0, 8)}`,
        category: SupportCategory.ACCOUNT,
        subject: 'Account issue',
        message: 'Please help with my account.',
      });
  const send = (
    auth: AuthContext,
    row: SupportRequest,
    action: 'claim' | 'notes' | 'replies',
    body: SupportCommandBody = {},
    key = randomUUID(),
    version = row.version,
    service = workflow,
  ) =>
    service.command(
      auth,
      row.id,
      action,
      body,
      commandMeta(
        {
          method: 'POST',
          originalUrl: `/v1/support/requests/${row.id}/${action}`,
          body,
          headers: { 'idempotency-key': key, 'if-match': String(version) },
        },
        body,
      ),
    );
  const counts = async (id: string) => ({
    events: await ds
      .getRepository(SupportRequestEvent)
      .countBy({ supportRequestId: id }),
    receipts: await ds.getRepository(CommandIdempotency).count(),
    inbox: await ds.getRepository(CustomerNotification).count(),
    deliveries: await ds.getRepository(NotificationDelivery).count(),
  });
  it('preserves legacy rows and terminal uncertainty without inventing messages or notifications', async () => {
    const rows = await ds
      .getRepository(SupportRequest)
      .findBy({ customerProfileId: customer.id });
    expect(rows.map((r) => r.status).sort()).toEqual(
      [
        SupportStatus.OPEN,
        SupportStatus.RESOLVED,
        SupportStatus.CLOSED,
        SupportStatus.OPEN,
      ].sort(),
    );
    for (const id of legacyIds) {
      const row = await ds
        .getRepository(SupportRequest)
        .findOneByOrFail({ id });
      expect(row.message).toBe('Preserve this original message.');
      expect(row.assignedAgentProfileId).toBeNull();
      const event = await ds
        .getRepository(SupportRequestEvent)
        .findOneByOrFail({ supportRequestId: id });
      expect(event.type).toBe('IMPORTED');
      expect(event.visibility).toBe('INTERNAL');
      expect(event.actorType).toBe('SYSTEM');
      expect(event.changes?.legacyResolutionUnknown).toBe(
        ['RESOLVED', 'CLOSED'].includes(row.status),
      );
    }
    expect(await ds.getRepository(CustomerNotification).count()).toBe(0);
  });
  it('allows exactly one competing claim with one event and one receipt', async () => {
    const row = await create(),
      before = await counts(row.id);
    const result = await Promise.allSettled([
      send(first, row, 'claim'),
      send(second, row, 'claim'),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const saved = await ds
      .getRepository(SupportRequest)
      .findOneByOrFail({ id: row.id });
    expect(saved.version).toBe(2);
    expect([
      first.supportAgentProfileId,
      second.supportAgentProfileId,
    ]).toContain(saved.assignedAgentProfileId);
    expect(await counts(row.id)).toEqual({
      ...before,
      events: 1,
      receipts: before.receipts + 1,
    });
  });
  it('concurrent identical retries return one receipt and never duplicate history', async () => {
    const row = await create(),
      key = randomUUID(),
      before = await counts(row.id);
    const [a, b] = await Promise.all([
      send(first, row, 'claim', {}, key),
      send(first, row, 'claim', {}, key),
    ]);
    expect(a).toEqual(b);
    expect(await counts(row.id)).toEqual({
      ...before,
      events: 1,
      receipts: before.receipts + 1,
    });
  });
  it('rejects concurrent changed payloads under one key', async () => {
    const row = await create();
    await send(first, row, 'claim');
    const key = randomUUID();
    const result = await Promise.allSettled([
      send(first, row, 'notes', { message: 'First note' }, key, 2),
      send(first, row, 'notes', { message: 'Different note' }, key, 2),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = result.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(failure.reason.getStatus()).toBe(422);
    expect(
      await ds
        .getRepository(SupportRequestEvent)
        .countBy({ supportRequestId: row.id }),
    ).toBe(2);
  });
  it('enforces optimistic concurrency on two different keys at the same version', async () => {
    const row = await create();
    await send(first, row, 'claim');
    const before = await counts(row.id);
    const result = await Promise.allSettled([
      send(first, row, 'notes', { message: 'First note' }, randomUUID(), 2),
      send(first, row, 'notes', { message: 'Second note' }, randomUUID(), 2),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (
        result.find((r) => r.status === 'rejected') as PromiseRejectedResult
      ).reason.getStatus(),
    ).toBe(409);
    expect(await counts(row.id)).toEqual({
      ...before,
      events: 2,
      receipts: before.receipts + 1,
    });
  });
  it('rolls back state, history, inbox, delivery and receipt after notification failure; same key can retry', async () => {
    const row = await create();
    await send(first, row, 'claim');
    const before = await counts(row.id),
      key = randomUUID();
    const original = notifications.notifyProfile.bind(notifications);
    const spy = jest
      .spyOn(notifications, 'notifyProfile')
      .mockImplementation(async (...args) => {
        await original(...args);
        throw new Error('Injected notification failure');
      });
    await expect(
      send(
        first,
        row,
        'replies',
        { message: 'Your account is corrected.', awaitCustomerReply: false },
        key,
        2,
      ),
    ).rejects.toThrow('Injected notification failure');
    spy.mockRestore();
    expect(await counts(row.id)).toEqual(before);
    expect(
      (await ds.getRepository(SupportRequest).findOneByOrFail({ id: row.id }))
        .version,
    ).toBe(2);
    expect(
      await ds
        .getRepository(CommandIdempotency)
        .findOneBy({ idempotencyKey: key }),
    ).toBeNull();
    await send(
      first,
      row,
      'replies',
      { message: 'Your account is corrected.', awaitCustomerReply: false },
      key,
      2,
    );
    const after = await counts(row.id);
    expect(after.events).toBe(2);
    expect(after.inbox).toBe(before.inbox + 1);
    expect(after.deliveries).toBeGreaterThan(before.deliveries);
  });
  it('does not reserve a key for a stale failure and retains successful replay after later changes', async () => {
    const row = await create(),
      key = randomUUID();
    const ack = await send(first, row, 'claim', {}, key);
    await send(first, row, 'notes', { message: 'Later note' }, randomUUID(), 2);
    expect(await send(first, row, 'claim', {}, key)).toEqual(ack);
    const failedKey = randomUUID();
    await expect(
      send(first, row, 'notes', { message: 'Retry note' }, failedKey, 2),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await ds
        .getRepository(CommandIdempotency)
        .findOneBy({ idempotencyKey: failedKey }),
    ).toBeNull();
    await send(first, row, 'notes', { message: 'Retry note' }, failedKey, 3);
  });
  it('enforces assignment checks and account deletion preserves the parent cascade', async () => {
    const row = await create();
    await expect(
      ds
        .getRepository(SupportRequest)
        .update(row.id, { status: SupportStatus.IN_PROGRESS }),
    ).rejects.toMatchObject({ code: '23514' });
    const profile = await ds
      .getRepository(CustomerProfile)
      .save({ iamUserId: randomUUID() });
    const child = await ds
      .getRepository(SupportRequest)
      .save({
        customerProfileId: profile.id,
        referenceNumber: 'SR-DELETE-TEST',
        category: SupportCategory.ACCOUNT,
        subject: 'Delete account',
        message: 'Please delete this account.',
      });
    await ds
      .getRepository(SupportRequestEvent)
      .save({
        supportRequestId: child.id,
        requestVersion: 1,
        type: 'CREATED',
        visibility: 'PUBLIC',
        actorType: 'CUSTOMER',
        actorCustomerProfileId: profile.id,
      });
    await ds.getRepository(CustomerProfile).delete(profile.id);
    expect(
      await ds
        .getRepository(SupportRequestEvent)
        .countBy({ supportRequestId: child.id }),
    ).toBe(0);
  });
  it('preserves microsecond page boundaries and equal timestamp ties on both sorts', async () => {
    const rows = await Promise.all([create(), create(), create()]);
    for (const row of rows)
      await ds.query(
        "UPDATE support_requests SET subject='Microsecond pagination test',created_at='2026-10-09T12:00:00.000123Z',last_activity_at='2026-10-09T12:00:00.000123Z' WHERE id=$1",
        [row.id],
      );
    const reads = new SupportOperatorService(ds, new SupportContextService(ds));
    for (const sort of ['oldest', 'recentActivity']) {
      let cursor: string | undefined;
      const seen: string[] = [];
      do {
        const page = await reads.list(first, {
          q: 'Microsecond pagination test',
          limit: 1,
          sort,
          cursor,
        });
        seen.push(...page.items.map((row) => row.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor && seen.length < 5);
      expect(seen).toHaveLength(3);
      expect(new Set(seen).size).toBe(3);
      expect(new Set(seen)).toEqual(new Set(rows.map((row) => row.id)));
    }
  });
  it('retries only a reference collision outside the aborted creation transaction', async () => {
    const existing = await create();
    const profileRepo = ds.getRepository(CustomerProfile);
    const service = new SupportService(
      ds,
      ds.getRepository(SupportRequest),
      new MeService(profileRepo),
      notifications,
      new SupportContextService(ds),
    );
    const auth: AuthContext = {
      ...first,
      actorType: 'customer',
      userId: customer.iamUserId,
      customerProfileId: customer.id,
      supportAgentProfileId: null,
    };
    const dto = {
      category: SupportCategory.ACCOUNT,
      subject: 'Reference collision',
      message: 'Please help with this account.',
    };
    const spy = jest
      .spyOn(reference, 'generateReference')
      .mockReturnValueOnce(existing.referenceNumber)
      .mockReturnValue('SR-COLLISION-RETRY');
    const key = randomUUID();
    try {
      const created = await service.create(
        auth,
        dto,
        commandMeta(
          {
            method: 'POST',
            originalUrl: '/v1/me/support-requests',
            body: dto,
            headers: { 'idempotency-key': key },
          },
          dto,
          201,
          true,
        ),
      );
      expect(created.referenceNumber).toBe('SR-COLLISION-RETRY');
      expect(
        await ds
          .getRepository(SupportRequestEvent)
          .countBy({ supportRequestId: created.id }),
      ).toBe(1);
      expect(
        await ds
          .getRepository(CommandIdempotency)
          .countBy({ idempotencyKey: key }),
      ).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
  it('bootstrap reruns preserve disabled operators and existing request assignments/history', async () => {
    await bootstrapWorkshop(ds);
    const profile = await ds
      .getRepository(SupportAgentProfile)
      .findOneByOrFail({
        iamDomainId: DEV_SUPPORT_DOMAIN_ID,
        iamUserId: SUPPORT_PERSONAS[0].iamUserId,
      });
    await ds
      .getRepository(SupportAgentProfile)
      .update(profile.id, { isActive: false });
    const beforeRequests = await ds
        .getRepository(SupportRequest)
        .find({ order: { id: 'ASC' } }),
      beforeEvents = await ds.getRepository(SupportRequestEvent).count(),
      beforeAgents = await ds.getRepository(SupportAgentProfile).count();
    await bootstrapWorkshop(ds);
    expect(
      (
        await ds
          .getRepository(SupportAgentProfile)
          .findOneByOrFail({ id: profile.id })
      ).isActive,
    ).toBe(false);
    expect(await ds.getRepository(SupportAgentProfile).count()).toBe(
      beforeAgents,
    );
    expect(
      await ds.getRepository(SupportRequest).find({ order: { id: 'ASC' } }),
    ).toEqual(beforeRequests);
    expect(await ds.getRepository(SupportRequestEvent).count()).toBe(
      beforeEvents,
    );
  });
  it('also applies every migration to a fresh database and can undo/reapply the empty support schema', async () => {
    await ds.dropDatabase();
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      for (const Migration of MIGRATIONS) await new Migration().up(runner);
      expect(await ds.getRepository(SupportRequestEvent).count()).toBe(0);
      expect(await ds.getRepository(SupportAgentProfile).count()).toBe(0);
      const migration = new MIGRATIONS[MIGRATIONS.length - 1]();
      await migration.down(runner);
      await migration.up(runner);
      expect(await ds.getRepository(SupportRequestEvent).count()).toBe(0);
    } finally {
      await runner.release();
    }
  });
});
