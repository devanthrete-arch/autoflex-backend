import { createHash } from 'crypto';
import { StaffDesignation } from '../common/enums/staff-designation.enum';

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

export const DEV_CUSTOMER = { phone: '9876543210', name: 'Priya Sharma' };

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
