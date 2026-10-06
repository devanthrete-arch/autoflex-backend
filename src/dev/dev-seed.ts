import { DataSource } from 'typeorm';
import { ServiceCenterStatus } from '../common/enums/service-center-status.enum';
import { VehicleType } from '../common/enums/vehicle-type.enum';
import { addDays, istInstant, istToday } from '../common/time/ist';
import {
  ServiceCategory,
  ServiceCenterCategory,
} from '../modules/marketplace/entities/service-category.entity';
import { ServiceOffering } from '../modules/offerings/entities/service-offering.entity';
import { ServiceCenter } from '../modules/tenancy/entities/service-center.entity';
import { DEV_CENTER_DOMAINS, DEV_CUSTOMER } from './dev-personas';
import { bootstrapWorkshop } from './workshop-bootstrap';

const TWO = VehicleType.TWO_WHEELER;
const FOUR = VehicleType.FOUR_WHEELER;

type Json = Record<string, unknown>;
type Api = (
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) => Promise<Json>;

export interface SeedTokens {
  customer: string;
  manager: string;
  advisor: string;
  technician: string;
  technician2: string;
}

export interface SeedSummary {
  apexCenterId: string;
  jobs: Record<string, string>;
}

/**
 * Extra centers for the throwaway memory runtime. Apex itself comes from
 * `bootstrapWorkshop`, which is also the durable workshop.
 */
async function seedMemoryNeighborCenters(
  dataSource: DataSource,
): Promise<void> {
  const centers = dataSource.getRepository(ServiceCenter);
  const categoryRepo = dataSource.getRepository(ServiceCategory);
  const links = dataSource.getRepository(ServiceCenterCategory);
  const offerings = dataSource.getRepository(ServiceOffering);
  const categories = new Map(
    (await categoryRepo.find()).map((category) => [category.slug, category]),
  );

  const ensureCenter = async (
    iamDomainId: string,
    values: Partial<ServiceCenter>,
  ) => {
    const existing = await centers.findOne({ where: { iamDomainId } });
    if (existing) return existing;
    return centers.save(
      centers.create({
        iamDomainId,
        status: ServiceCenterStatus.ACTIVE,
        bookingEnabled: true,
        ...values,
      }),
    );
  };

  const speedline = await ensureCenter(DEV_CENTER_DOMAINS.speedline, {
    name: 'Speedline Two-Wheeler Care',
    displayName: 'Speedline Two-Wheeler Care',
    slug: 'speedline-indiranagar',
    publicPhone: '+918041239876',
    addressLine1: '100 Feet Road, HAL 2nd Stage',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560038',
    formattedAddress: '100 Feet Road, Indiranagar, Bengaluru, KA 560038',
    latitude: 12.9784,
    longitude: 77.6408,
    ratingAvg: '4.60',
    ratingCount: 87,
    supportedVehicleTypes: [TWO],
    autoAccept: true,
    slotCapacity: 2,
    hoursStart: '08:30',
    hoursEnd: '20:00',
    upiVpa: 'speedline@okicici',
  });
  const clinic = await ensureCenter(DEV_CENTER_DOMAINS.clinic, {
    name: 'Koramangala Car Clinic',
    displayName: 'Koramangala Car Clinic',
    slug: 'koramangala-car-clinic',
    publicPhone: '+918041235555',
    addressLine1: '80 Feet Road, 4th Block',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560034',
    formattedAddress: '80 Feet Road, Koramangala, Bengaluru, KA 560034',
    latitude: 12.9352,
    longitude: 77.6245,
    ratingAvg: '4.70',
    ratingCount: 143,
    supportedVehicleTypes: [FOUR],
    autoAccept: true,
    slotCapacity: 2,
    hoursStart: '09:30',
    hoursEnd: '18:30',
  });

  const menus: [
    ServiceCenter,
    string,
    string,
    VehicleType | null,
    number,
    number,
    boolean?,
  ][] = [
    [speedline, 'periodic-service', 'Standard service', TWO, 1199, 90],
    [speedline, 'oil-change', 'Oil change', TWO, 599, 30],
    [speedline, 'tyre', 'Puncture repair', TWO, 149, 20, true],
    [clinic, 'car-service', 'Comprehensive car service', FOUR, 4499, 240],
    [clinic, 'brakes', 'Brake pad replacement', FOUR, 2499, 90, true],
    [clinic, 'wash', 'Interior deep clean', FOUR, 1499, 120],
  ];
  for (const [
    index,
    [center, slug, name, vehicleType, price, minutes, starting],
  ] of menus.entries()) {
    const category = categories.get(slug);
    if (!category) {
      throw new Error(`Missing workshop category ${slug}`);
    }
    const existing = await offerings.findOne({
      where: { serviceCenterId: center.id, name },
    });
    if (!existing) {
      await offerings.save(
        offerings.create({
          serviceCenterId: center.id,
          categoryId: category.id,
          name,
          vehicleType,
          priceInr: price.toFixed(2),
          priceIsStarting: starting ?? false,
          durationMinutes: minutes,
          isActive: true,
          sortOrder: index,
        }),
      );
    }
    const linked = await links.findOne({
      where: { serviceCenterId: center.id, categoryId: category.id },
    });
    if (!linked) {
      await links.save(
        links.create({ serviceCenterId: center.id, categoryId: category.id }),
      );
    }
  }
}

function slot(date: string, hour: number) {
  return {
    slotStart: istInstant(date, hour * 60).toISOString(),
    slotEnd: istInstant(date, hour * 60 + 60).toISOString(),
  };
}

/**
 * Seeds a realistic morning at Apex Auto Garage through the public API, so
 * every record passes the same rules as real use.
 */
export async function seedDevData(
  dataSource: DataSource,
  baseUrl: string,
  tokens: SeedTokens,
): Promise<SeedSummary> {
  const apex = await bootstrapWorkshop(dataSource);
  await seedMemoryNeighborCenters(dataSource);

  const client =
    (token: string): Api =>
    async (method, path, body, headers = {}) => {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Seed ${method} ${path} → ${res.status}: ${text}`);
      }
      return (text ? JSON.parse(text) : {}) as Json;
    };
  const customer = client(tokens.customer);
  const manager = client(tokens.manager);
  const tech = client(tokens.technician);

  const staff = (await manager('GET', '/v1/staff')) as unknown as {
    id: string;
    displayName: string;
  }[];
  const staffId = (name: string) =>
    staff.find((s) => s.displayName === name)!.id;
  const offerings = (await manager(
    'GET',
    '/v1/center/offerings',
  )) as unknown as {
    id: string;
    name: string;
  }[];
  const offering = (name: string) => offerings.find((o) => o.name === name)!.id;

  /** Runs a job command against the latest version. */
  const jobCommand = async (
    api: Api,
    jobId: string,
    method: string,
    path: string,
    body?: unknown,
  ) => {
    const job = await manager('GET', `/v1/jobs/${jobId}`);
    return api(method, `/v1/jobs/${jobId}${path}`, body, {
      'If-Match': String(job.version),
    });
  };

  await customer('PUT', '/v1/me/profile', {
    displayName: DEV_CUSTOMER.name,
    email: 'priya.sharma@example.com',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560008',
    selectedPlaceLabel: 'Indiranagar, Bengaluru',
    preferredChannel: 'WHATSAPP',
    whatsappConsent: true,
    serviceUpdates: true,
    maintenanceReminders: true,
    documentReminders: true,
  });
  const garage = (await customer('GET', '/v1/me/vehicles')) as unknown as {
    id: string;
    registrationNumber: string;
  }[];
  const plate = (registrationNumber: string) => {
    const vehicle = garage.find(
      (item) => item.registrationNumber === registrationNumber,
    );
    if (!vehicle) {
      throw new Error(
        `Workshop bootstrap did not create garage vehicle ${registrationNumber}`,
      );
    }
    return vehicle;
  };
  const activa = plate('KA01AB1234');
  const i20 = plate('KA03MN4567');

  const today = istToday();
  const tomorrow = addDays(today, 1);
  const jobs: Record<string, string> = {};

  // A finished car service: bill paid by UPI.
  const past = await customer('POST', '/v1/bookings', {
    serviceCenterId: apex.id,
    vehicleId: i20.id,
    mode: 'SELF_CHECKIN',
    offeringIds: [offering('Car general service')],
    issueDescription: 'Annual service, AC not cooling well',
    ...slot(tomorrow, 12),
  });
  await manager('POST', `/v1/center/bookings/${past.id as string}/confirm`);
  const pastIn = await manager(
    'POST',
    `/v1/center/bookings/${past.id as string}/check-in`,
    {
      odometerKm: 32150,
      fuelLevel: 'Half',
      assignedTechnicianId: staffId('Sana Sheikh'),
    },
  );
  const pastJob = (pastIn.job as Json).id as string;
  jobs.completed = pastJob;
  await jobCommand(manager, pastJob, 'PUT', '/inspection', {
    items: [
      { key: 'ac', label: 'AC cooling', ok: false, note: 'Low gas' },
      { key: 'brakes', label: 'Brakes', ok: true },
      { key: 'tyres', label: 'Tyres', ok: true },
    ],
    complete: true,
  });
  const acAsk = await jobCommand(manager, pastJob, 'POST', '/approvals', {
    note: 'AC gas is low; top-up restores cooling',
    items: [
      { kind: 'LABOUR', description: 'AC gas top-up', unitPriceInr: 1200 },
    ],
  });
  await customer(
    'POST',
    `/v1/me/jobs/${pastJob}/approvals/${acAsk.pendingApprovalId as string}/decision`,
    { approved: true },
  );
  await jobCommand(manager, pastJob, 'PATCH', '/status', {
    status: 'QUALITY_CHECK',
  });
  await jobCommand(manager, pastJob, 'POST', '/qc', { passed: true });
  await jobCommand(manager, pastJob, 'POST', '/close', {
    finalAmountInr: 5100,
    adjustmentReason: 'DISCOUNT',
    adjustmentNote: 'Loyalty discount',
    payment: { method: 'UPI', amountInr: 5100, reference: 'UPI-DEV-0001' },
    finalNotes: 'Next service due at 42,000 km or in 12 months',
  });

  // The Activa is in the workshop and waiting on Priya's approval.
  const visit = await customer('POST', '/v1/bookings', {
    serviceCenterId: apex.id,
    vehicleId: activa.id,
    mode: 'SELF_CHECKIN',
    offeringIds: [
      offering('Periodic service'),
      offering('Foam wash and polish'),
    ],
    issueDescription: 'Brake squeal at low speed',
    ...slot(tomorrow, 10),
  });
  await manager('POST', `/v1/center/bookings/${visit.id as string}/confirm`);
  const visitIn = await manager(
    'POST',
    `/v1/center/bookings/${visit.id as string}/check-in`,
    {
      odometerKm: 8420,
      fuelLevel: 'Quarter',
      accessoriesChecklist: { helmet: true, documents: false },
      assignedTechnicianId: staffId('Ravi Kumar'),
    },
  );
  const activeJob = (visitIn.job as Json).id as string;
  jobs.awaitingApproval = activeJob;
  await jobCommand(tech, activeJob, 'PUT', '/inspection', {
    items: [
      { key: 'brakes', label: 'Brakes', ok: false, note: 'Front pads at 2 mm' },
      { key: 'lights', label: 'Lights', ok: true },
      { key: 'tyres', label: 'Tyres', ok: true },
      { key: 'battery', label: 'Battery', ok: true },
    ],
    complete: true,
  });
  await tech('POST', `/v1/jobs/${activeJob}/notes`, {
    message: 'Inspection done; front pads need replacing',
    visibleToCustomer: true,
  });
  await jobCommand(manager, activeJob, 'POST', '/approvals', {
    note: 'Front pads are worn below the safe limit',
    items: [
      {
        kind: 'PART',
        description: 'Front brake pads',
        partType: 'OEM',
        unitPriceInr: 850,
      },
      { kind: 'LABOUR', description: 'Brake pad fitting', unitPriceInr: 200 },
    ],
  });

  // A request still waiting for the center to accept.
  await customer('POST', '/v1/bookings', {
    serviceCenterId: apex.id,
    vehicleId: i20.id,
    mode: 'SELF_CHECKIN',
    offeringIds: [offering('Wheel alignment and balancing')],
    issueDescription: 'Car pulls to the left',
    ...slot(addDays(today, 2), 11),
  });

  // Walk-ins on the floor.
  const enfield = await manager('POST', '/v1/jobs', {
    customerPhone: '+919812345678',
    customerName: 'Rahul Verma',
    vehicleRegistration: 'KA05XY9876',
    vehicleMakeModel: 'Royal Enfield Classic 350',
    vehicleType: TWO,
    serviceType: 'General service',
    odometerKm: 15400,
    customerRequest: 'Engine feels rough at idle',
    assignedTechnicianId: staffId('Ravi Kumar'),
  });
  jobs.inProgress = enfield.id as string;
  await jobCommand(manager, jobs.inProgress, 'POST', '/line-items', {
    kind: 'LABOUR',
    description: 'General service',
    unitPriceInr: 1299,
  });
  await jobCommand(tech, jobs.inProgress, 'PUT', '/inspection', {
    items: [
      {
        key: 'spark_plug',
        label: 'Spark plug',
        ok: false,
        note: 'Carbon build-up',
      },
      { key: 'chain', label: 'Chain', ok: true },
    ],
    complete: true,
  });
  await jobCommand(tech, jobs.inProgress, 'PATCH', '/status', {
    status: 'IN_PROGRESS',
  });

  const jupiter = await manager('POST', '/v1/jobs', {
    customerPhone: '+919900112233',
    customerName: 'Ananya Reddy',
    vehicleRegistration: 'KA51CD2468',
    vehicleMakeModel: 'TVS Jupiter',
    vehicleType: TWO,
    serviceType: 'Oil change',
    odometerKm: 6100,
    waitingOnSite: true,
    assignedTechnicianId: staffId('Sana Sheikh'),
  });
  jobs.readyForPickup = jupiter.id as string;
  await jobCommand(manager, jobs.readyForPickup, 'POST', '/line-items', {
    kind: 'LABOUR',
    description: 'Engine oil change',
    unitPriceInr: 699,
  });
  await jobCommand(manager, jobs.readyForPickup, 'POST', '/skip', {
    step: 'INSPECTION',
    reason: 'Oil change only',
  });
  await jobCommand(manager, jobs.readyForPickup, 'POST', '/skip', {
    step: 'QC',
    reason: 'Oil change only',
  });

  const fresh = await manager('POST', '/v1/jobs', {
    customerPhone: '+919845112244',
    customerName: 'Karthik N',
    vehicleRegistration: 'KA02EF1357',
    vehicleMakeModel: 'Bajaj Pulsar 150',
    vehicleType: TWO,
    serviceType: 'Brake inspection',
    customerRequest: 'Rear brake feels spongy',
    odometerKm: 21980,
  });
  jobs.checkedIn = fresh.id as string;

  // Papers and reminders in Priya's garage.
  await customer('POST', '/v1/me/documents', {
    category: 'RC',
    title: 'Registration certificate',
    vehicleId: activa.id,
    documentNumber: 'KA01AB1234',
    issuer: 'RTO Bengaluru Central',
    issueDate: '2022-03-14',
  });
  await customer('POST', '/v1/me/documents', {
    category: 'INSURANCE',
    title: 'Two-wheeler insurance',
    vehicleId: activa.id,
    documentNumber: 'ACKO-2W-88123',
    issuer: 'Acko General Insurance',
    issueDate: addDays(today, -345),
    expiryDate: addDays(today, 20),
  });
  await customer('POST', '/v1/me/documents', {
    category: 'PUC',
    title: 'Pollution certificate',
    vehicleId: i20.id,
    documentNumber: 'PUC-KA03-55120',
    expiryDate: addDays(today, -5),
  });
  await customer('POST', '/v1/me/documents', {
    category: 'DRIVING_LICENCE',
    title: 'Driving licence',
    documentNumber: 'KA0120180012345',
    issuer: 'RTO Bengaluru Central',
    expiryDate: addDays(today, 365 * 3),
  });
  await customer('POST', '/v1/me/maintenance', {
    vehicleId: activa.id,
    title: 'Engine oil change',
    dueDate: addDays(today, 25),
    dueOdometerKm: 9000,
    intervalMonths: 6,
    intervalKm: 3000,
  });
  await customer('POST', '/v1/me/maintenance', {
    vehicleId: i20.id,
    title: 'Wheel alignment',
    dueDate: addDays(today, 60),
    intervalMonths: 6,
  });
  await customer('POST', '/v1/me/maintenance', {
    vehicleId: i20.id,
    title: 'Battery health check',
    dueDate: addDays(today, 7),
  });

  return { apexCenterId: apex.id, jobs };
}
