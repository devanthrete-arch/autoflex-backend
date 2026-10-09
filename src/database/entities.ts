import { BookingAttachment } from '../modules/bookings/entities/booking-attachment.entity';
import { BookingItem } from '../modules/bookings/entities/booking-item.entity';
import { Booking } from '../modules/bookings/entities/booking.entity';
import { Invoice } from '../modules/billing/entities/invoice.entity';
import { InvoiceLineItem } from '../modules/billing/entities/invoice-line-item.entity';
import { Payment } from '../modules/billing/entities/payment.entity';
import { MaintenanceItem } from '../modules/maintenance/maintenance-item.entity';
import { CustomerNotification } from '../modules/notifications/entities/customer-notification.entity';
import { NotificationDelivery } from '../modules/notifications/entities/notification-delivery.entity';
import { SupportRequest } from '../modules/support/support-request.entity';
import { VaultDocument } from '../modules/vault/vault-document.entity';
import { Customer } from '../modules/customers/entities/customer.entity';
import { CustomerAddress } from '../modules/customers/entities/customer-address.entity';
import { CustomerProfile } from '../modules/customers/entities/customer-profile.entity';
import { GarageVehicle } from '../modules/customers/entities/garage-vehicle.entity';
import { Vehicle } from '../modules/customers/entities/vehicle.entity';
import { AuditLog } from '../modules/events/entities/audit-log.entity';
import { ServiceJobEvent } from '../modules/events/entities/service-job-event.entity';
import { CommandIdempotency } from '../modules/idempotency/command-idempotency.entity';
import { JobApproval } from '../modules/jobs/entities/job-approval.entity';
import { JobAssignment } from '../modules/jobs/entities/job-assignment.entity';
import { JobLineItem } from '../modules/jobs/entities/job-line-item.entity';
import { JobMedia } from '../modules/jobs/entities/job-media.entity';
import { ServiceJob } from '../modules/jobs/entities/service-job.entity';
import { Promotion } from '../modules/marketplace/entities/promotion.entity';
import {
  ServiceCategory,
  ServiceCenterCategory,
} from '../modules/marketplace/entities/service-category.entity';
import { ServiceOffering } from '../modules/offerings/entities/service-offering.entity';
import { OperatingHour } from '../modules/tenancy/entities/operating-hour.entity';
import { ServiceCenter } from '../modules/tenancy/entities/service-center.entity';
import { StaffProfile } from '../modules/tenancy/entities/staff-profile.entity';
import {
  VehicleCatalogColour,
  VehicleCatalogConfiguration,
  VehicleCatalogGeneration,
  VehicleCatalogMake,
  VehicleCatalogModel,
  VehicleCatalogPhase,
  VehicleCatalogPowertrain,
} from '../modules/vehicle-catalog/vehicle-catalog.entity';

/** Explicit entity list for data sources that cannot glob (pg-mem, tests). */
export const ENTITIES = [
  ServiceCenter,
  StaffProfile,
  OperatingHour,
  Customer,
  Vehicle,
  CustomerProfile,
  GarageVehicle,
  CustomerAddress,
  ServiceJob,
  ServiceJobEvent,
  AuditLog,
  JobAssignment,
  JobLineItem,
  JobApproval,
  JobMedia,
  CommandIdempotency,
  ServiceCategory,
  ServiceCenterCategory,
  Promotion,
  ServiceOffering,
  Booking,
  BookingItem,
  BookingAttachment,
  Invoice,
  InvoiceLineItem,
  Payment,
  VaultDocument,
  MaintenanceItem,
  CustomerNotification,
  NotificationDelivery,
  SupportRequest,
  VehicleCatalogMake,
  VehicleCatalogModel,
  VehicleCatalogGeneration,
  VehicleCatalogPhase,
  VehicleCatalogConfiguration,
  VehicleCatalogPowertrain,
  VehicleCatalogColour,
];
