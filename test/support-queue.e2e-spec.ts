import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import request from 'supertest';
import { IMemoryDb } from 'pg-mem';
import { DataSource } from 'typeorm';
import {
  createJwtTestFixture,
  JwtTestFixture,
} from '../src/test-utils/jwt-test.helper';
import { CustomerProfile } from '../src/modules/customers/entities/customer-profile.entity';
import { Customer } from '../src/modules/customers/entities/customer.entity';
import { Vehicle } from '../src/modules/customers/entities/vehicle.entity';
import { GarageVehicle } from '../src/modules/customers/entities/garage-vehicle.entity';
import { ServiceJob } from '../src/modules/jobs/entities/service-job.entity';
import { Booking } from '../src/modules/bookings/entities/booking.entity';
import { BookingMode } from '../src/common/enums/booking-mode.enum';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { VehicleType } from '../src/common/enums/vehicle-type.enum';
import { CommandIdempotency } from '../src/modules/idempotency/command-idempotency.entity';
import { ServiceCenter } from '../src/modules/tenancy/entities/service-center.entity';
import { SupportAgentProfile } from '../src/modules/support-identity/support-agent-profile.entity';
import { SupportRequest } from '../src/modules/support/support-request.entity';
import { SupportRequestEvent } from '../src/modules/support/support-request-event.entity';
import { CustomerNotification } from '../src/modules/notifications/entities/customer-notification.entity';
import { createE2eApp } from './helpers/e2e-app.helper';
import {
  seedTestTenancy,
  TEST_CUSTOMER_APP_ID,
  TEST_CUSTOMER_DOMAIN_ID,
  TEST_CUSTOMER_IAM_USER_ID,
  TEST_DOMAIN_ID,
  TEST_IAM_USER_ID,
} from './helpers/test-db.helper';

describe('Central support queue (e2e)', () => {
  let app: INestApplication,
    ds: DataSource,
    memoryDb: IMemoryDb,
    signer: JwtTestFixture;
  let customer: string,
    stranger: string,
    agent: string,
    second: string,
    manager: string,
    reader: string,
    forgedStaff: string,
    forgedCustomer: string;
  let agentId: string, secondId: string;
  const domain = 'support-domain',
    application = 'support-app';
  const http = () => request(app.getHttpServer());
  const as = (token: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);
  const create = async (body = {}) =>
    (
      await as(customer, http().post('/v1/me/support-requests'))
        .send({
          category: 'ACCOUNT',
          subject: 'Account help',
          message: 'Please help with my account.',
          ...body,
        })
        .expect(201)
    ).body as { id: string; version: number };
  const command = (
    token: string,
    id: string,
    action: string,
    version: number,
    body = {},
    key = randomUUID(),
  ) =>
    as(token, http().post(`/v1/support/requests/${id}/${action}`))
      .set('If-Match', String(version))
      .set('Idempotency-Key', key)
      .send(body);
  const reply = (
    id: string,
    version: number,
    body: object,
    token = customer,
    key = randomUUID(),
  ) =>
    as(token, http().post(`/v1/me/support-requests/${id}/replies`))
      .set('If-Match', String(version))
      .set('Idempotency-Key', key)
      .send(body);
  beforeAll(async () => {
    process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID = TEST_CUSTOMER_APP_ID;
    process.env.IAM_SUPPORT_DOMAIN_APPLICATION_ID = application;
    process.env.IAM_SUPPORT_DOMAIN_ID = domain;
    signer = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = signer.jwksJson;
    const ctx = await createE2eApp();
    app = ctx.app;
    ds = ctx.dataSource;
    memoryDb = ctx.memoryDb;
    await seedTestTenancy(ds);
    const profiles = await ds
      .getRepository(SupportAgentProfile)
      .save(
        ['agent', 'second', 'manager'].map((name) => ({
          iamDomainId: domain,
          iamUserId: name,
          displayName: name,
          isActive: true,
        })),
      );
    [agentId, secondId] = profiles.map((p) => p.id);
    const token = (
      user: string,
      roles: string[],
      permissions: string[],
      appId = application,
      domainId = domain,
    ) =>
      signer.signAccessToken({
        sub: user,
        domainId,
        domainApplicationId: appId,
        roles,
        permissions,
      });
    agent = await token(
      'agent',
      ['support_agent'],
      ['support:read', 'support:work'],
    );
    second = await token(
      'second',
      ['support_agent'],
      ['support:read', 'support:work'],
    );
    manager = await token(
      'manager',
      ['support_manager'],
      ['support:read', 'support:work', 'support:manage'],
    );
    reader = await token('agent', ['support_agent'], ['support:read']);
    customer = await token(
      TEST_CUSTOMER_IAM_USER_ID,
      ['customer'],
      [],
      TEST_CUSTOMER_APP_ID,
      TEST_CUSTOMER_DOMAIN_ID,
    );
    stranger = await token(
      randomUUID(),
      ['customer'],
      [],
      TEST_CUSTOMER_APP_ID,
      TEST_CUSTOMER_DOMAIN_ID,
    );
    forgedCustomer = await token(
      TEST_CUSTOMER_IAM_USER_ID,
      ['support_manager'],
      ['support:read', 'support:work', 'support:manage'],
      TEST_CUSTOMER_APP_ID,
      TEST_CUSTOMER_DOMAIN_ID,
    );
    forgedStaff = await token(
      TEST_IAM_USER_ID,
      ['support_manager'],
      ['support:read', 'support:work', 'support:manage'],
      'app-123',
      TEST_DOMAIN_ID,
    );
  });
  afterAll(async () => {
    if (app) await app.close();
    if (ds?.isInitialized) await ds.destroy();
    delete process.env.IAM_SUPPORT_DOMAIN_APPLICATION_ID;
    delete process.env.IAM_SUPPORT_DOMAIN_ID;
  });
  it('maps only active provisioned identities and refuses forged customer/center roles', async () => {
    await as(forgedStaff, http().get('/v1/jobs')).expect(403);
    for (const token of [forgedCustomer, forgedStaff])
      await as(token, http().get('/v1/support/requests')).expect(403);
    const me = await as(agent, http().get('/v1/support/me')).expect(200);
    expect(me.body.id).toBe(agentId);
    expect(me.body.serviceCenterId).toBeUndefined();
    for (const claims of [
      { sub: 'unknown', domainId: domain },
      { sub: 'agent', domainId: 'wrong' },
    ]) {
      const token = await signer.signAccessToken({
        ...claims,
        domainApplicationId: application,
        roles: ['support_agent'],
        permissions: ['support:read'],
      });
      await as(token, http().get('/v1/support/me')).expect(403);
    }
    await ds
      .getRepository(SupportAgentProfile)
      .update(secondId, { isActive: false });
    await as(second, http().get('/v1/support/me')).expect(403);
    await ds
      .getRepository(SupportAgentProfile)
      .update(secondId, { isActive: true });
    app.get(ConfigService).set('IAM_SUPPORT_DOMAIN_APPLICATION_ID', '');
    await as(agent, http().get('/v1/support/me')).expect(403);
    app.get(ConfigService).set('IAM_SUPPORT_DOMAIN_APPLICATION_ID', application);
    app.get(ConfigService).set('IAM_SUPPORT_DOMAIN_ID', '');
    await as(agent, http().get('/v1/support/me')).expect(403);
    app.get(ConfigService).set('IAM_SUPPORT_DOMAIN_ID', domain);
  });
  it('refuses support actors on customer and center APIs even with forged privileges', async () => {
    const token = await signer.signAccessToken({
      sub: 'agent',
      domainId: domain,
      domainApplicationId: application,
      roles: ['support_agent', 'admin', 'manager'],
      permissions: [
        'support:read',
        'jobs:read',
        'staff:read',
        'center:manage',
        'bookings:read',
      ],
    });
    for (const path of [
      '/v1/me/profile',
      '/v1/me/support-requests',
      '/v1/jobs',
      '/v1/staff',
      '/v1/bookings',
    ])
      await as(token, http().get(path)).expect(403);
  });
  it('trims before validating, refuses unknown fields, and creates public history and a safe receipt', async () => {
    await create({
      subject: '  Trimmed help  ',
      message: '   Please help with my account.   ',
    });
    await as(customer, http().post('/v1/me/support-requests'))
      .send({ category: 'APP', subject: '   ', message: '            ' })
      .expect(400);
    const res = await as(customer, http().post('/v1/me/support-requests'))
      .send({
        category: 'APP',
        subject: 'App help',
        message: 'A valid message here',
        priority: 'HIGH',
      })
      .expect(400);
    expect(res.body.message).toContain('property priority should not exist');
    const key = randomUUID(),
      body = {
        category: 'APP',
        subject: 'App help',
        message: 'A valid message here',
      };
    const first = await as(customer, http().post('/v1/me/support-requests'))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    const replay = await as(customer, http().post('/v1/me/support-requests'))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(replay.body).toEqual(first.body);
    expect(
      await ds
        .getRepository(SupportRequestEvent)
        .countBy({ supportRequestId: first.body.id }),
    ).toBe(1);
    expect(first.body.assignedAgentProfileId).toBeUndefined();
    expect(first.body.priority).toBeUndefined();
  });
  it('rejects incompatible or foreign links without expanding them', async () => {
    const res = await as(customer, http().post('/v1/me/support-requests'))
      .send({
        category: 'BOOKING',
        subject: 'Booking help',
        message: 'A valid message here',
        bookingId: randomUUID(),
        jobId: randomUUID(),
      })
      .expect(422);
    expect(res.body.code).toBe('SUPPORT_LINK_INVALID');
  });
  it('continues to replay pre-AF-010 creation receipts with the original hash', async () => {
    const row = await create(),
      key = randomUUID(),
      body = {
        category: 'ACCOUNT',
        subject: 'Account help',
        message: 'Please help with my account.',
      };
    const original = {
      id: row.id,
      referenceNumber: 'SR-OLD-RECEIPT',
      status: 'OPEN',
    };
    await ds.getRepository(CommandIdempotency).save({
      scope: `customer:${TEST_CUSTOMER_IAM_USER_ID}`,
      idempotencyKey: key,
      requestHash: createHash('sha256')
        .update(`POST /v1/me/support-requests ${JSON.stringify(body)}`)
        .digest('hex'),
      responseStatus: 201,
      responseBody: original,
    });
    const replay = await as(customer, http().post('/v1/me/support-requests'))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(replay.body).toEqual(original);
  });
  it('allows help for minor accounts without bookings or active services', async () => {
    const user = randomUUID(),
      profile = await ds
        .getRepository(CustomerProfile)
        .save({ iamUserId: user, dateOfBirth: '2012-01-01' });
    const token = await signer.signAccessToken({
      sub: user,
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      roles: ['customer'],
      permissions: [],
    });
    const result = await as(token, http().post('/v1/me/support-requests'))
      .send({
        category: 'ACCOUNT',
        subject: 'Account help',
        message: 'Please help with this account.',
      })
      .expect(201);
    await reply(result.body.id, 1, { message: 'More details' }, token).expect(
      200,
    );
    expect(
      (
        await ds
          .getRepository(SupportRequest)
          .findOneByOrFail({ id: result.body.id })
      ).customerProfileId,
    ).toBe(profile.id);
  });
  it('validates versions and rejects private visibility fields on public commands', async () => {
    const row = await create();
    for (const version of ['0', '-1', '01', '1.5', '"1', '9007199254740992'])
      await as(agent, http().post(`/v1/support/requests/${row.id}/claim`))
        .set('If-Match', version)
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(400);
    await as(agent, http().post(`/v1/support/requests/${row.id}/claim`))
      .set('If-Match', '"1"')
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(200);
    await command(agent, row.id, 'replies', 2, {
      message: '   ',
      awaitCustomerReply: false,
    }).expect(400);
    await command(agent, row.id, 'notes', 2, {
      message: 'Private',
      visibility: 'PUBLIC',
    }).expect(400);
    await command(agent, row.id, 'replies', 2, {
      message: 'Public',
      awaitCustomerReply: false,
      visibility: 'INTERNAL',
    }).expect(400);
    const roleOnly = await signer.signAccessToken({
      sub: 'second',
      domainId: domain,
      domainApplicationId: application,
      roles: ['support_manager'],
      permissions: ['support:read', 'support:work'],
    });
    await command(roleOnly, row.id, 'notes', 2, {
      message: 'Unauthorized override',
    }).expect(403);
    await command(roleOnly, row.id, 'assign', 2, {
      assignedAgentProfileId: secondId,
      reason: 'Take over',
    }).expect(403);
  });
  it('requires a real booking-job relationship and returns safe context from multiple centers', async () => {
    const profile = await ds
      .getRepository(CustomerProfile)
      .findOneByOrFail({ iamUserId: TEST_CUSTOMER_IAM_USER_ID });
    const centers = await ds.getRepository(ServiceCenter).find();
    const jobs: ServiceJob[] = [];
    for (const center of centers) {
      const local = await ds
        .getRepository(Customer)
        .save({
          serviceCenterId: center.id,
          customerProfileId: profile.id,
          phone: '+919999999999',
        });
      const vehicle = await ds
        .getRepository(Vehicle)
        .save({
          serviceCenterId: center.id,
          customerId: local.id,
          registrationNumber: 'KA01AB1111',
          makeModel: 'Honda Activa',
        });
      jobs.push(
        await ds
          .getRepository(ServiceJob)
          .save({
            serviceCenterId: center.id,
            customerId: local.id,
            vehicleId: vehicle.id,
            serviceType: 'Checkup',
            publicToken: randomUUID(),
            jobNumber: `JC-${randomUUID().slice(0, 8)}`,
          }),
      );
    }
    const garage = await ds
      .getRepository(GarageVehicle)
      .save({
        customerProfileId: profile.id,
        vehicleType: VehicleType.TWO_WHEELER,
        registrationNumber: 'KA01AB1111',
        make: 'Honda',
        model: 'Activa',
      });
    const booking = await ds
      .getRepository(Booking)
      .save({
        serviceCenterId: centers[0].id,
        customerProfileId: profile.id,
        vehicleId: garage.id,
        mode: BookingMode.SELF_CHECKIN,
        status: BookingStatus.CHECKED_IN,
        slotStart: new Date(),
        slotEnd: new Date(Date.now() + 3600000),
        serviceJobId: jobs[0].id,
        bookingNumber: 'AF-SUPPORT-TEST',
      });
    const body = {
      category: 'SERVICE',
      subject: 'Visit help',
      message: 'Please help with this service.',
    };
    await as(customer, http().post('/v1/me/support-requests'))
      .send({ ...body, bookingId: booking.id, jobId: jobs[1].id })
      .expect(422);
    const valid = await create({
      ...body,
      bookingId: booking.id,
      jobId: jobs[0].id,
    });
    const other = await create({ ...body, jobId: jobs[1].id });
    for (const row of [valid, other]) {
      const detail = await as(
        agent,
        http().get(`/v1/support/requests/${row.id}`),
      ).expect(200);
      expect(detail.body.linkedContext.state).toBe('AVAILABLE');
      expect(detail.body.linkedContext.job.registration).toBe('KA01AB1111');
      expect(detail.body.linkedContext.job.publicToken).toBeUndefined();
    }
    await ds
      .getRepository(SupportRequest)
      .update(valid.id, { jobId: jobs[1].id });
    const legacy = await as(
      agent,
      http().get(`/v1/support/requests/${valid.id}`),
    ).expect(200);
    expect(legacy.body.linkedContext).toEqual({
      state: 'NEEDS_REVIEW',
      booking: null,
      job: null,
    });
  });
  it('requires work permissions, versions, keys, ownership and valid lifecycle', async () => {
    const row = await create();
    await command(reader, row.id, 'claim', 1).expect(403);
    await as(agent, http().post(`/v1/support/requests/${row.id}/claim`))
      .send({})
      .expect(400);
    await command(agent, row.id, 'notes', 1, { message: 'Private' }).expect(
      409,
    );
    await command(agent, row.id, 'claim', 1).expect(200);
    await command(second, row.id, 'notes', 2, { message: 'Private' }).expect(
      403,
    );
    await command(agent, row.id, 'assign', 2, {
      assignedAgentProfileId: secondId,
    }).expect(403);
    await command(manager, row.id, 'assign', 2, {
      assignedAgentProfileId: secondId,
    }).expect(422);
    await command(manager, row.id, 'assign', 2, {
      assignedAgentProfileId: secondId,
      reason: 'Cover shift',
    }).expect(200);
    await command(second, row.id, 'release', 3, {
      reason: 'End of shift',
    }).expect(200);
    const detail = await as(
      agent,
      http().get(`/v1/support/requests/${row.id}`),
    ).expect(200);
    expect(detail.body.status).toBe('OPEN');
    expect(detail.body.assignee).toBeNull();
    await reply(row.id, 4, { message: 'Mine' }, stranger).expect(404);
    await as(
      stranger,
      http().get(`/v1/me/support-requests/${row.id}/events`),
    ).expect(404);
  });
  it('keeps notes and private field changes out of all customer responses and notifications', async () => {
    const row = await create();
    await command(agent, row.id, 'claim', 1).expect(200);
    const before = await ds.getRepository(CustomerNotification).count();
    await command(agent, row.id, 'notes', 2, {
      message: 'SECRET_INTERNAL_NOTE',
    }).expect(200);
    await command(agent, row.id, 'priority', 3, {
      priority: 'HIGH',
      reason: 'SECRET_PRIORITY_REASON',
    }).expect(200);
    expect(await ds.getRepository(CustomerNotification).count()).toBe(before);
    await command(agent, row.id, 'replies', 4, {
      message: 'PUBLIC_REPLY_TEXT',
      awaitCustomerReply: true,
    }).expect(200);
    expect(await ds.getRepository(CustomerNotification).count()).toBe(
      before + 1,
    );
    for (const path of [
      '/v1/me/support-requests',
      `/v1/me/support-requests/${row.id}`,
      `/v1/me/support-requests/${row.id}/events`,
      '/v1/me/notifications',
    ]) {
      const res = await as(customer, http().get(path)).expect(200);
      const text = JSON.stringify(res.body);
      for (const value of [
        'SECRET_INTERNAL_NOTE',
        'SECRET_PRIORITY_REASON',
        agentId,
        'assignedAgentProfileId',
        'lastPublicReplyVersion',
      ])
        expect(text).not.toContain(value);
    }
    const publicEvents = await as(
      customer,
      http().get(`/v1/me/support-requests/${row.id}/events?limit=1`),
    ).expect(200);
    expect(publicEvents.body.items[0].body).toBe('PUBLIC_REPLY_TEXT');
    expect(publicEvents.body.nextBeforeVersion).toBe(5);
    const inbox = await ds.getRepository(CustomerNotification).find();
    expect(JSON.stringify(inbox)).not.toContain('PUBLIC_REPLY_TEXT');
    const staffEvents = await as(
      agent,
      http().get(`/v1/support/requests/${row.id}/events`),
    ).expect(200);
    expect(staffEvents.body.items).toHaveLength(5);
  });
  it('replays successful commands and rejects changed keys or stale versions without writing', async () => {
    const row = await create(),
      key = randomUUID();
    const first = await command(agent, row.id, 'claim', 1, {}, key).expect(200);
    await command(agent, row.id, 'notes', 2, { message: 'Some note' }).expect(
      200,
    );
    const replay = await command(agent, row.id, 'claim', 1, {}, key).expect(
      200,
    );
    expect(replay.body).toEqual(first.body);
    await command(agent, row.id, 'claim', 2, {}, key).expect(422);
    // pg-mem does not implement transaction rollback; the PostgreSQL suite verifies it.
    const backup = memoryDb.backup();
    const failedKey = randomUUID();
    const failed = await command(
      agent,
      row.id,
      'replies',
      2,
      { message: 'Hello', awaitCustomerReply: false },
      failedKey,
    ).expect(409);
    expect(failed.body.currentVersion).toBe(3);
    backup.restore();
    await command(
      agent,
      row.id,
      'replies',
      3,
      { message: 'Hello', awaitCustomerReply: false },
      failedKey,
    ).expect(200);
  });
  it('clears customer waiting on reply, reopens resolved work, and prevents replies after closure', async () => {
    const row = await create();
    await command(agent, row.id, 'claim', 1).expect(200);
    await command(agent, row.id, 'replies', 2, {
      message: 'Could you share more?',
      awaitCustomerReply: true,
    }).expect(200);
    await reply(row.id, 3, { message: 'Here is more' }).expect(200);
    let detail = (
      await as(agent, http().get(`/v1/support/requests/${row.id}`)).expect(200)
    ).body;
    expect(detail.waitingOn).toBeNull();
    expect(detail.needsReply).toBe(true);
    await command(agent, row.id, 'resolve', 4, {
      resolutionCode: 'INFORMATION_PROVIDED',
      message: 'The information is now provided.',
    }).expect(200);
    await reply(row.id, 5, { message: 'Still need help' }).expect(200);
    detail = (
      await as(agent, http().get(`/v1/support/requests/${row.id}`)).expect(200)
    ).body;
    expect(detail.status).toBe('IN_PROGRESS');
    expect(detail.assignee.id).toBe(agentId);
    expect(detail.resolutionSummary).toBeNull();
    await command(agent, row.id, 'resolve', 6, {
      resolutionCode: 'ACTION_COMPLETED',
      message: 'The account issue has been corrected.',
    }).expect(200);
    await command(agent, row.id, 'close', 7, {
      message: 'This request is now closed.',
    }).expect(403);
    await command(manager, row.id, 'close', 7, {
      message: 'This request is now closed.',
    }).expect(200);
    const closed = await reply(row.id, 8, { message: 'More help' }).expect(409);
    expect(closed.body.code).toBe('SUPPORT_REQUEST_CLOSED');
    await command(manager, row.id, 'reopen', 8, {
      message: 'We are reviewing this again.',
    }).expect(200);
  });
  it('retains center waiting and returns resolved work to OPEN when its owner is inactive', async () => {
    const row = await create();
    await command(agent, row.id, 'claim', 1).expect(200);
    await command(agent, row.id, 'wait', 2, {
      waitingOn: 'CENTER',
      reason: 'Checking with the center',
    }).expect(200);
    await reply(row.id, 3, { message: 'More context' }).expect(200);
    expect(
      (await ds.getRepository(SupportRequest).findOneByOrFail({ id: row.id }))
        .waitingOn,
    ).toBe('CENTER');
    await command(agent, row.id, 'resolve', 4, {
      resolutionCode: 'NO_ACTION_REQUIRED',
      message: 'We have finished reviewing this.',
    }).expect(200);
    await ds
      .getRepository(SupportAgentProfile)
      .update(agentId, { isActive: false });
    await reply(row.id, 5, { message: 'Please review again' }).expect(200);
    await ds
      .getRepository(SupportAgentProfile)
      .update(agentId, { isActive: true });
    expect(
      (await ds.getRepository(SupportRequest).findOneByOrFail({ id: row.id }))
        .status,
    ).toBe('OPEN');
  });
  it('supports filtered counts, queue pagination, roster and bounded request context', async () => {
    const queue = await as(
      agent,
      http().get('/v1/support/requests?limit=2'),
    ).expect(200);
    expect(queue.body.items).toHaveLength(2);
    expect(queue.body.nextCursor).toBeTruthy();
    const next = await as(
      agent,
      http().get(
        `/v1/support/requests?limit=2&cursor=${queue.body.nextCursor}`,
      ),
    ).expect(200);
    expect(
      next.body.items.every(
        (item: { id: string }) =>
          !queue.body.items.some((old: { id: string }) => old.id === item.id),
      ),
    ).toBe(true);
    await as(
      agent,
      http().get(
        `/v1/support/requests?limit=2&priority=HIGH&cursor=${queue.body.nextCursor}`,
      ),
    ).expect(400);
    const counts = await as(
      agent,
      http().get('/v1/support/requests/summary?status=CLOSED'),
    ).expect(200);
    expect(counts.body.active).toBeGreaterThan(0);
    const row = await create({ subject: 'Distinctive search token' });
    const search = await as(
      agent,
      http().get('/v1/support/requests?q=Distinctive'),
    ).expect(200);
    expect(search.body.items.map((i: { id: string }) => i.id)).toEqual([
      row.id,
    ]);
    const detail = await as(
      agent,
      http().get(`/v1/support/requests/${row.id}`),
    ).expect(200);
    expect(detail.body.linkedContext.state).toBe('NONE');
    expect(JSON.stringify(detail.body)).not.toContain('dateOfBirth');
    expect(JSON.stringify(detail.body)).not.toContain('iamUserId');
    await as(
      agent,
      http().get('/v1/support/agents?includeInactive=true'),
    ).expect(403);
    const roster = await as(
      manager,
      http().get('/v1/support/agents?includeInactive=true'),
    ).expect(200);
    expect(roster.body).toHaveLength(3);
  });
});
