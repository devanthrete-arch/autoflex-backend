import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { EventsModule } from '../events/events.module';
import { StaffProfile } from '../tenancy/entities/staff-profile.entity';
import {
  CustomerJobsController,
  TrackingController,
} from './customer-jobs.controller';
import { CustomerJobsService } from './customer-jobs.service';
import { JobApproval } from './entities/job-approval.entity';
import { JobAssignment } from './entities/job-assignment.entity';
import { JobLineItem } from './entities/job-line-item.entity';
import { JobMedia } from './entities/job-media.entity';
import { ServiceJob } from './entities/service-job.entity';
import { JobEstimateService } from './job-estimate.service';
import { JobMediaService } from './job-media.service';
import { JobStoreService } from './job-store.service';
import { JobWorkController } from './job-work.controller';
import { JobWorkflowService } from './job-workflow.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobTrackingController } from './job-tracking.controller';
import { JobTrackingService } from './job-tracking.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceJob,
      JobAssignment,
      JobLineItem,
      JobApproval,
      JobMedia,
      StaffProfile,
    ]),
    CustomersModule,
    EventsModule,
  ],
  controllers: [
    JobTrackingController,
    JobsController,
    JobWorkController,
    CustomerJobsController,
    TrackingController,
  ],
  providers: [
    JobTrackingService,
    JobStoreService,
    JobsService,
    JobWorkflowService,
    JobEstimateService,
    JobMediaService,
    CustomerJobsService,
  ],
  exports: [JobsService, JobStoreService],
})
export class JobsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply((_req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        next();
      })
      .forRoutes(JobTrackingController);
  }
}
