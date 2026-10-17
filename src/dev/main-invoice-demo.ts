import 'reflect-metadata';
import { randomBytes, randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { JobStatus } from '../common/enums/job-status.enum';
import { JobLineKind, JobLineStatus } from '../common/enums/job-work.enum';
import { VehicleType } from '../common/enums/vehicle-type.enum';
import { AuthContext } from '../modules/auth/interfaces/auth-context.interface';
import { BillingPolicy } from '../modules/billing/billing-calculator';
import { BillingConfigService } from '../modules/billing/billing-config.service';
import { CustomerProfile } from '../modules/customers/entities/customer-profile.entity';
import { Customer } from '../modules/customers/entities/customer.entity';
import { Vehicle } from '../modules/customers/entities/vehicle.entity';
import { commandMeta } from '../modules/idempotency/transactional-receipt';
import { JobCustomerAccess } from '../modules/jobs/entities/job-customer-access.entity';
import { JobLineItem } from '../modules/jobs/entities/job-line-item.entity';
import { ServiceJob } from '../modules/jobs/entities/service-job.entity';
import { ServiceCenter } from '../modules/tenancy/entities/service-center.entity';
import {
  customerIdForPhone,
  STAFF_PERSONAS,
  WORKSHOP_CENTER,
} from './dev-personas';
import { bootstrapWorkshopApp } from './main-workshop';

loadEnv();
// This entry point cannot enable billing on the normal workshop database.
if (
  process.env.DATABASE_NAME !== 'autoflex_af019_demo' ||
  !['127.0.0.1', 'localhost', '::1'].includes(
    process.env.DATABASE_HOST ?? '',
  ) ||
  process.env.NODE_ENV === 'production'
) {
  throw new Error(
    'Invoice demo requires a loopback DATABASE_HOST and DATABASE_NAME=autoflex_af019_demo, outside production.',
  );
}
process.env.BILLING_V2_ENABLED = 'true';
process.env.INVOICE_STORAGE_DRIVER ??= 'filesystem';
process.env.INVOICE_LOCAL_DIRECTORY ??= '.private-invoices/synthetic-demo';
process.env.INVOICE_DOCUMENT_WORKER_ENABLED ??= 'true';
process.env.IAM_FINANCE_DOMAIN_APPLICATION_ID = 'synthetic-finance-app';
process.env.IAM_FINANCE_DOMAIN_ID = 'synthetic-finance-domain';
Object.assign(WORKSHOP_CENTER, {
  name: 'Autoflex Invoice Demo (Synthetic)',
  slug: 'synthetic-invoice-demo',
});
for (const persona of STAFF_PERSONAS) {
  // New arrays keep the advisor's shared base permissions unchanged.
  if (persona.role === 'manager')
    persona.permissions = [
      ...persona.permissions,
      'billing:issue',
      'billing:record-payment',
      'billing:correct',
    ];
  if (persona.role === 'advisor')
    persona.permissions = [...persona.permissions, 'billing:issue'];
}

const policy: BillingPolicy = {
  cancellation: {
    unpaid: 'ALLOW',
    maxAgeDays: 365,
    basisReference: 'SYNTHETIC-DEMO-ONLY',
  },
  discounts: {
    mode: 'LINE_BEFORE_TAX',
    maxBps: 5000,
    basisReference: 'SYNTHETIC-DEMO-ONLY',
  },
  corrections: {
    creditPrefix: 'DCR',
    debitPrefix: 'DDR',
    initialSequence: 1,
    maxAgeDays: 365,
    taxMode: 'ORIGINAL_COMPONENT_PROPORTION',
    basisReference: 'SYNTHETIC-DEMO-ONLY',
  },
  seller: {
    name: 'SYNTHETIC DEMO — NOT A REAL SELLER',
    address: 'Synthetic Road, Bengaluru',
    pin: '560001',
    stateCode: '29',
    gstin: '29ABCDE1234F1ZW',
    registrationStatus: 'REGULAR',
    signatory: 'Synthetic Demo Reviewer',
  },
  buyerModes: ['INDIVIDUAL', 'BUSINESS'],
  irp: {
    businessMode: 'NOT_APPLICABLE',
    basisReference: 'SYNTHETIC-DEMO-ONLY; not an operating-center assessment',
  },
  effectiveFrom: '2020-04-01',
  seriesPrefix: 'DEMO',
  initialSequence: 1,
  financialYearStartMonth: 4,
  placeOfSupplyRules: ['INDIVIDUAL', 'BUSINESS'].map((buyerType) => ({
    key: buyerType.toLowerCase() + '-29',
    buyerType: buyerType as 'INDIVIDUAL' | 'BUSINESS',
    buyerStateCode: '29',
    context: 'AT_CENTER',
    supplyStateCode: '29',
    basisReference: 'SYNTHETIC-DEMO-ONLY',
  })),
  rules: [
    {
      key: 'demo-labour',
      kind: 'LABOUR',
      classificationCode: '998714',
      treatment: 'TAXABLE',
      rateBps: 1800,
      priceMode: 'EXCLUSIVE',
    },
    {
      key: 'demo-part',
      kind: 'PART',
      classificationCode: '8708',
      treatment: 'TAXABLE',
      rateBps: 1800,
      priceMode: 'INCLUSIVE',
    },
    {
      key: 'demo-package',
      kind: 'PACKAGE',
      classificationCode: '998714',
      treatment: 'TAXABLE',
      rateBps: 1800,
      priceMode: 'EXCLUSIVE',
    },
  ],
};

bootstrapWorkshopApp(async (app) => {
  const db = app.get(DataSource);
  const center = await db
    .getRepository(ServiceCenter)
    .findOneByOrFail({ iamDomainId: WORKSHOP_CENTER.iamDomainId });
  await db
    .getRepository(ServiceCenter)
    .update(center.id, { gstin: policy.seller.gstin, upiVpa: null });
  const finance = app.get(BillingConfigService);
  const actor = (reviewer: boolean): AuthContext => ({
    actorType: 'finance',
    userId: reviewer ? 'synthetic-reviewer' : 'synthetic-operator',
    domainId: 'synthetic-finance-domain',
    domainApplicationId: 'synthetic-finance-app',
    roles: [reviewer ? 'finance_reviewer' : 'finance_operator'],
    permissions: [reviewer ? 'billing:approve' : 'billing:configure'],
    serviceCenterId: null,
    staffProfileId: null,
    customerProfileId: null,
  });
  const listing = await finance.list(actor(false), center.id);
  const approved = listing.configurations.find((c) => c.status === 'APPROVED');
  if (
    !listing.configurations.length ||
    (approved &&
      (!approved.policy.cancellation ||
        !approved.policy.corrections ||
        !approved.policy.discounts))
  ) {
    const body = {
      policy: approved
        ? {
            ...approved.policy,
            cancellation: approved.policy.cancellation ?? policy.cancellation,
            corrections: approved.policy.corrections ?? policy.corrections,
            discounts: approved.policy.discounts ?? policy.discounts,
          }
        : policy,
      evidenceReference: 'SYNTHETIC-DEMO-ONLY — no accountant approval claimed',
    };
    const meta = (version: number, value: object) =>
      commandMeta(
        {
          method: 'POST',
          originalUrl: '/synthetic-demo-seed',
          body: value,
          headers: {
            'if-match': String(version),
            'idempotency-key': randomUUID(),
          },
        },
        value,
      );
    const draft = await finance.create(
      actor(false),
      center.id,
      body,
      meta(listing.revision, body),
    );
    await finance.approve(
      actor(true),
      center.id,
      draft.id,
      body,
      meta(draft.version, body),
    );
  }
  const profile = await db
    .getRepository(CustomerProfile)
    .findOneByOrFail({ iamUserId: customerIdForPhone('9876543210') });
  let customer = await db
    .getRepository(Customer)
    .findOneBy({ serviceCenterId: center.id, customerProfileId: profile.id });
  if (!customer)
    customer = await db.getRepository(Customer).save({
      serviceCenterId: center.id,
      customerProfileId: profile.id,
      name: 'Synthetic Demo Customer',
      phone: '+919876543210',
      phoneCanonical: '+919876543210',
      revision: 1,
    });
  let vehicle = await db
    .getRepository(Vehicle)
    .findOneBy({ serviceCenterId: center.id, customerId: customer.id });
  if (!vehicle)
    vehicle = await db.getRepository(Vehicle).save({
      serviceCenterId: center.id,
      customerId: customer.id,
      registrationNumber: 'KA01DE0001',
      registrationCanonical: 'KA01DE0001',
      makeModel: 'Synthetic Demo Scooter',
      vehicleType: VehicleType.TWO_WHEELER,
      revision: 1,
    });
  // Restart preserves issued documents, payments and completed jobs.
  for (const [index, jobNumber] of [
    'JC-AF019-DEMO-01',
    'JC-AF019-DEMO-02',
    'JC-AF019-CHECK-01',
  ].entries()) {
    if (await db.getRepository(ServiceJob).existsBy({ jobNumber })) continue;
    await db.transaction(async (manager) => {
      const job = await manager.getRepository(ServiceJob).save({
        jobNumber,
        serviceCenterId: center.id,
        customerId: customer.id,
        vehicleId: vehicle.id,
        billingCustomerProfileId: profile.id,
        status: JobStatus.READY_FOR_PICKUP,
        publicToken: randomBytes(32).toString('base64url'),
        serviceType: 'SYNTHETIC invoice demo',
        intakeSnapshot: {
          customerName: 'Synthetic Demo Customer',
          customerPhone: '+919876543210',
          vehicleRegistration: vehicle.registrationNumber,
          vehicleLabel: vehicle.makeModel,
          garageVehicleId: null,
        },
      });
      await manager.getRepository(JobCustomerAccess).save({
        jobId: job.id,
        customerProfileId: profile.id,
        source: 'WALK_IN',
        customerRevision: customer.revision,
      });
      await manager.getRepository(JobLineItem).save({
        jobId: job.id,
        serviceCenterId: center.id,
        kind: JobLineKind.LABOUR,
        billingSourceKind: index === 1 ? 'PACKAGE' : 'LABOUR',
        description:
          index === 1
            ? 'Synthetic basic service package'
            : 'Synthetic approved labour',
        quantity: '1.00',
        unitPriceInr: '1000.00',
        amountInr: '1000.00',
        status: JobLineStatus.INCLUDED,
        scope: [],
      });
      if (index === 0)
        await manager.getRepository(JobLineItem).save({
          jobId: job.id,
          serviceCenterId: center.id,
          kind: JobLineKind.PART,
          billingSourceKind: 'PART',
          description: 'Synthetic replacement part (tax included)',
          quantity: '1.00',
          unitPriceInr: '118.00',
          amountInr: '118.00',
          status: JobLineStatus.INCLUDED,
          scope: [],
        });
    });
  }
  console.log(
    'SYNTHETIC INVOICE DEMO ONLY. Manager 9845000001; customer 9876543210. Private synthetic PDFs only; no real tax documents.',
  );
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
