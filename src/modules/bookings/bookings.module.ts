import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module';
import { GarageVehicle } from '../customers/entities/garage-vehicle.entity';
import { JobsModule } from '../jobs/jobs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OfferingsModule } from '../offerings/offerings.module';
import { ServiceCenter } from '../tenancy/entities/service-center.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import {
  BookingsController,
  CenterBookingsController,
} from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingSelectionRateLimitGuard } from './booking-selection-rate-limit.guard';
import { CenterBookingsService } from './center-bookings.service';
import { BookingAttachment } from './entities/booking-attachment.entity';
import { BookingItem } from './entities/booking-item.entity';
import { Booking } from './entities/booking.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      BookingItem,
      BookingAttachment,
      ServiceCenter,
      GarageVehicle,
    ]),
    CustomersModule,
    TenancyModule,
    OfferingsModule,
    JobsModule,
    NotificationsModule,
  ],
  controllers: [BookingsController, CenterBookingsController],
  providers: [
    BookingsService,
    CenterBookingsService,
    BookingSelectionRateLimitGuard,
  ],
  exports: [BookingsService, CenterBookingsService],
})
export class BookingsModule {}
