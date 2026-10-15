import { SchedulingService } from '../scheduling/scheduling.service';
import { SchedulingController } from '../scheduling/scheduling.controller';
import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CenterController } from './center.controller';
import { CenterService } from './center.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [TenancyModule],
  controllers: [SchedulingController, CenterController, StaffController],
  providers: [SchedulingService, CenterService, StaffService],
  exports: [CenterService, StaffService],
})
export class CenterModule {}
