import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { EventsModule } from '../events/events.module';
import { StaffProfile } from '../tenancy/entities/staff-profile.entity';
import { JobAssignment } from './entities/job-assignment.entity';
import { ServiceJob } from './entities/service-job.entity';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceJob, JobAssignment, StaffProfile]),
    CustomersModule,
    EventsModule,
  ],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
