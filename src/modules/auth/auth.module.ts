import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CustomersModule } from '../customers/customers.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CustomerActorGuard } from './guards/customer-actor.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { RolesGuard } from './guards/roles.guard';
import { StaffActorGuard } from './guards/staff-actor.guard';
import { JwtAuthService, JwksService } from './services/jwt-auth.service';
import { SupportIdentityModule } from '../support-identity/support-identity.module';
import { SupportActorGuard } from './guards/support-actor.guard';

@Global()
@Module({
  imports: [TenancyModule, CustomersModule, SupportIdentityModule],
  providers: [
    JwksService,
    JwtAuthService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CustomerActorGuard,
    },
    {
      provide: APP_GUARD,
      useClass: StaffActorGuard,
    },
    { provide: APP_GUARD, useClass: SupportActorGuard },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
  exports: [JwksService, JwtAuthService],
})
export class AuthModule {}
