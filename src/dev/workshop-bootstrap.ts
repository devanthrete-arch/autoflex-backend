import { SupportAgentProfile } from '../modules/support-identity/support-agent-profile.entity';
import { DEV_SUPPORT_DOMAIN_ID, SUPPORT_PERSONAS } from './dev-personas';
import { DataSource } from 'typeorm';
import { CommunicationChannel } from '../common/enums/communication-channel.enum';
import { GarageVehicleStatus } from '../common/enums/garage-vehicle-status.enum';
import { PromotionScope } from '../common/enums/promotion-scope.enum';
import { ServiceCenterStatus } from '../common/enums/service-center-status.enum';
import { VehicleType } from '../common/enums/vehicle-type.enum';
import { CustomerAddress } from '../modules/customers/entities/customer-address.entity';
import { CustomerProfile } from '../modules/customers/entities/customer-profile.entity';
import { GarageVehicle } from '../modules/customers/entities/garage-vehicle.entity';
import { Promotion } from '../modules/marketplace/entities/promotion.entity';
import {
  ServiceCategory,
  ServiceCenterCategory,
} from '../modules/marketplace/entities/service-category.entity';
import { ServiceOffering } from '../modules/offerings/entities/service-offering.entity';
import { OperatingHour } from '../modules/tenancy/entities/operating-hour.entity';
import { ServiceCenter } from '../modules/tenancy/entities/service-center.entity';
import { StaffProfile } from '../modules/tenancy/entities/staff-profile.entity';
import { VehicleCatalogImporter } from '../modules/vehicle-catalog/vehicle-catalog.importer';
import {
  customerIdForPhone,
  STAFF_PERSONAS,
  WORKSHOP_CENTER,
  WORKSHOP_CUSTOMERS,
  WorkshopCustomer,
  WorkshopVehicle,
} from './dev-personas';

const TWO = VehicleType.TWO_WHEELER;
const FOUR = VehicleType.FOUR_WHEELER;

const CATEGORIES: {
  slug: string;
  name: string;
  iconKey: string;
  vehicleType: VehicleType | null;
}[] = [
  {
    slug: 'periodic-service',
    name: 'Periodic service',
    iconKey: 'wrench',
    vehicleType: TWO,
  },
  { slug: 'oil-change', name: 'Oil change', iconKey: 'oil', vehicleType: TWO },
  { slug: 'brakes', name: 'Brakes', iconKey: 'brake', vehicleType: null },
  { slug: 'tyre', name: 'Tyres', iconKey: 'tyre', vehicleType: null },
  {
    slug: 'car-service',
    name: 'Car service',
    iconKey: 'car',
    vehicleType: FOUR,
  },
  {
    slug: 'wash',
    name: 'Wash and detailing',
    iconKey: 'wash',
    vehicleType: null,
  },
];

const MENU: {
  slug: string;
  name: string;
  vehicleType: VehicleType | null;
  price: number;
  minutes: number;
  starting?: boolean;
}[] = [
  {
    slug: 'periodic-service',
    name: 'Periodic service',
    vehicleType: TWO,
    price: 1499,
    minutes: 90,
  },
  {
    slug: 'oil-change',
    name: 'Engine oil change',
    vehicleType: TWO,
    price: 699,
    minutes: 30,
  },
  {
    slug: 'brakes',
    name: 'Brake inspection and adjustment',
    vehicleType: null,
    price: 499,
    minutes: 45,
  },
  {
    slug: 'car-service',
    name: 'Car general service',
    vehicleType: FOUR,
    price: 3999,
    minutes: 180,
  },
  {
    slug: 'wash',
    name: 'Foam wash and polish',
    vehicleType: null,
    price: 399,
    minutes: 40,
  },
  {
    slug: 'tyre',
    name: 'Wheel alignment and balancing',
    vehicleType: FOUR,
    price: 899,
    minutes: 60,
  },
];

export async function assertWorkshopSchema(
  dataSource: DataSource,
): Promise<void> {
  const rows: { present: string | null }[] = await dataSource.query(
    `SELECT to_regclass('public.service_centers') AS present`,
  );
  if (!rows[0]?.present) {
    throw new Error(
      'Postgres has no Autoflex schema. Run `npm run migration:run` before starting the workshop.',
    );
  }
}

/**
 * Upserts Apex Auto Garage, its menu, the fixed staff roster, and the
 * workshop customers with their vehicles. Bookings, jobs, and documents are
 * left untouched. Safe to run on every API start.
 *
 * `start:memory` calls this for the same people, then adds throwaway
 * neighbor centers and a scripted morning of jobs.
 */
export async function bootstrapWorkshop(
  dataSource: DataSource,
): Promise<ServiceCenter> {
  await new VehicleCatalogImporter(dataSource).importFromSeed();
  const categories = await upsertCategories(dataSource);
  const center = await upsertCenter(dataSource);
  await upsertHours(dataSource, center.id);
  await upsertMenu(dataSource, center.id, categories);
  await upsertStaff(dataSource, center.id);
  const support = dataSource.getRepository(SupportAgentProfile);
  for (const persona of SUPPORT_PERSONAS) {
    // A rerun never reactivates an operator or touches existing queue work.
    await support
      .createQueryBuilder()
      .insert()
      .values({
        iamDomainId: DEV_SUPPORT_DOMAIN_ID,
        iamUserId: persona.iamUserId,
        displayName: persona.displayName,
        isActive: true,
      })
      .orIgnore()
      .execute();
  }
  await upsertPromotions(dataSource, center.id);
  for (const customer of WORKSHOP_CUSTOMERS) {
    await upsertCustomer(dataSource, customer);
  }
  return center;
}

async function upsertCategories(
  dataSource: DataSource,
): Promise<Map<string, ServiceCategory>> {
  const repo = dataSource.getRepository(ServiceCategory);
  const categories = new Map<string, ServiceCategory>();
  for (const [index, spec] of CATEGORIES.entries()) {
    const existing = await repo.findOne({ where: { slug: spec.slug } });
    const values = { ...spec, sortOrder: index + 1 };
    const saved = existing
      ? await repo.save(Object.assign(existing, values))
      : await repo.save(repo.create(values));
    categories.set(spec.slug, saved);
  }
  return categories;
}

async function upsertCenter(dataSource: DataSource): Promise<ServiceCenter> {
  const repo = dataSource.getRepository(ServiceCenter);
  const existing = await repo.findOne({
    where: { iamDomainId: WORKSHOP_CENTER.iamDomainId },
    withDeleted: true,
  });
  const values: Partial<ServiceCenter> = {
    iamDomainId: WORKSHOP_CENTER.iamDomainId,
    name: WORKSHOP_CENTER.name,
    displayName: WORKSHOP_CENTER.name,
    slug: WORKSHOP_CENTER.slug,
    status: ServiceCenterStatus.ACTIVE,
    publicPhone: '+918041234567',
    gstin: '29ABCDE1234F1Z5',
    addressLine1: '12 MG Road',
    addressLine2: 'Near Trinity Metro',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560001',
    formattedAddress: '12 MG Road, Bengaluru, KA 560001',
    latitude: 12.9716,
    longitude: 77.5946,
    ratingAvg: '4.80',
    ratingCount: 212,
    supportedVehicleTypes: [TWO, FOUR],
    pickupDropEnabled: true,
    autoAccept: false,
    bookingEnabled: true,
    slotCapacity: 3,
    hoursStart: '09:00',
    hoursEnd: '19:00',
    upiVpa: 'apexauto@okhdfcbank',
    expressSkipEnabled: true,
    onboardedAt: existing?.onboardedAt ?? new Date(),
    deletedAt: null,
  };
  if (!existing) {
    return repo.save(repo.create(values));
  }
  return repo.save(Object.assign(existing, values));
}

async function upsertHours(
  dataSource: DataSource,
  serviceCenterId: string,
): Promise<void> {
  const repo = dataSource.getRepository(OperatingHour);
  for (let day = 0; day < 7; day++) {
    const values = {
      serviceCenterId,
      dayOfWeek: day,
      isClosed: false,
      openTime: day === 0 ? '10:00' : '09:00',
      closeTime: day === 0 ? '16:00' : '19:00',
    };
    const existing = await repo.findOne({
      where: { serviceCenterId, dayOfWeek: day },
    });
    if (existing) {
      await repo.save(Object.assign(existing, values));
    } else {
      await repo.save(repo.create(values));
    }
  }
}

async function upsertMenu(
  dataSource: DataSource,
  serviceCenterId: string,
  categories: Map<string, ServiceCategory>,
): Promise<void> {
  const offerings = dataSource.getRepository(ServiceOffering);
  const links = dataSource.getRepository(ServiceCenterCategory);
  for (const [index, item] of MENU.entries()) {
    const category = categories.get(item.slug);
    if (!category) {
      throw new Error(`Missing workshop category ${item.slug}`);
    }
    const values = {
      serviceCenterId,
      categoryId: category.id,
      name: item.name,
      vehicleType: item.vehicleType,
      priceInr: item.price.toFixed(2),
      priceIsStarting: item.starting ?? false,
      durationMinutes: item.minutes,
      isActive: true,
      sortOrder: index,
      deletedAt: null,
    };
    const existing = await offerings.findOne({
      where: { serviceCenterId, name: item.name },
      withDeleted: true,
    });
    if (existing) {
      await offerings.save(Object.assign(existing, values));
    } else {
      await offerings.save(offerings.create(values));
    }
    const linked = await links.findOne({
      where: { serviceCenterId, categoryId: category.id },
    });
    if (!linked) {
      await links.save(
        links.create({ serviceCenterId, categoryId: category.id }),
      );
    }
  }
}

async function upsertStaff(
  dataSource: DataSource,
  serviceCenterId: string,
): Promise<void> {
  const repo = dataSource.getRepository(StaffProfile);
  const joined = ['2023-01-16', '2023-08-01', '2024-02-12', '2024-11-04'];
  for (const [index, persona] of STAFF_PERSONAS.entries()) {
    const values = {
      serviceCenterId,
      iamUserId: persona.iamUserId,
      displayName: persona.displayName,
      designation: persona.designation,
      employeeCode: `APX-${String(index + 1).padStart(3, '0')}`,
      specializations:
        persona.role === 'technician' ? ['Two-wheelers', 'Brakes'] : null,
      joinedAt: joined[index] ?? '2024-01-01',
      isActive: true,
      deletedAt: null,
    };
    const existing = await repo.findOne({
      where: { serviceCenterId, iamUserId: persona.iamUserId },
      withDeleted: true,
    });
    if (existing) {
      await repo.save(Object.assign(existing, values));
    } else {
      await repo.save(repo.create(values));
    }
  }
}

async function upsertPromotions(
  dataSource: DataSource,
  serviceCenterId: string,
): Promise<void> {
  const repo = dataSource.getRepository(Promotion);
  const specs = [
    {
      scope: PromotionScope.PLATFORM,
      kicker: "Today's exclusive deals",
      title: 'Enjoy extra off up to 30%',
      percentOff: 30,
      ctaLabel: 'Claim now',
      serviceCenterId: null as string | null,
      isActive: true,
    },
    {
      scope: PromotionScope.CENTER,
      serviceCenterId,
      kicker: WORKSHOP_CENTER.name,
      title: 'Free wash with every periodic service',
      percentOff: null as number | null,
      ctaLabel: 'Book now',
      isActive: true,
    },
  ];
  for (const spec of specs) {
    const existing = await repo.findOne({ where: { title: spec.title } });
    if (existing) {
      await repo.save(Object.assign(existing, spec));
    } else {
      await repo.save(repo.create(spec));
    }
  }
}

function indiaMobile(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const local =
    digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(local)) {
    throw new Error(`Workshop phone is not an Indian mobile: ${phone}`);
  }
  return `+91${local}`;
}

function plate(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

async function upsertCustomer(
  dataSource: DataSource,
  customer: WorkshopCustomer,
): Promise<void> {
  const profiles = dataSource.getRepository(CustomerProfile);
  const phone = indiaMobile(customer.phone);
  const iamUserId = customerIdForPhone(customer.phone);
  const profileValues = {
    iamUserId,
    displayName: customer.name,
    phone,
    email: customer.email,
    locale: 'en-IN',
    city: customer.city,
    state: customer.state,
    postalCode: customer.postalCode,
    selectedPlaceLabel: customer.selectedPlaceLabel,
    dateOfBirth: customer.dateOfBirth,
    lastLat: customer.lastLat,
    lastLng: customer.lastLng,
    preferredChannel: CommunicationChannel.WHATSAPP,
    whatsappConsent: true,
    emailConsent: false,
    serviceUpdates: true,
    maintenanceReminders: true,
    documentReminders: true,
    deletedAt: null,
  };
  const existing = await profiles.findOne({
    where: { iamUserId },
    withDeleted: true,
  });
  const profile = existing
    ? await profiles.save(Object.assign(existing, profileValues))
    : await profiles.save(profiles.create(profileValues));
  await upsertAddress(dataSource, profile.id, customer, phone);
  for (const vehicle of customer.vehicles) {
    await upsertVehicle(dataSource, profile.id, vehicle);
  }
}

async function upsertAddress(
  dataSource: DataSource,
  customerProfileId: string,
  customer: WorkshopCustomer,
  phone: string,
): Promise<void> {
  const repo = dataSource.getRepository(CustomerAddress);
  const existing = await repo.findOne({
    where: { customerProfileId, label: customer.address.label },
    withDeleted: true,
  });
  const values = {
    customerProfileId,
    label: customer.address.label,
    line1: customer.address.line1,
    landmark: customer.address.landmark,
    city: customer.address.city,
    state: customer.address.state,
    postalCode: customer.address.postalCode,
    contactPhone: phone,
    deletedAt: null,
  };
  if (!existing) {
    await repo.save(repo.create({ ...values, isDefault: true }));
    return;
  }
  await repo.save(Object.assign(existing, values));
}

async function upsertVehicle(
  dataSource: DataSource,
  customerProfileId: string,
  vehicle: WorkshopVehicle,
): Promise<void> {
  const repo = dataSource.getRepository(GarageVehicle);
  const registrationNumber = plate(vehicle.registrationNumber);
  const existing = await repo.findOne({
    where: { customerProfileId, registrationNumber },
    withDeleted: true,
  });
  const values = {
    customerProfileId,
    vehicleType: vehicle.vehicleType,
    make: vehicle.make,
    model: vehicle.model,
    variant: vehicle.variant,
    year: vehicle.year,
    color: vehicle.color,
    fuel: vehicle.fuel,
    transmission: vehicle.transmission,
    registrationNumber,
    status: GarageVehicleStatus.ACTIVE,
    deletedAt: null,
  };
  if (!existing) {
    await repo.save(
      repo.create({
        ...values,
        currentOdometerKm: vehicle.currentOdometerKm,
      }),
    );
    return;
  }
  const odometer = existing.currentOdometerKm ?? vehicle.currentOdometerKm;
  await repo.save(
    Object.assign(existing, { ...values, currentOdometerKm: odometer }),
  );
}
