import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { CenterModule } from './modules/center/center.module';
import { CustomersModule } from './modules/customers/customers.module';
import { EventsModule } from './modules/events/events.module';
import { IdempotencyModule } from './modules/idempotency/idempotency.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OfferingsModule } from './modules/offerings/offerings.module';
import { SupportModule } from './modules/support/support.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { VaultModule } from './modules/vault/vault.module';
import { VehicleCatalogModule } from './modules/vehicle-catalog/vehicle-catalog.module';

/** Every business module; the app, the dev runtime, and e2e tests load the same set. */
export const FEATURE_MODULES = [
  AuthModule,
  TenancyModule,
  VehicleCatalogModule,
  CustomersModule,
  EventsModule,
  JobsModule,
  MarketplaceModule,
  BookingsModule,
  CenterModule,
  OfferingsModule,
  IdempotencyModule,
  NotificationsModule,
  BillingModule,
  VaultModule,
  MaintenanceModule,
  SupportModule,
];
