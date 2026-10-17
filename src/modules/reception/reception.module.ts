import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { ReceptionRateLimitGuard } from './reception-rate-limit.guard';
import { RegistrationSession } from './entities/registration-session.entity';
import {
  ReceptionCustomerController,
  ReceptionStaffController,
} from './reception.controller';
import { ReceptionService } from './reception.service';
import { ReceptionIdentityService } from './reception-identity.service';
@Module({
  imports: [CustomersModule, TypeOrmModule.forFeature([RegistrationSession])],
  controllers: [ReceptionCustomerController, ReceptionStaffController],
  providers: [
    ReceptionService,
    ReceptionIdentityService,
    ReceptionRateLimitGuard,
  ],
})
export class ReceptionModule {}
