import { addDays, istToday } from '../src/common/time/ist';
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { addDays, addMonths, istToday } from '../src/common/time/ist';
import { Payment } from '../src/modules/billing/entities/payment.entity';
import { JobLineItem } from '../src/modules/jobs/entities/job-line-item.entity';
import { createJwtTestFixture } from '../src/test-utils/jwt-test.helper';
import { createE2eApp } from './helpers/e2e-app.helper';
import { seedReturningWalkIn } from './helpers/returning-walk-in.helper';
import {
  seedCenterListing,
  seedTestTenancy,
  TEST_CUSTOMER_APP_ID,
  TEST_CUSTOMER_DOMAIN_ID,
  TEST_CUSTOMER_IAM_USER_ID,
  TEST_DOMAIN_ID,
  TEST_IAM_USER_ID,
} from './helpers/test-db.helper';

const OTHER_CUSTOMER_IAM_USER_ID = '88888888-8888-4888-8888-888888888888';

/** Wednesday 2027-06-16, 11:00–12:00 IST. */
const SLOT = {
  slotStart: `${addDays(istToday(), 1)}T05:30:00.000Z`,
  slotEnd: `${addDays(istToday(), 1)}T06:30:00.000Z`,
};

const CHECKLIST = {
  work_verified: true,
  road_test: true,
  no_tools_left: true,
  customer_briefed: true,
};

describe('Ownership after service (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let customer: string;
  let otherCustomer: string;
  let manager: string;
  let advisor: string;
  let vehicleId: string;
  let jobId: string;
  let version: number;
  let padsLineId: string;
  let invoiceId: string;
  let centerId: string;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);
  const asManager = (req: request.Test) => as(manager)(req);
  const asCustomer = (req: request.Test) => as(customer)(req);

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

  const refresh = async (id = jobId) => {
    const res = await asManager(http().get(`/v1/jobs/${id}`)).expect(200);
    version = res.body.version;
    return res.body;
  };

  const inbox = async (token = customer) =>
    (await as(token)(http().get('/v1/me/notifications')).expect(200)).body as {
      items: { id: string; title: string; category: string; read: boolean }[];
      unreadCount: number;
    };

  beforeAll(async () => {
    process.env.IAM_CUSTOMER_DOMAIN_APPLICATION_ID = TEST_CUSTOMER_APP_ID;
    const fixture = await createJwtTestFixture();
    process.env.LOCAL_JWKS_JSON = fixture.jwksJson;

    const ctx = await createE2eApp();
    app = ctx.app;
    dataSource = ctx.dataSource;
    const tenancy = await seedTestTenancy(dataSource);
    centerId = tenancy.serviceCenter.id;
    await seedCenterListing(dataSource, tenancy.serviceCenter.id);

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
    const desk = [
      'jobs:create',
      'jobs:read',
      'jobs:update',
      'bookings:read',
      'bookings:manage',
      'center:manage',
    ];
    manager = await fixture.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['manager'],
      permissions: [...desk, 'billing:manage'],
    });
    advisor = await fixture.signAccessToken({
      sub: TEST_IAM_USER_ID,
      domainId: TEST_DOMAIN_ID,
      roles: ['advisor'],
      permissions: desk,
    });

    await asManager(http().patch('/v1/center'))
      .set('If-Match', '1').set('Idempotency-Key', randomUUID())
      .send({ autoAccept: false })
      .expect(200);
    const offering = await asManager(http().post('/v1/center/offerings'))
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'Periodic service', priceInr: 1499, durationMinutes: 90 })
      .expect(201);
    await asCustomer(http().put('/v1/me/profile'))
      .send({ displayName: 'Priya Sharma', dateOfBirth: '1994-03-12' })
      .expect(200);
    const vehicle = await asCustomer(http().post('/v1/me/vehicles'))
      .send({
        vehicleType: 'TWO_WHEELER',
        make: 'Honda',
        model: 'Activa 6G',
        registrationNumber: 'KA01AB1234',
        currentOdometerKm: 8400,
      })
      .expect(201);
    vehicleId = vehicle.body.id;

    const booking = await asCustomer(http().post('/v1/bookings'))
      .send({
        serviceCenterId: tenancy.serviceCenter.id,
        vehicleId,
        mode: 'SELF_CHECKIN',
        offeringIds: [offering.body.id],
        issueDescription: 'Routine service',
        ...SLOT,
      })
      .expect(201);
    expect(booking.body.status).toBe('PENDING_CENTER');
    await asManager(
      http().post(`/v1/center/bookings/${booking.body.id}/confirm`),
    ).expect(200);
    const checkIn = await asManager(
      http().post(`/v1/center/bookings/${booking.body.id}/check-in`),
    )
      .send({ odometerKm: 8420 })
      .expect(201);
    jobId = checkIn.body.job.id;
  }, 60000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });

  describe('notifications', () => {
    it('tells the owner the booking is confirmed', async () => {
      const box = await inbox();
      const titles = box.items.map((n) => n.title);
      expect(titles).toContain('Booking confirmed');
      expect(box.unreadCount).toBe(box.items.length);
    });

    it('marks one or all as read', async () => {
      const box = await inbox();
      const read = await asCustomer(
        http().post(`/v1/me/notifications/${box.items[0].id}/read`),
      ).expect(200);
      expect(read.body.read).toBe(true);
      await asCustomer(http().post('/v1/me/notifications/read-all')).expect(
        200,
      );
      expect((await inbox()).unreadCount).toBe(0);
      await as(otherCustomer)(
        http().post(`/v1/me/notifications/${box.items[0].id}/read`),
      ).expect(404);
    });
  });

  describe('express skip', () => {
    it('is refused while the center flag is off', async () => {
      await refresh();
      await command(
        asManager(http().post(`/v1/jobs/${jobId}/skip`)),
        { step: 'INSPECTION', reason: 'Routine service only' },
        422,
      );
    });

    it('skips inspection once enabled', async () => {
      const center = await asManager(http().patch('/v1/center'))
        .send({ expressSkipEnabled: true, upiVpa: 'testmotors@okaxis' })
        .expect(200);
      expect(center.body).toMatchObject({
        expressSkipEnabled: true,
        upiVpa: 'testmotors@okaxis',
      });
      const res = await command(
        asManager(http().post(`/v1/jobs/${jobId}/skip`)),
        { step: 'INSPECTION', reason: 'Routine service only' },
        200,
      );
      expect(res.body.status).toBe('IN_PROGRESS');
      expect(res.body.skippedSteps).toEqual(['INSPECTION']);
      expect(res.body.timeline.map((e: { type: string }) => e.type)).toContain(
        'INSPECTION_SKIPPED',
      );
    });

    it('never skips QC on brake work', async () => {
      const asked = await command(
        asManager(http().post(`/v1/jobs/${jobId}/approvals`)),
        {
          items: [
            {
              kind: 'PART',
              description: 'Front brake pads',
              partType: 'OEM',
              unitPriceInr: 850,
            },
          ],
        },
        201,
      );
      padsLineId = asked.body.approvals[0].items[0].id;
      await asCustomer(
        http().post(
          `/v1/me/jobs/${jobId}/approvals/${asked.body.pendingApprovalId}/decision`,
        ),
      )
        .send({ approved: true })
        .expect(200);
      await refresh();
      const res = await command(
        asManager(http().post(`/v1/jobs/${jobId}/skip`)),
        { step: 'QC', reason: 'In a hurry' },
        422,
      );
      expect(res.body.message).toContain('safety');
    });

    it('notifies the owner about the approval request', async () => {
      const titles = (await inbox()).items.map((n) => n.title);
      expect(titles.some((t) => /approval/i.test(t))).toBe(true);
    });
  });

  describe('bill and close', () => {
    it('reaches pickup through a normal quality check', async () => {
      await command(
        asManager(http().patch(`/v1/jobs/${jobId}/status`)),
        { status: 'QUALITY_CHECK' },
        200,
      );
      const passed = await command(
        asManager(http().post(`/v1/jobs/${jobId}/qc`)),
        { passed: true },
        200,
      );
      expect(passed.body.status).toBe('READY_FOR_PICKUP');
      const res = await asManager(http().patch(`/v1/jobs/${jobId}/status`))
        .send({ status: 'COMPLETED' })
        .expect(422);
      expect(res.body.message).toContain('/close');
    });

    it('needs a reason when the bill differs from the approved total', async () => {
      await command(
        asManager(http().post(`/v1/jobs/${jobId}/invoice`)),
        { finalAmountInr: 2300 },
        422,
      );
      await command(
        asManager(http().post(`/v1/jobs/${jobId}/invoice`)),
        { finalAmountInr: 2300, adjustmentReason: 'OTHER' },
        422,
      );
    });

    it('keeps billing to staff with billing access', async () => {
      await as(advisor)(http().post(`/v1/jobs/${jobId}/invoice`))
        .set('If-Match', String(version))
        .send({})
        .expect(403);
    });

    it('issues the bill with an adjustment line', async () => {
      const res = await asManager(http().post(`/v1/jobs/${jobId}/invoice`))
        .set('If-Match', String(version))
        .send({ finalAmountInr: 2300, adjustmentReason: 'DISCOUNT' })
        .expect(201);
      invoiceId = res.body.id;
      expect(res.body).toMatchObject({
        status: 'DUE',
        subtotalInr: '2349.00',
        adjustmentInr: '-49.00',
        totalInr: '2300.00',
        balanceInr: '2300.00',
        upiVpa: 'testmotors@okaxis',
      });
      expect(res.body.invoiceNumber).toMatch(/^INV-\d{8}-[A-Z2-9]{4}$/);
      expect(res.body.lineItems.map((l: { kind: string }) => l.kind)).toEqual([
        'LABOUR',
        'PART',
        'ADJUSTMENT',
      ]);
      expect(res.body.buyer).toMatchObject({
        name: 'Priya Sharma',
        vehicleRegistration: 'KA01AB1234',
      });

      const job = await refresh();
      expect(job.invoice).toMatchObject({ id: invoiceId, status: 'DUE' });
      expect(job.close.finalAmountInr).toBe('2300.00');
    });

    it('shows the bill and UPI id to the owner', async () => {
      const list = await asCustomer(http().get('/v1/me/invoices')).expect(200);
      expect(list.body.map((i: { id: string }) => i.id)).toEqual([invoiceId]);
      const view = await asCustomer(http().get(`/v1/me/jobs/${jobId}`)).expect(
        200,
      );
      expect(view.body).toMatchObject({
        upiVpa: 'testmotors@okaxis',
        invoice: { id: invoiceId, status: 'DUE', totalInr: '2300.00' },
      });
      await as(otherCustomer)(
        http().get(`/v1/me/invoices/${invoiceId}`),
      ).expect(404);
      const titles = (await inbox()).items.map((n) => n.title);
      expect(titles.some((t) => /bill/i.test(t))).toBe(true);
    });

    it('requires the checklist because a step was skipped', async () => {
      const res = await command(
        asManager(http().post(`/v1/jobs/${jobId}/close`)),
        {
          finalAmountInr: 2300,
          adjustmentReason: 'DISCOUNT',
          payment: { method: 'UPI', amountInr: 2300 },
        },
        422,
      );
      expect(res.body.message).toContain('road_test');
    });

    it('rejects a payment that does not match the bill', async () => {
      await command(
        asManager(http().post(`/v1/jobs/${jobId}/close`)),
        {
          finalAmountInr: 2300,
          adjustmentReason: 'DISCOUNT',
          payment: { method: 'UPI', amountInr: 2000 },
          closeChecklist: CHECKLIST,
        },
        422,
      );
    });

    it('only returns billed part lines to the owner', async () => {
      const job = await refresh();
      const labour = job.lineItems.find(
        (l: { kind: string }) => l.kind === 'LABOUR',
      );
      await command(
        asManager(http().post(`/v1/jobs/${jobId}/close`)),
        {
          finalAmountInr: 2300,
          adjustmentReason: 'DISCOUNT',
          payment: { method: 'UPI', amountInr: 2300 },
          closeChecklist: CHECKLIST,
          returnedPartLineIds: [labour.id],
        },
        422,
      );
    });

    it('takes payment and completes the job', async () => {
      const res = await command(
        asManager(http().post(`/v1/jobs/${jobId}/close`)),
        {
          finalAmountInr: 2300,
          adjustmentReason: 'DISCOUNT',
          payment: { method: 'UPI', amountInr: 2300, reference: 'UPI4471' },
          closeChecklist: CHECKLIST,
          returnedPartLineIds: [padsLineId],
          finalNotes: 'Next service at 11,000 km',
        },
        200,
      );
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.closedAt).not.toBeNull();
      expect(res.body.invoice).toMatchObject({ id: invoiceId, status: 'PAID' });
      expect(res.body.close).toMatchObject({
        finalAmountInr: '2300.00',
        adjustmentReason: 'DISCOUNT',
        finalNotes: 'Next service at 11,000 km',
        checklist: CHECKLIST,
      });
      const types = res.body.timeline.map((e: { type: string }) => e.type);
      expect(types).toContain('PAYMENT_RECORDED');

      const pads = await dataSource
        .getRepository(JobLineItem)
        .findOneByOrFail({ id: padsLineId });
      expect(pads.partReturnedAt).not.toBeNull();
      const payments = await dataSource.getRepository(Payment).find();
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({
        method: 'UPI',
        reference: 'UPI4471',
      });
      expect(Number(payments[0].amountInr)).toBe(2300);

      const bill = await asCustomer(
        http().get(`/v1/me/invoices/${invoiceId}`),
      ).expect(200);
      expect(bill.body).toMatchObject({ status: 'PAID', balanceInr: '0.00' });
      expect(bill.body.payments).toHaveLength(1);
    });

    it('cannot close twice', async () => {
      await command(
        asManager(http().post(`/v1/jobs/${jobId}/close`)),
        { payment: { method: 'CASH', amountInr: 2300 } },
        409,
      );
    });

    it('lists the center bills by status', async () => {
      const paid = await asManager(
        http().get('/v1/center/invoices').query({ status: 'PAID' }),
      ).expect(200);
      expect(paid.body.map((i: { id: string }) => i.id)).toEqual([invoiceId]);
      const due = await asManager(
        http().get('/v1/center/invoices').query({ status: 'DUE' }),
      ).expect(200);
      expect(due.body).toHaveLength(0);
    });

    it('logs outbound messages for the job', async () => {
      const res = await asManager(
        http().get(`/v1/jobs/${jobId}/notifications`),
      ).expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(
        res.body.every((d: { status: string }) =>
          ['SIMULATED', 'SKIPPED'].includes(d.status),
        ),
      ).toBe(true);
    });

    it('runs the express path end to end on a walk-in', async () => {
      const created = await asManager(http().post('/v1/jobs'))
        .set('Idempotency-Key', randomUUID())
        .send({
          ...(
            await seedReturningWalkIn(dataSource, centerId, {
              phone: '+919000000001',
              registrationNumber: 'KA05MN4321',
            })
          ).selection,
          serviceType: 'Oil change',
        })
        .expect(201);
      const walkIn = created.body.id as string;
      await refresh(walkIn);
      await asManager(http().post(`/v1/jobs/${walkIn}/line-items`))
        .send({ kind: 'LABOUR', description: 'Oil change', unitPriceInr: 350 })
        .expect(201);
      await refresh(walkIn);
      await command(
        asManager(http().post(`/v1/jobs/${walkIn}/skip`)),
        { step: 'INSPECTION', reason: 'Oil change only' },
        200,
      );
      const ready = await command(
        asManager(http().post(`/v1/jobs/${walkIn}/skip`)),
        { step: 'QC', reason: 'Oil change only' },
        200,
      );
      expect(ready.body.status).toBe('READY_FOR_PICKUP');
      expect(ready.body.skippedSteps).toEqual(['INSPECTION', 'QC']);

      const closed = await command(
        asManager(http().post(`/v1/jobs/${walkIn}/close`)),
        {
          payment: { method: 'CASH', amountInr: 350 },
          closeChecklist: CHECKLIST,
        },
        200,
      );
      expect(closed.body.status).toBe('COMPLETED');
      expect(closed.body.invoice.status).toBe('PAID');
    });
  });

  describe('document vault', () => {
    let insuranceId: string;
    const soon = addDays(istToday(), 10);

    it('ties vehicle papers to a vehicle and a licence to the owner', async () => {
      await asCustomer(http().post('/v1/me/documents'))
        .send({ category: 'INSURANCE', title: 'Insurance policy' })
        .expect(422);
      await asCustomer(http().post('/v1/me/documents'))
        .send({ category: 'DRIVING_LICENCE', title: 'Licence', vehicleId })
        .expect(422);
    });

    it('declares a file and confirms the upload', async () => {
      const res = await asCustomer(http().post('/v1/me/documents'))
        .send({
          category: 'INSURANCE',
          title: 'Insurance policy',
          vehicleId,
          issuer: 'Acko',
          expiryDate: soon,
          file: {
            fileName: 'policy.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 120000,
          },
        })
        .expect(201);
      insuranceId = res.body.document.id;
      expect(res.body.uploads).toHaveLength(1);
      expect(res.body.uploads[0].storageKey).toMatch(
        new RegExp(`/vault/${insuranceId}/front\\.pdf$`),
      );
      expect(res.body.document).toMatchObject({
        expiryState: 'EXPIRING_SOON',
        daysToExpiry: 10,
        vehicle: { registrationNumber: 'KA01AB1234' },
        file: { uploadStatus: 'PENDING' },
      });
      const confirmed = await asCustomer(
        http().post(`/v1/me/documents/${insuranceId}/confirm`),
      ).expect(200);
      expect(confirmed.body.file.uploadStatus).toBe('CONFIRMED');
    });

    it('flags expired and expiring documents', async () => {
      await asCustomer(http().post('/v1/me/documents'))
        .send({
          category: 'DRIVING_LICENCE',
          title: 'Driving licence',
          documentNumber: 'KA0120200001234',
          expiryDate: addDays(istToday(), -1),
        })
        .expect(201);
      await asCustomer(http().post('/v1/me/documents'))
        .send({ category: 'OTHER', title: 'Purchase receipt' })
        .expect(201);
      const res = await asCustomer(
        http().get('/v1/me/documents').query({ attention: true }),
      ).expect(200);
      expect(
        res.body.map((d: { expiryState: string }) => d.expiryState),
      ).toEqual(['EXPIRED', 'EXPIRING_SOON']);
    });

    it('archives, restores and deletes', async () => {
      await asCustomer(
        http().post(`/v1/me/documents/${insuranceId}/archive`),
      ).expect(200);
      let list = await asCustomer(http().get('/v1/me/documents')).expect(200);
      expect(list.body.map((d: { id: string }) => d.id)).not.toContain(
        insuranceId,
      );
      await asCustomer(
        http().post(`/v1/me/documents/${insuranceId}/restore`),
      ).expect(200);
      await as(otherCustomer)(
        http().get(`/v1/me/documents/${insuranceId}`),
      ).expect(404);
      await asCustomer(http().delete(`/v1/me/documents/${insuranceId}`)).expect(
        204,
      );
      list = await asCustomer(http().get('/v1/me/documents')).expect(200);
      expect(list.body).toHaveLength(2);
    });
  });

  describe('maintenance reminders', () => {
    let oilId: string;
    let pucId: string;
    const today = istToday();

    it('needs a due date or odometer reading', async () => {
      await asCustomer(http().post('/v1/me/maintenance'))
        .send({ vehicleId, title: 'Chain lube' })
        .expect(422);
    });

    it('computes overdue from date and odometer', async () => {
      const oil = await asCustomer(http().post('/v1/me/maintenance'))
        .send({
          vehicleId,
          title: 'Engine oil change',
          dueDate: addDays(today, 30),
          dueOdometerKm: 8000,
          intervalMonths: 6,
          intervalKm: 3000,
        })
        .expect(201);
      oilId = oil.body.id;
      expect(oil.body).toMatchObject({
        state: 'OVERDUE',
        kmToDue: -420,
        vehicle: { currentOdometerKm: 8420 },
      });

      const puc = await asCustomer(http().post('/v1/me/maintenance'))
        .send({ vehicleId, title: 'PUC renewal', dueDate: addDays(today, 5) })
        .expect(201);
      pucId = puc.body.id;
      expect(puc.body.state).toBe('DUE_SOON');

      const list = await asCustomer(http().get('/v1/me/maintenance')).expect(
        200,
      );
      expect(list.body.map((m: { id: string }) => m.id)).toEqual([
        oilId,
        pucId,
      ]);
    });

    it('rolls a repeating reminder forward', async () => {
      const res = await asCustomer(
        http().post(`/v1/me/maintenance/${oilId}/complete`),
      )
        .send({ odometerKm: 9000 })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'UPCOMING',
        dueDate: addMonths(today, 6),
        dueOdometerKm: 12000,
        lastCompletedOn: today,
        lastCompletedOdometerKm: 9000,
      });
    });

    it('snoozes within limits and completes a one-off', async () => {
      await asCustomer(http().post(`/v1/me/maintenance/${pucId}/snooze`))
        .send({ until: addDays(today, 120) })
        .expect(422);
      const snoozed = await asCustomer(
        http().post(`/v1/me/maintenance/${pucId}/snooze`),
      )
        .send({ until: addDays(today, 20) })
        .expect(200);
      expect(snoozed.body.state).toBe('SNOOZED');
      const done = await asCustomer(
        http().post(`/v1/me/maintenance/${pucId}/complete`),
      )
        .send({})
        .expect(200);
      expect(done.body.state).toBe('COMPLETED');
      const list = await asCustomer(http().get('/v1/me/maintenance')).expect(
        200,
      );
      expect(list.body.map((m: { id: string }) => m.id)).toEqual([oilId]);
      await as(otherCustomer)(http().get(`/v1/me/maintenance/${oilId}`)).expect(
        404,
      );
    });
  });

  describe('support', () => {
    it('only links your own service', async () => {
      await as(otherCustomer)(http().post('/v1/me/support-requests'))
        .send({
          category: 'PAYMENT',
          subject: 'Charged twice',
          message: 'I think I was charged twice for this.',
          jobId,
        })
        .expect(422);
    });

    it('gives a reference and confirms in the inbox', async () => {
      const res = await asCustomer(http().post('/v1/me/support-requests'))
        .send({
          category: 'PAYMENT',
          subject: 'Discount on my bill',
          message: 'Please send a GST copy of the bill for this service.',
          jobId,
          preferredChannel: 'WHATSAPP',
        })
        .expect(201);
      expect(res.body.referenceNumber).toMatch(/^SR-\d{8}-[A-Z2-9]{4}$/);
      expect(res.body.status).toBe('OPEN');
      const list = await asCustomer(
        http().get('/v1/me/support-requests'),
      ).expect(200);
      expect(list.body).toHaveLength(1);
      const titles = (await inbox()).items.map((n) => n.title);
      expect(titles).toContain(
        `We got your request ${res.body.referenceNumber}`,
      );
    });
  });
});
