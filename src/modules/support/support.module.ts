import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SupportController } from './support.controller';
import { SupportRequestEvent } from './support-request-event.entity';
import { SupportRequest } from './support-request.entity';
import { SupportOperatorController } from './support-operator.controller';
import { SupportOperatorService } from './support-operator.service';
import { SupportWorkflowService } from './support-workflow.service';
import { SupportContextService } from './support-context.service';
import { SupportService } from './support.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SupportRequest, SupportRequestEvent]),
    CustomersModule,
    NotificationsModule,
  ],
  controllers: [SupportController, SupportOperatorController],
  providers: [
    SupportService,
    SupportOperatorService,
    SupportWorkflowService,
    SupportContextService,
  ],
})
export class SupportModule {}
