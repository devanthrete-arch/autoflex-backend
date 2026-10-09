import { createHash } from 'crypto';
import { StaffDesignation } from '../common/enums/staff-designation.enum';
import { VehicleType } from '../common/enums/vehicle-type.enum';

/** Local stand-ins for Frevels IAM ids. Never used outside the dev runtime. */
export const DEV_CUSTOMER_APP_ID = 'dev-customer-app';
export const DEV_STAFF_APP_ID = 'dev-service-center-app';
export const DEV_CUSTOMER_DOMAIN_ID = 'dev-customer-domain';

export const DEV_CENTER_DOMAINS = {
  apex: 'a0000000-0000-4000-8000-000000000001',
  speedline: 'a0000000-0000-4000-8000-000000000002',
  clinic: 'a0000000-0000-4000-8000-000000000003',
} as const;

const DESK = [
  'jobs:create',
  'jobs:read',
  'jobs:update',
  'bookings:read',
  'bookings:manage',
  'staff:read',
  'billing:manage',
];

export interface StaffPersona {
  key: string;
  iamUserId: string;
  displayName: string;
  designation: StaffDesignation;
  role: 'admin' | 'manager' | 'advisor' | 'technician';
  permissions: string[];
  mobile: string;
}

export const STAFF_PERSONAS: StaffPersona[] = [
  {
    key: 'manager',
    iamUserId: 'b0000000-0000-4000-8000-000000000001',
    displayName: 'Meera Iyer',
    designation: StaffDesignation.MANAGER,
    role: 'manager',
    permissions: [
      ...DESK,
      'center:manage',
      'staff:manage',
      'approvals:override',
    ],
    mobile: '9845000001',
  },
  {
    key: 'advisor',
    iamUserId: 'b0000000-0000-4000-8000-000000000002',
    displayName: 'Arjun Rao',
    designation: StaffDesignation.ADVISOR,
    role: 'advisor',
    permissions: DESK,
    mobile: '9845000002',
  },
  {
    key: 'technician',
    iamUserId: 'b0000000-0000-4000-8000-000000000003',
    displayName: 'Ravi Kumar',
    designation: StaffDesignation.TECHNICIAN,
    role: 'technician',
    permissions: ['jobs:read', 'jobs:update'],
    mobile: '9845000003',
  },
  {
    key: 'technician2',
    iamUserId: 'b0000000-0000-4000-8000-000000000004',
    displayName: 'Sana Sheikh',
    designation: StaffDesignation.TECHNICIAN,
    role: 'technician',
    permissions: ['jobs:read', 'jobs:update'],
    mobile: '9845000004',
  },
];

/** The one service center the durable workshop and the memory runtime share. */
export const WORKSHOP_CENTER = {
  iamDomainId: DEV_CENTER_DOMAINS.apex,
  name: 'Apex Auto Garage',
  slug: 'apex-auto-garage',
} as const;

export interface WorkshopVehicle {
  vehicleType: VehicleType;
  make: string;
  model: string;
  variant: string | null;
  year: number;
  color: string;
  fuel: string;
  transmission: string | null;
  registrationNumber: string;
  currentOdometerKm: number;
}

export interface WorkshopCustomer {
  phone: string;
  name: string;
  email: string;
  city: string;
  state: string;
  postalCode: string;
  selectedPlaceLabel: string;
  dateOfBirth: string;
  lastLat: number;
  lastLng: number;
  address: {
    label: string;
    line1: string;
    landmark: string | null;
    city: string;
    state: string;
    postalCode: string;
  };
  vehicles: WorkshopVehicle[];
}

const TWO = VehicleType.TWO_WHEELER;
const FOUR = VehicleType.FOUR_WHEELER;

/** Fixed customers. Phones are the stable sign-in ids; reruns update these rows. */
export const WORKSHOP_CUSTOMERS: WorkshopCustomer[] = [
  {
    phone: '9876543210',
    name: 'Priya Sharma',
    email: 'priya.sharma@example.com',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560008',
    dateOfBirth: '1994-03-12',
    selectedPlaceLabel: 'Indiranagar, Bengaluru',
    lastLat: 12.9784,
    lastLng: 77.6408,
    address: {
      label: 'Home',
      line1: '42, 5th Cross, HAL 3rd Stage',
      landmark: 'Opposite Indiranagar Club',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560008',
    },
    vehicles: [
      {
        vehicleType: TWO,
        make: 'Honda',
        model: 'Activa 6G',
        variant: null,
        year: 2022,
        color: 'Pearl Blue',
        fuel: 'Petrol',
        transmission: null,
        registrationNumber: 'KA01AB1234',
        currentOdometerKm: 8200,
      },
      {
        vehicleType: FOUR,
        make: 'Hyundai',
        model: 'i20',
        variant: 'Asta',
        year: 2021,
        color: 'Polar White',
        fuel: 'Petrol',
        transmission: 'Manual',
        registrationNumber: 'KA03MN4567',
        currentOdometerKm: 32100,
      },
    ],
  },
  {
    phone: '9845123450',
    name: 'Nikhil Menon',
    email: 'nikhil.menon@example.com',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560034',
    dateOfBirth: '1988-11-02',
    selectedPlaceLabel: 'Koramangala, Bengaluru',
    lastLat: 12.9352,
    lastLng: 77.6245,
    address: {
      label: 'Home',
      line1: '18, 4th Block, 80 Feet Road',
      landmark: 'Near Sony Signal',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560034',
    },
    vehicles: [
      {
        vehicleType: TWO,
        make: 'Royal Enfield',
        model: 'Classic 350',
        variant: null,
        year: 2020,
        color: 'Stealth Black',
        fuel: 'Petrol',
        transmission: null,
        registrationNumber: 'KA05RE2201',
        currentOdometerKm: 18640,
      },
    ],
  },
  {
    phone: '9900887766',
    name: 'Aisha Khan',
    email: 'aisha.khan@example.com',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560041',
    dateOfBirth: '1997-07-21',
    selectedPlaceLabel: 'Jayanagar, Bengaluru',
    lastLat: 12.9308,
    lastLng: 77.5838,
    address: {
      label: 'Home',
      line1: '7, 9th Main, 4th Block Jayanagar',
      landmark: 'Opposite Jayanagar Shopping Complex',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560041',
    },
    vehicles: [
      {
        vehicleType: FOUR,
        make: 'Maruti Suzuki',
        model: 'Swift',
        variant: 'ZXi',
        year: 2019,
        color: 'Fire Red',
        fuel: 'Petrol',
        transmission: 'Manual',
        registrationNumber: 'KA02SW4410',
        currentOdometerKm: 41220,
      },
    ],
  },
];

/** Default customer sign-in. Same person as the first workshop customer. */
export const DEV_CUSTOMER = {
  phone: WORKSHOP_CUSTOMERS[0].phone,
  name: WORKSHOP_CUSTOMERS[0].name,
};

export function staffByPhone(phone: string): StaffPersona | undefined {
  const digits = phone.replace(/\D/g, '').slice(-10);
  return STAFF_PERSONAS.find((persona) => persona.mobile === digits);
}

export function workshopCustomerByPhone(
  phone: string,
): WorkshopCustomer | undefined {
  const digits = phone.replace(/\D/g, '');
  const local = digits.length >= 10 ? digits.slice(-10) : digits;
  return WORKSHOP_CUSTOMERS.find((customer) => customer.phone === local);
}

/** The same phone always maps to the same customer id, like an IAM account. */
export function customerIdForPhone(phone: string): string {
  const hex = createHash('sha1').update(`autoflex-dev:${phone}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

export const DEV_SUPPORT_APP_ID = 'dev-support-app';
export const DEV_SUPPORT_DOMAIN_ID = 'dev-support-domain';
export const SUPPORT_PERSONAS = [
  {
    key: 'support-agent',
    iamUserId: 'd0000000-0000-4000-8000-000000000001',
    displayName: 'Neha Patel',
    mobile: '9845000011',
    role: 'support_agent',
    permissions: ['support:read', 'support:work'],
  },
  {
    key: 'support-agent2',
    iamUserId: 'd0000000-0000-4000-8000-000000000002',
    displayName: 'Kabir Das',
    mobile: '9845000012',
    role: 'support_agent',
    permissions: ['support:read', 'support:work'],
  },
  {
    key: 'support-manager',
    iamUserId: 'd0000000-0000-4000-8000-000000000003',
    displayName: 'Ananya Rao',
    mobile: '9845000013',
    role: 'support_manager',
    permissions: ['support:read', 'support:work', 'support:manage'],
  },
] as const;
