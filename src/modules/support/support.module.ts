import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SupportController } from './support.controller';
import { SupportRequest } from './support-request.entity';
import { SupportService } from './support.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SupportRequest]),
    CustomersModule,
    NotificationsModule,
  ],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
