import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { CustomerNotification } from './entities/customer-notification.entity';
import { NotificationDelivery } from './entities/notification-delivery.entity';
import {
  CustomerNotificationsController,
  JobNotificationsController,
} from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CustomerNotification, NotificationDelivery]),
    CustomersModule,
  ],
  controllers: [CustomerNotificationsController, JobNotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
