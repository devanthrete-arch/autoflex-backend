import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceCenter } from './entities/service-center.entity';
import { StaffProfile } from './entities/staff-profile.entity';
import { TenancyService } from './tenancy.service';

@Module({
  imports: [TypeOrmModule.forFeature([ServiceCenter, StaffProfile])],
  providers: [TenancyService],
  exports: [TenancyService, TypeOrmModule],
})
export class TenancyModule {}
