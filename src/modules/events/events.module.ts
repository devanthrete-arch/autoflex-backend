import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLog } from './entities/audit-log.entity';
import { ServiceJobEvent } from './entities/service-job-event.entity';
import { EventsService } from './events.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceJobEvent, AuditLog]),
    NotificationsModule,
  ],
  providers: [EventsService],
  exports: [EventsService, TypeOrmModule],
})
export class EventsModule {}
