import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CenterController } from './center.controller';
import { CenterService } from './center.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [TenancyModule],
  controllers: [CenterController, StaffController],
  providers: [CenterService, StaffService],
  exports: [CenterService, StaffService],
})
export class CenterModule {}
