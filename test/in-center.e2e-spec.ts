import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AuditLog } from '../src/modules/events/entities/audit-log.entity';
import { JobAssignment } from '../src/modules/jobs/entities/job-assignment.entity';
import { StaffProfile } from '../src/modules/tenancy/entities/staff-profile.entity';
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

const TECH_IAM_USER_ID = '77777777-7777-4777-8777-777777777777';
const OTHER_CUSTOMER_IAM_USER_ID = '88888888-8888-4888-8888-888888888888';

/** Tuesday 2027-06-15, 09:00–10:00 IST. */
const SLOT = {
  slotStart: '2027-06-15T03:30:00.000Z',
  slotEnd: '2027-06-15T04:30:00.000Z',
};

const STAFF_PERMISSIONS = [
  'jobs:create',
  'jobs:read',
  'jobs:update',
  'bookings:read',
  'bookings:manage',
  'center:manage',
];

describe('In-center service (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let customer: string;
  let otherCustomer: string;
  let manager: string;
  let advisor: string;
  let technician: string;
  let technicianId: string;
  let jobId: string;
  let publicToken: string;
  let version: number;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);
  const asManager = (req: request.Test) => as(manager)(req);
  const asTech = (req: request.Test) => as(technician)(req);
  const asCustomer = (req: request.Test) => as(customer)(req);

  /** Runs a job command with the current version and keeps the new one. */
  const command = async (
    req: request.Test,
    body: Record<string, unknown> | undefined,
    expected: number,
  ) => {
    const res = await req
      .set('If-Match', String(version))
      .send(body)
      .expect(expected);
    if (typeof res.body?.version === 'number') version = res.body.version;
    return res;
  };

  beforeAll(async () => {
    process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID = TEST_CUSTOMER_APP_ID;
    const fixture = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = fixture.jwksJson;

    const ctx = await createE2eApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    const tenancy = await seedTestTenancy(dataSource);
    const centerId = (
      await seedCenterListing(dataSource, tenancy.serviceCenter.id)
    ).id;
    const staffRepo = dataSource.getRepository(StaffProfile);
    technicianId = (
      await staffRepo.save(
        staffRepo.create({
          serviceCenterId: centerId,
          iamUserId: TECH_IAM_USER_ID,
          displayName: 'Ravi (technician)',
          isActive: true,
        }),
      )
    ).id;

    const customerClaims = {
      domainId: TEST_CUSTOMER_DOMAIN_ID,
      domainApplicationId: TEST_CUSTOMER_APP_ID,
      roles: ['customer'],
      permissions: [],
    };
    customer = await fixture.signAccessToken({
      ...customerClaims,
      sub: TEST_CUSTOMER_IAM_USER_ID,
      mobile: '9876543210',
    });
    otherCustomer = await fixture.signAccessToken({
      ...customerClaims,
      sub: OTHER_CUSTOMER_IAM_USER_ID,
      mobile: '9123456780',
    });
    manager = await fixture.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['manager'],
      permissions: [...STAFF_PERMISSIONS, 'approvals:override'],
    });
    advisor = await fixture.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['advisor'],
      permissions: STAFF_PERMISSIONS,
    });
    technician = await fixture.signAccessToken({
      sub: TECH_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['technician'],
      permissions: ['jobs:read', 'jobs:update'],
    });

    const periodic = await asManager(http().post('/v1/center/offerings'))
      .send({ name: 'Periodic service', priceInr: 1499, durationMinutes: 90 })
      .expect(201);
    await asCustomer(http().put('/v1/me/profile'))
      .send({ displayName: 'Priya Sharma' })
      .expect(200);
    const vehicle = await asCustomer(http().post('/v1/me/vehicles'))
      .send({
        vehicleType: 'TWO_WHEELER',
        make: 'Honda',
        model: 'Activa 6G',
        registrationNumber: 'KA01AB1234',
      })
      .expect(201);
    const booking = await asCustomer(http().post('/v1/bookings'))
      .send({
        serviceCenterId: centerId,
        vehicleId: vehicle.body.id,
        mode: 'SELF_CHECKIN',
        offeringIds: [periodic.body.id],
        issueDescription: 'Brake squeal at low speed',
        ...SLOT,
      })
      .expect(201);
    if (booking.body.status === 'PENDING_CENTER') {
      await asManager(
        http().post(`/v1/center/bookings/${booking.body.id}/confirm`),
      ).expect(201);
    }
    const checkIn = await asManager(
      http().post(`/v1/center/bookings/${booking.body.id}/check-in`),
    )
      .send({ odometerKm: 8420 })
      .expect(201);
    jobId = checkIn.body.job.id;
    publicToken = checkIn.body.job.publicToken;
    expect(checkIn.body.job.jobNumber).toMatch(/^JC-\d{8}-[A-Z2-9]{4}$/);
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  describe('job card', () => {
    it('opens with the booked services as agreed scope', async () => {
      const res = await asManager(http().get(`/v1/jobs/${jobId}`)).expect(200);
      version = res.body.version;
      expect(version).toBe(1);
      expect(res.body.customerRequest).toBe('Brake squeal at low speed');
      expect(res.body.customer).toMatchObject({
        name: 'Priya Sharma',
        phone: '+919876543210',
      });
      expect(res.body.vehicle.registrationNumber).toBe('KA01AB1234');
      expect(res.body.lineItems).toHaveLength(1);
      expect(res.body.lineItems[0]).toMatchObject({
        description: 'Periodic service',
        status: 'INCLUDED',
        amountInr: '1499.00',
      });
      expect(res.body.totals.currentInr).toBe('1499.00');
      expect(res.body.budget).toMatchObject({
        ceilingInr: '1499.00',
        exceeds: false,
      });
    });

    it('assigns a technician and keeps the history', async () => {
      const res = await command(
        asManager(http().post(`/v1/jobs/${jobId}/assign`)),
        { staffProfileId: technicianId },
        200,
      );
      expect(res.body.assignedTechnician).toMatchObject({
        id: technicianId,
        displayName: 'Ravi (technician)',
      });
      const rows = await dataSource
        .getRepository(JobAssignment)
        .find({ where: { jobId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].unassignedAt).toBeNull();

      const mine = await asTech(
        http().get('/v1/jobs').query({ assignedTo: 'me', active: true }),
      ).expect(200);
      expect(mine.body.data.map((j: { id: string }) => j.id)).toEqual([jobId]);
      expect(mine.body.data[0].vehicle.registrationNumber).toBe('KA01AB1234');
    });

    it('rejects a change based on a stale version', async () => {
      const res = await asManager(http().patch(`/v1/jobs/${jobId}`))
        .set('If-Match', String(version - 1))
        .send({ fuelLevel: 'Half' })
        .expect(409);
      expect(res.body.currentVersion).toBe(version);
    });

    it('starts inspection when the checklist is saved', async () => {
      const res = await command(
        asTech(http().put(`/v1/jobs/${jobId}/inspection`)),
        {
          items: [
            { key: 'brakes', ok: false, note: 'Front pads at 2 mm' },
            { key: 'lights', ok: true },
          ],
          complete: true,
        },
        200,
      );
      expect(res.body.status).toBe('INSPECTION');
      expect(res.body.inspection.items.brakes).toEqual({
        ok: false,
        note: 'Front pads at 2 mm',
      });
      expect(res.body.inspection.completedAt).not.toBeNull();
    });

    it('edits agreed scope only before work starts', async () => {
      const added = await asManager(http().post(`/v1/jobs/${jobId}/line-items`))
        .send({ kind: 'FEE', description: 'Washing', unitPriceInr: 99 })
        .expect(201);
      expect(added.body.status).toBe('INCLUDED');
      await asManager(
        http().delete(`/v1/jobs/${jobId}/line-items/${added.body.id}`),
      ).expect(204);
      const lines = await asTech(
        http().get(`/v1/jobs/${jobId}/line-items`),
      ).expect(200);
      expect(lines.body).toHaveLength(1);
    });

    it('keeps reasoned moves on their own commands', async () => {
      const job = await asManager(http().get(`/v1/jobs/${jobId}`)).expect(200);
      version = job.body.version;
      const res = await asManager(http().patch(`/v1/jobs/${jobId}/status`))
        .send({ status: 'AWAITING_APPROVAL' })
        .expect(422);
      expect(res.body.message).toContain('/approvals');
    });
  });

  describe('extra work approval', () => {
    let approvalId: string;
    let padsLineId: string;
    let localLineId: string;

    it('asks the owner and parks the job', async () => {
      const res = await command(
        asManager(http().post(`/v1/jobs/${jobId}/approvals`)),
        {
          note: 'Pads are worn below the safe limit',
          items: [
            {
              kind: 'PART',
              description: 'Front brake pads',
              partType: 'OEM',
              unitPriceInr: 850,
            },
            {
              kind: 'PART',
              description: 'Mirror (local)',
              partType: 'LOCAL',
              quantity: 2,
              unitPriceInr: 125.5,
            },
          ],
        },
        201,
      );
      expect(res.body.status).toBe('AWAITING_APPROVAL');
      approvalId = res.body.pendingApprovalId;
      const approval = res.body.approvals[0];
      expect(approval).toMatchObject({
        version: 1,
        status: 'PENDING',
        totalInr: '1101.00',
      });
      padsLineId = approval.items[0].id;
      localLineId = approval.items[1].id;
      expect(res.body.totals.pendingInr).toBe('1101.00');
      expect(res.body.budget.exceeds).toBe(true);
    });

    it('allows one open request at a time', async () => {
      await command(
        asManager(http().post(`/v1/jobs/${jobId}/approvals`)),
        { items: [{ kind: 'LABOUR', description: 'More', unitPriceInr: 1 }] },
        409,
      );
    });

    it('shows the request to the owner', async () => {
      const list = await asCustomer(http().get('/v1/me/jobs')).expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({
        id: jobId,
        awaitingDecision: true,
        centerName: 'Test Motors',
      });
      const res = await asCustomer(http().get(`/v1/me/jobs/${jobId}`)).expect(
        200,
      );
      expect(res.body.pendingApprovalId).toBe(approvalId);
      expect(res.body.approvals[0].items).toHaveLength(2);
      expect(res.body).not.toHaveProperty('publicToken');
    });

    it('keeps other owners out', async () => {
      await as(otherCustomer)(http().get(`/v1/me/jobs/${jobId}`)).expect(404);
      await as(otherCustomer)(
        http().post(`/v1/me/jobs/${jobId}/approvals/${approvalId}/decision`),
      )
        .send({ approved: true, acknowledgeNonOemParts: true })
        .expect(404);
    });

    it('needs an acknowledgement for non-OEM parts', async () => {
      await asCustomer(
        http().post(`/v1/me/jobs/${jobId}/approvals/${approvalId}/decision`),
      )
        .send({ approved: true })
        .expect(422);
    });

    it('takes a line-by-line decision and resumes work', async () => {
      const res = await asCustomer(
        http().post(`/v1/me/jobs/${jobId}/approvals/${approvalId}/decision`),
      )
        .send({
          decisions: [
            { lineItemId: padsLineId, approved: true },
            { lineItemId: localLineId, approved: false },
          ],
        })
        .expect(200);
      expect(res.body.status).toBe('IN_PROGRESS');
      expect(res.body.approvals[0]).toMatchObject({
        status: 'PARTIALLY_APPROVED',
        decidedBy: 'CUSTOMER',
        decisionChannel: 'APP',
      });
      expect(res.body.totals).toMatchObject({
        approvedInr: '850.00',
        currentInr: '2349.00',
      });
      expect(res.body.lineItems.map((l: { id: string }) => l.id)).not.toContain(
        localLineId,
      );

      await asCustomer(
        http().post(`/v1/me/jobs/${jobId}/approvals/${approvalId}/decision`),
      )
        .send({ approved: true })
        .expect(409);
    });

    it('withdraws a request back to where the job was', async () => {
      const job = await asManager(http().get(`/v1/jobs/${jobId}`)).expect(200);
      version = job.body.version;
      const asked = await command(
        asManager(http().post(`/v1/jobs/${jobId}/approvals`)),
        {
          items: [
            { kind: 'LABOUR', description: 'Chain adjust', unitPriceInr: 150 },
          ],
        },
        201,
      );
      const res = await asManager(
        http().post(
          `/v1/jobs/${jobId}/approvals/${asked.body.pendingApprovalId}/withdraw`,
        ),
      ).expect(200);
      version = res.body.version;
      expect(res.body.status).toBe('IN_PROGRESS');
      expect(res.body.approvals[1].status).toBe('WITHDRAWN');
      expect(res.body.totals.currentInr).toBe('2349.00');
    });

    it('records a verbal decision with an audit trail', async () => {
      const asked = await command(
        asManager(http().post(`/v1/jobs/${jobId}/approvals`)),
        {
          items: [
            { kind: 'LABOUR', description: 'Clutch cable', unitPriceInr: 300 },
          ],
        },
        201,
      );
      const id = asked.body.pendingApprovalId;
      const body = {
        channel: 'PHONE',
        approved: true,
        note: 'Approved on call at 11:40',
        contactPhone: '+919876543210',
      };
      await as(advisor)(
        http().post(`/v1/jobs/${jobId}/approvals/${id}/override`),
      )
        .send(body)
        .expect(403);
      await asManager(http().post(`/v1/jobs/${jobId}/approvals/${id}/override`))
        .send({ channel: 'PHONE', approved: true })
        .expect(400);

      const res = await asManager(
        http().post(`/v1/jobs/${jobId}/approvals/${id}/override`),
      )
        .send(body)
        .expect(200);
      version = res.body.version;
      expect(res.body.status).toBe('IN_PROGRESS');
      expect(res.body.approvals[2]).toMatchObject({
        status: 'APPROVED',
        decidedBy: 'STAFF',
        decisionChannel: 'PHONE',
      });
      const audit = await dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ entityId: id, action: 'VERBAL_OVERRIDE' });
      expect(audit.after).toEqual({ status: 'APPROVED' });
    });
  });

  describe('floor work', () => {
    it('holds with a reason and resumes where it paused', async () => {
      const held = await command(
        asTech(http().post(`/v1/jobs/${jobId}/hold`)),
        {
          reason: 'Waiting for brake pads',
          expectedResumeAt: '2099-01-01T10:00:00.000Z',
        },
        200,
      );
      expect(held.body.status).toBe('ON_HOLD');
      expect(held.body.hold.reason).toBe('Waiting for brake pads');

      await asTech(http().patch(`/v1/jobs/${jobId}/status`))
        .send({ status: 'IN_PROGRESS' })
        .expect(422);

      const resumed = await command(
        asTech(http().post(`/v1/jobs/${jobId}/resume`)),
        undefined,
        200,
      );
      expect(resumed.body.status).toBe('IN_PROGRESS');
      expect(resumed.body.hold).toBeNull();
    });

    it('shows confirmed customer-visible photos to the owner', async () => {
      const media = await asTech(http().post(`/v1/jobs/${jobId}/media`))
        .send({
          kind: 'BEFORE',
          mimeType: 'image/jpeg',
          sizeBytes: 350000,
          caption: 'Worn pads',
          visibleToCustomer: true,
        })
        .expect(201);
      expect(media.body.uploadStatus).toBe('PENDING');
      expect(media.body.url).toBeNull();

      let view = await asCustomer(http().get(`/v1/me/jobs/${jobId}`)).expect(
        200,
      );
      expect(view.body.media).toHaveLength(0);

      await asTech(
        http().post(`/v1/jobs/${jobId}/media/${media.body.id}/confirm`),
      ).expect(200);
      view = await asCustomer(http().get(`/v1/me/jobs/${jobId}`)).expect(200);
      expect(view.body.media).toHaveLength(1);
      expect(view.body.media[0].caption).toBe('Worn pads');

      await asTech(http().post(`/v1/jobs/${jobId}/media`))
        .send({ kind: 'BEFORE', mimeType: 'application/pdf', sizeBytes: 10 })
        .expect(400);
    });

    it('separates internal notes from customer updates', async () => {
      await asTech(http().post(`/v1/jobs/${jobId}/notes`))
        .send({ message: 'Torque spec checked twice' })
        .expect(201);
      await asTech(http().post(`/v1/jobs/${jobId}/notes`))
        .send({ message: 'Pads fitted, testing now', visibleToCustomer: true })
        .expect(201);
      const view = await asCustomer(http().get(`/v1/me/jobs/${jobId}`)).expect(
        200,
      );
      const messages = view.body.timeline
        .filter((e: { type: string }) => e.type === 'NOTE')
        .map((e: { payload: { message: string } }) => e.payload.message);
      expect(messages).toEqual(['Pads fitted, testing now']);
    });

    it('replays a repeated command with the same key', async () => {
      const key = 'note-retry-0001';
      const first = await asTech(http().post(`/v1/jobs/${jobId}/notes`))
        .set('Idempotency-Key', key)
        .send({ message: 'Road test done' })
        .expect(201);
      const again = await asTech(http().post(`/v1/jobs/${jobId}/notes`))
        .set('Idempotency-Key', key)
        .send({ message: 'Road test done' })
        .expect(201);
      expect(again.body.id).toBe(first.body.id);
      await asTech(http().post(`/v1/jobs/${jobId}/notes`))
        .set('Idempotency-Key', key)
        .send({ message: 'Something else' })
        .expect(422);
    });

    it('sends a failed quality check back to work', async () => {
      const job = await asManager(http().get(`/v1/jobs/${jobId}`)).expect(200);
      version = job.body.version;
      await command(
        asTech(http().patch(`/v1/jobs/${jobId}/status`)),
        { status: 'QUALITY_CHECK' },
        200,
      );
      await command(
        asManager(http().post(`/v1/jobs/${jobId}/qc`)),
        { passed: false },
        422,
      );
      const failed = await command(
        asManager(http().post(`/v1/jobs/${jobId}/qc`)),
        { passed: false, notes: 'Rear brake still soft' },
        200,
      );
      expect(failed.body.status).toBe('IN_PROGRESS');
      expect(failed.body.qc.notes).toBe('Rear brake still soft');
    });

    it('releases the vehicle once the quality check passes', async () => {
      await command(
        asTech(http().patch(`/v1/jobs/${jobId}/status`)),
        { status: 'QUALITY_CHECK' },
        200,
      );
      await asManager(http().patch(`/v1/jobs/${jobId}/status`))
        .send({ status: 'READY_FOR_PICKUP' })
        .expect(422);
      const passed = await command(
        asManager(http().post(`/v1/jobs/${jobId}/qc`)),
        { passed: true },
        200,
      );
      expect(passed.body.status).toBe('READY_FOR_PICKUP');
      expect(passed.body.qc.passedAt).not.toBeNull();
    });

    it('tracks progress publicly without personal details', async () => {
      const res = await http().get(`/v1/track/${publicToken}`).expect(200);
      expect(res.body).toMatchObject({
        status: 'READY_FOR_PICKUP',
        centerName: 'Test Motors',
        vehicleRegistration: 'KA01••1234',
        awaitingApproval: false,
      });
      expect(JSON.stringify(res.body)).not.toContain('9876543210');
      expect(res.body.progress.length).toBeGreaterThan(3);
      await http().get('/v1/track/not-a-real-token').expect(404);
    });
  });

  describe('walk-in cancellation', () => {
    it('cancels with a reason and freezes the job', async () => {
      const created = await asManager(http().post('/v1/jobs'))
        .send({
          customerPhone: '+919000000001',
          vehicleRegistration: 'ka-05 mn 4321',
          serviceType: 'Puncture repair',
        })
        .expect(201);
      expect(created.body.jobNumber).toMatch(/^JC-/);
      expect(created.body.vehicle.registrationNumber).toBe('KA05MN4321');
      version = created.body.version;

      await asManager(http().post(`/v1/jobs/${created.body.id}/cancel`))
        .send({ reason: 'x' })
        .expect(400);
      const cancelled = await command(
        asManager(http().post(`/v1/jobs/${created.body.id}/cancel`)),
        { reason: 'Customer left before work started' },
        200,
      );
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.closedAt).not.toBeNull();
      await asManager(http().post(`/v1/jobs/${created.body.id}/hold`))
        .send({ reason: 'Parts' })
        .expect(409);
      await asTech(http().post(`/v1/jobs/${created.body.id}/cancel`))
        .send({ reason: 'Customer left' })
        .expect(403);
    });
  });
});
